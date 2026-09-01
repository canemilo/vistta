# Despliegue

Cómo se pone Vistta en un VPS y cómo se opera. Se lee junto a CLAUDE.md y
HANDOFF.md. Lo que hay aquí está **probado en local levantando la pila entera**,
no escrito de memoria; lo que no se ha podido probar sin un servidor y una
cuenta de Cloudflare está marcado como tal.

## Qué se despliega

Cuatro contenedores (`compose.prod.yml`):

| Servicio | Qué es                      | Puertos                         |
| -------- | --------------------------- | ------------------------------- |
| `caddy`  | TLS, estáticos y proxy      | 80, 443 (los únicos publicados) |
| `api`    | Node + Hono + el trabajador | ninguno: solo por Caddy         |
| `db`     | PostgreSQL 16               | ninguno: solo red interna       |
| `migrar` | Corre y termina             | —                               |

La base **no publica puerto**. Publicarlo sería abrir Postgres a internet para
ahorrarse un `docker compose exec`.

Las migraciones van en un servicio aparte, no en el arranque de la API: si
fueran parte del arranque, dos réplicas migrarían a la vez.

## Puesta en marcha

```bash
git clone <repo> /srv/vistta && cd /srv/vistta

cp deploy/env.produccion.ejemplo .env
$EDITOR .env          # ver «Variables», abajo
chmod 600 .env

docker build -t vistta-api:latest .
docker build -f Dockerfile.web -t vistta-web:latest .

docker compose -f compose.prod.yml up -d
docker compose -f compose.prod.yml ps        # los cuatro, `healthy`
```

Caddy pide el certificado a Let's Encrypt al primer arranque: el dominio tiene
que apuntar ya a la IP del servidor y los puertos 80 y 443 estar abiertos.

## La primera cuenta y el administrador

Se crean **desde la máquina que tiene la base**, nunca por HTTP. La imagen de
producción solo lleva el bundle de la API y el de las migraciones, así que los
scripts de alta se ejecutan desde el repo clonado, apuntando al Postgres del
compose por el puerto que compose expone dentro de su red:

```bash
# En /srv/vistta, con el repo clonado y las dependencias instaladas:
export DATABASE_URL="postgresql://vistta:LA-CONTRASENA@127.0.0.1:5432/vistta"
docker compose -f compose.prod.yml exec db true   # la base está viva

pnpm user:create marina "Marina" "una-contrasena-larga"
pnpm admin:create marina
```

Si no se quiere instalar Node en el servidor, el atajo es abrir un túnel al
Postgres del compose (`ssh -L`) y correr esos dos comandos desde tu máquina.

**No hay ni habrá ruta HTTP que conceda `admin`.** Un endpoint que otorgue admin
convierte cualquier fallo de autorización futuro en una toma de control
completa.

## Variables

Todas en `.env`, junto a `compose.prod.yml`, con permisos `600` y fuera de git.
La plantilla comentada está en `deploy/env.produccion.ejemplo`.

Las que no se pueden olvidar:

- `DOMINIO`, `ACME_EMAIL`, `BASE_URL` — sin ellas compose ni arranca.
- `POSTGRES_PASSWORD` — genérala (`openssl rand -base64 32`), no la escribas.
- `MEDIA_SIGNING_KEY` — 32 caracteres o más. **Cambiarla invalida todas las URLs
  de medios ya emitidas**, incluidos los pases abiertos ahora mismo.
- `STORAGE_DRIVER=r2` más las cuatro `R2_*`.

Una variable opcional puede quedarse **vacía**: se trata como ausente. Antes no
era así y la API entraba en bucle de reinicio quejándose de una URL de Supabase
que nadie había pedido usar; hay una prueba que lo fija (`test/config.spec.ts`).

## Medios: R2

R2 se elige por el **egreso**. Cada visita a una foto vuelve a leer el original
para incrustarle su marca de agua, así que un proveedor que cobre los bytes de
salida cobra ese diseño dos veces.

En el panel de Cloudflare: crear el bucket, y un token de API de tipo _Object
Read & Write_ **limitado a ese bucket**. De ahí salen `R2_ACCESS_KEY_ID` y
`R2_SECRET_ACCESS_KEY`; `R2_ACCOUNT_ID` es el de la cuenta.

El bucket es **privado y sin dominio público**. El navegador nunca habla con R2:
pide `/m/<id>` a nuestra API, que comprueba firma, instantánea del pase y estado
del medio, y devuelve los bytes ya marcados.

