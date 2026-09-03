#!/usr/bin/env bash
# Un despliegue completo, en un solo comando y repetible.
#
#   ./scripts/desplegar.sh              # traer, construir, levantar y esperar
#   SIN_GIT=1 ./scripts/desplegar.sh    # sin `git pull` (ya has traído tú)
#   SIN_BUILD=1 ./scripts/desplegar.sh  # sin reconstruir: solo converger el estado
#   COMPOSE="docker compose -f compose.prod.yml -f compose.supabase.yml" ./scripts/desplegar.sh
#
# Es idempotente en el estado final: ejecutarlo dos veces seguidas deja el
# sistema igual. Lo que NO hace es dejar los contenedores en paz: reconstruir
# cambia el identificador de la imagen aunque todas las capas estén cacheadas
# —BuildKit sella la configuración cada vez— y entonces compose recrea api,
# migrar y caddy. Medido: dos ejecuciones seguidas sin tocar una línea dan dos
# identificadores distintos.
#
# La consecuencia práctica: CADA DESPLIEGUE CORTA unos segundos. Poco, pero si
# justo en ese momento un cliente está mirando un pase, su foto no carga —cada
# visita relee el original para marcarlo, así que no hay nada cacheado que le
# salve—. Con SIN_BUILD=1 se converge el estado sin reconstruir, y entonces
# compose sí deja en pie lo que no ha cambiado.
#
# NO aplica migraciones por su cuenta, y es a propósito: `migrar` es un servicio
# del compose que corre antes que `api` por dependencia declarada. Lanzarlas
# también desde aquí sería tener dos sitios que migran, y un día correrían a la
# vez.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="${COMPOSE:-docker compose -f compose.prod.yml}"
ESPERA_MAXIMA="${ESPERA_MAXIMA:-120}"

paso() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
morir() { printf '\n\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# --- Antes de tocar nada -----------------------------------------------------
[[ -f .env ]] || morir "no hay .env junto a compose.prod.yml. Cópialo de deploy/env.produccion.ejemplo."

# Las etiquetas de las imágenes salen del mismo .env que usa compose: si aquí se
# construyera `vistta-api:latest` y el .env pidiera otra, compose se iría a
# buscarla a Docker Hub y el despliegue fallaría con un error que no menciona
# esta diferencia.
set -a; . ./.env; set +a
IMAGEN_API="${IMAGEN_API:-vistta-api:latest}"
IMAGEN_WEB="${IMAGEN_WEB:-vistta-web:latest}"

# --- 1. Traer el código ------------------------------------------------------
if [[ "${SIN_GIT:-0}" != "1" ]]; then
  paso "Trayendo cambios"
  # Si hay cambios locales sin guardar, `git pull` puede dejar el árbol a medias
  # y entonces se despliega algo que no está en ninguna rama.
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    morir "hay cambios locales sin commitear. Guárdalos o descártalos antes de desplegar."
  fi
  # --ff-only: nunca crear un merge a espaldas de nadie durante un despliegue.
  git pull --ff-only
else
  paso "Sin git pull (SIN_GIT=1)"
fi

echo "Commit desplegado: $(git rev-parse --short HEAD) — $(git log -1 --format=%s)"

# --- 2. Construir ------------------------------------------------------------
# Las dos imágenes se construyen aquí, en el servidor. La de la API comprueba
# durante la construcción que la marca de agua dibuja texto y que argon2 cifra:
# si algo de eso falla, la imagen no llega a existir y no se despliega nada.
if [[ "${SIN_BUILD:-0}" != "1" ]]; then
  paso "Construyendo $IMAGEN_API"
  docker build -t "$IMAGEN_API" .

  paso "Construyendo $IMAGEN_WEB"
  docker build -f Dockerfile.web -t "$IMAGEN_WEB" .
else
  paso "Sin construir (SIN_BUILD=1)"
fi

# --- 3. Levantar -------------------------------------------------------------
paso "Levantando"
# Si `up` falla, casi siempre es `migrar`: no puede aplicar las migraciones y
# corta el despliegue antes de que la API llegue a arrancar, que es exactamente
# lo que tiene que pasar. Pero compose solo dice «didn't complete successfully»,
# así que el motivo se enseña aquí en vez de dejar a alguien buscándolo.
if ! $COMPOSE --env-file .env up -d; then
  echo >&2
  # 40 y no 15, medido: con una contraseña mala, `error: password
  # authentication failed` cae unas 30 líneas por encima del final, porque `pg`
  # imprime detrás el objeto de error entero. Con 15 solo se veía la cola del
  # volcado, que no dice nada.
  echo "--- últimas líneas de migrar ---" >&2
  $COMPOSE --env-file .env logs --tail 40 migrar >&2 || true
  echo "--- últimas líneas de api ---" >&2
  $COMPOSE --env-file .env logs --tail 40 api >&2 || true
  morir "el despliegue no ha levantado. El motivo está arriba."
fi

# --- 4. Esperar a que esté sana ---------------------------------------------
# `up -d` vuelve en cuanto los contenedores arrancan, no cuando la API responde.
# Sin esta espera, el script diría «listo» con la API todavía reiniciándose por
# una configuración mala, que es justo el momento en que uno cierra la terminal.
paso "Esperando a que la API esté sana (hasta ${ESPERA_MAXIMA}s)"
CONTENEDOR="$($COMPOSE --env-file .env ps -q api)"
[[ -n "$CONTENEDOR" ]] || morir "el servicio api no ha arrancado. Mira: $COMPOSE logs api"

ESPERADO=0
while [[ "$ESPERADO" -lt "$ESPERA_MAXIMA" ]]; do
  ESTADO="$(docker inspect --format '{{.State.Health.Status}}' "$CONTENEDOR" 2>/dev/null || echo desconocido)"
  case "$ESTADO" in
    healthy)
      echo "API sana tras ${ESPERADO}s."
      break
      ;;
    unhealthy)
      $COMPOSE --env-file .env logs --tail 20 api >&2
      morir "la API ha arrancado y NO está sana. El motivo está arriba."
      ;;
  esac
  sleep 2
  ESPERADO=$((ESPERADO + 2))
done

if [[ "$ESPERADO" -ge "$ESPERA_MAXIMA" ]]; then
  $COMPOSE --env-file .env logs --tail 20 api >&2
  morir "la API no se ha puesto sana en ${ESPERA_MAXIMA}s. El log está arriba."
fi

# --- 5. Y decir cómo ha quedado ---------------------------------------------
paso "Estado"
$COMPOSE --env-file .env ps
echo
echo "El servicio 'migrar' aparece como Exited (0) y ESO ES CORRECTO: aplica las"
echo "migraciones y termina."
