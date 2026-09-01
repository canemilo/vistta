#!/usr/bin/env bash
# Copia de seguridad de la base, para el cron del VPS.
#
#   ./scripts/backup.sh                 # copia en ./copias
#   DIAS_A_GUARDAR=30 ./scripts/backup.sh
#
# Cron diario, a las 4:15:
#   15 4 * * * cd /srv/vistta && ./scripts/backup.sh >> /var/log/vistta-backup.log 2>&1
#
# El volcado sale en formato `custom` (-Fc), no en SQL plano: se restaura tabla
# a tabla si hace falta, va comprimido, y `pg_restore` puede listar lo que hay
# dentro sin ejecutarlo. Un .sql de 300 MB solo se puede restaurar entero.
set -euo pipefail

cd "$(dirname "$0")/.."

DIAS_A_GUARDAR="${DIAS_A_GUARDAR:-14}"
DESTINO="${DESTINO:-./copias}"
COMPOSE="${COMPOSE:-docker compose -f compose.prod.yml}"

# Las credenciales salen del mismo .env que usa el despliegue: una sola fuente.
if [[ -f .env ]]; then
  set -a; . ./.env; set +a
fi
USUARIO="${POSTGRES_USER:-vistta}"
BASE="${POSTGRES_DB:-vistta}"

mkdir -p "$DESTINO"
SELLO="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVO="vistta-${SELLO}.dump"

echo "Volcando ${BASE} a ${DESTINO}/${ARCHIVO}"
# El volcado se escribe DENTRO del contenedor, en /copias, que está montado en
# el host. Sacarlo por la salida estándar funciona, pero un fallo a mitad deja
# un archivo truncado que parece bueno.
$COMPOSE exec -T db pg_dump -U "$USUARIO" -d "$BASE" -Fc -f "/copias/${ARCHIVO}"

# Que exista no basta: un volcado corrupto también existe. `pg_restore -l` lee
# la tabla de contenidos, así que falla aquí si el archivo no es legible.
if ! $COMPOSE exec -T db pg_restore -l "/copias/${ARCHIVO}" > /dev/null; then
  echo "El volcado no se puede leer. Se deja para inspección y NO se rota nada." >&2
  exit 1
fi

TAMANO="$(du -h "${DESTINO}/${ARCHIVO}" | cut -f1)"
echo "Copia correcta: ${ARCHIVO} (${TAMANO})"

# La rotación va DESPUÉS de comprobar la copia nueva. Al revés, una noche con la
# base caída borraría las copias buenas y no dejaría ninguna nueva.
echo "Rotando: se guardan ${DIAS_A_GUARDAR} días"
find "$DESTINO" -name 'vistta-*.dump' -type f -mtime "+${DIAS_A_GUARDAR}" -print -delete

echo "Copias actuales: $(find "$DESTINO" -name 'vistta-*.dump' | wc -l | tr -d ' ')"