> El adaptador (`src/storage/r2.ts`) firma SigV4 a mano, sin SDK de AWS. Se ha
> verificado contra MinIO, que valida la firma igual que R2: sube, baja y borra
> con claves que llevan barras y espacios. Y por mutación: saltarse un paso de
> la derivación de la clave da 403, y firmar un cuerpo vacío mandando bytes de
> verdad da 400. **Contra R2 de verdad no se ha podido probar** (hace falta una
> cuenta con tarjeta): es el primer paso a hacer al desplegar.

## Cloudflare por delante

Si se activa el proxy naranja de Cloudflare hay que tocar **dos** cosas a la vez:

1. En `deploy/Caddyfile`, cambiar `header_up X-Forwarded-For {remote_host}` por
   `{http.request.header.Cf-Connecting-Ip}`.
2. Cerrar el origen por cortafuegos a los rangos de Cloudflare.

Una sin la otra es peor que ninguna. Sin (1), todos los clientes comparten la IP
de Cloudflare y el límite del login se les aplica a todos juntos. Sin (2),
cualquiera puede mandar esa cabecera y elegir su propia identidad.

En Cloudflare, además: **no activar caché para `/m/*` ni para `/api/*`**. La
marca de agua es por visita; una respuesta cacheada sería la marca de otro.

## Copias de seguridad

```bash
./scripts/backup.sh                    # a ./copias, formato custom
DIAS_A_GUARDAR=30 ./scripts/backup.sh
```

Cron diario:

```
15 4 * * * cd /srv/vistta && ./scripts/backup.sh >> /var/log/vistta-backup.log 2>&1
```

El script **comprueba la copia antes de rotar**: si el volcado no se puede leer,
sale con error y no borra nada. Al revés, una noche con la base caída se
llevaría por delante las copias buenas.

Restaurar (probado: 11 tablas y las filas vuelven):

```bash
docker compose -f compose.prod.yml exec db psql -U vistta -d postgres -c "CREATE DATABASE restaurada;"
docker compose -f compose.prod.yml exec db pg_restore -U vistta -d restaurada /copias/vistta-<sello>.dump
```

Sobre la base viva, con la API parada y sabiendo lo que se hace:

```bash
docker compose -f compose.prod.yml stop api
docker compose -f compose.prod.yml exec db pg_restore -U vistta -d vistta --clean --if-exists /copias/vistta-<sello>.dump
docker compose -f compose.prod.yml start api
```

**Los MEDIOS no están en estas copias**: viven en R2, que tiene su propio
versionado. Una restauración de la base sin los medios deja perfiles apuntando a
objetos que puede que ya no estén.

## Actualizar

```bash
cd /srv/vistta && git pull
docker build -t vistta-api:latest . && docker build -f Dockerfile.web -t vistta-web:latest .
docker compose -f compose.prod.yml up -d       # `migrar` corre antes que `api`
```

Los certificados sobreviven porque están en un volumen (`caddy_data`). Sin eso,
cada despliegue pediría certificados nuevos y Let's Encrypt acabaría limitando.

## Qué comprobar después de desplegar

```bash
curl -sI https://TU-DOMINIO/ | grep -i content-security-policy   # script-src 'self'
curl -s  https://TU-DOMINIO/health                               # {"ok":true}
```

Y a ojo, una vez: abrir un pase de prueba y mirar que **la foto lleva la marca
encima**. Es lo único que no detecta ninguna comprobación automática de las de
aquí, y es la mitad del producto.

## Cosas que se han medido, para no repetir el trabajo

- **Las fuentes de la marca de agua**: HANDOFF avisaba de que sin `fontconfig` el
  texto del SVG saldría vacío. Se midió sobre esta imagen y **hoy no es así**:
  quitando fontconfig y las fuentes, el texto se sigue dibujando, porque el
  libvips que trae Sharp precompilado lleva su propia fuente de reserva. Se
  instalan igual (quitan un error por stderr y la propiedad deja de depender de
  un detalle interno de Sharp), pero quien sostiene la garantía es
  `scripts/comprobar-fuentes.ts`, que corre **dentro de la construcción**: si el
  texto no se dibuja, la imagen no llega a existir.
- **La API no arranca sin base**, y es a propósito. Sale con código 1 y un
  motivo legible, no con un volcado de pila de `pg`.
- **La imagen pesa unos 445 MB.** Casi todo son los binarios nativos de Sharp y
  de Argon2. Bajarla exigiría compilar contra el libvips del sistema, y entonces
  el aviso de las fuentes vuelve a ser cierto.
