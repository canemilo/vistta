# Vistta — API

Backend del MVP: **Node + Hono + PostgreSQL**. El núcleo es el **ciclo del pase**
y su **consumo atómico de un solo uso**.

## Estructura

    src/server.ts         Arranque: lee el entorno, abre el pool, escucha
    src/app.ts            createApp(deps): monta Hono con sus dependencias
    src/config.ts         Entorno validado con Zod
    src/db.ts             Pool de pg + interfaz Db (query / one / tx)
    src/migrate.ts        Aplicador de migraciones (lo usan el CLI y los tests)
    src/routes/passes.ts  POST /api/passes (crear) · GET /api/open/:token (abrir+consumir)
    src/routes/panel.ts   Sesión del panel (login, quién soy, salir)
    src/routes/profiles.ts Perfiles y subida de medios
    src/routes/media.ts   GET /m/* servido solo con firma válida
    src/lib/pass.ts       createPass / consumePass (UPDATE atómico)
    src/lib/auth.ts       Cuentas y sesiones opacas
    src/lib/password.ts   Argon2id
    src/lib/ratelimit.ts  Contador en Postgres, por hash de la identidad
    src/lib/media.ts      Firma HMAC de las URLs de medios
    src/lib/client-ip.ts  Identidad del cliente (política de TRUST_PROXY)
    src/storage/          Puerto Storage + adaptadores (memoria, Supabase)
    migrations/           SQL en dialecto PostgreSQL
    test/                 Vitest contra Postgres REAL

## Puesta en marcha

    cp .env.example .env           # y rellena DATABASE_URL y MEDIA_SIGNING_KEY
    pnpm install
    pnpm db:up                     # Postgres local en el puerto 5433 (Docker)
    pnpm db:migrate
    pnpm user:create marina "Marina Ruiz" una-contrasena-larga
    pnpm dev                       # API en http://localhost:8787
    pnpm dev:all                   # API + frontend Angular a la vez

`pnpm setup:local` hace de un tirón el `db:up`, el `db:migrate` y el contenido de
demostración. Todas las cuentas comparten la contraseña `demo-vistta-2026`:

| Cuenta                                    | Qué ves                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `demo`                                    | **Los cuatro perfiles** en el selector del panel |
| `nordeste`, `marina`, `costavega`, `rama` | Un oficio cada una, como sería en real           |

Son cuatro oficios distintos a propósito —fotografía de arquitectura, retrato editorial,
inmobiliaria y masaje terapéutico— para ver que la plantilla no está atada a un sector:
la inmobiliaria es casi toda imagen y el masajista casi todo texto.

La cuenta `demo` **no es un rol de administrador y no se salta nada**: posee copias de los
cuatro perfiles, con `owner_id = 'demo'` y claves de medios propias, como cualquier otro
dueño. Sigue sin ver los perfiles de las otras cuatro cuentas. Para mirarlos sin gastar
pases, usa la vista previa del panel: no consume ninguno.

## Pruebas

    pnpm test

El `docker-compose` levanta **dos** bases en el mismo contenedor: `vistta` para
desarrollo y `vistta_test` para las pruebas. Están separadas porque el arnés hace
`TRUNCATE` entre tests: con una sola, `pnpm test` se llevaría por delante lo que
acabas de sembrar con `pnpm db:seed:local`.

Corren contra **PostgreSQL de verdad**, no contra un doble en memoria. No es
capricho: el invariante del producto (un pase se consume una vez y solo una) es
de concurrencia, y un motor monohilo lo daría por bueno aunque estuviera mal.
Por defecto se conectan a la base del `docker-compose`; con `TEST_DATABASE_URL`
se apuntan a cualquier otra.

## Probar a mano

    # crear un pase (hace falta una sesión del panel)
    curl -X POST localhost:8787/api/passes \
      -H "authorization: Bearer <TOKEN_DE_SESION>" -H "content-type: application/json" \
      -d '{"profileId":"p_marina"}'
    # abrir el enlace devuelto: la 1ª vez 200, la 2ª 410 (Acceso denegado)

## Despliegue

El MVP va a un host de Node sin tarjeta (Render o similar) con Supabase como
base y como almacén de medios. Las variables se cargan como secretos del host:
`DATABASE_URL`, `MEDIA_SIGNING_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`.
`TRUST_PROXY=true` solo si delante hay un proxy propio.
