# Vistta — API

Backend: **Node + Hono + PostgreSQL**. El núcleo es el **ciclo del pase** y su
**consumo atómico**: un enlace se abre las veces que diga su modo y ni una más,
resuelto en un único UPDATE condicional. Por defecto, **una sola vez**.

## Estructura

    src/server.ts         Arranque: lee el entorno, abre el pool, escucha
    src/app.ts            createApp(deps): monta Hono con sus dependencias
    src/config.ts         Entorno validado con Zod
    src/db.ts             Pool de pg + interfaz Db (query / one / tx)
    src/migrate.ts        Aplicador de migraciones (lo usan el CLI y los tests)
    src/routes/passes.ts  Crear y abrir pases · telemetría de lectura
    src/routes/panel.ts   Sesión del panel (login, quién soy, salir)
    src/routes/profiles.ts Perfiles y subida de medios (presign + confirm)
    src/routes/media.ts   GET /m/* servido solo con firma válida, y marcado al vuelo
    src/routes/admin.ts   Panel de administración (cuentas, nunca contenido)
    src/routes/billing.ts Cobro manual: código VISTTA-XXXXXX y conciliación
    src/routes/legal.ts   GET /api/legal, público y sin sesión
    src/lib/pass.ts       createPass / consumePass (UPDATE atómico) y pasAbribleSql
    src/lib/planes.ts     TODAS las cifras de los planes. No hay números fuera de aquí
    src/lib/media.ts      Firma HMAC con dominio separado por uso
    src/lib/watermark.ts  La marca, incrustada en los píxeles por visita
    src/lib/eventos.ts    Métricas de lectura, agregadas
    src/lib/congelado.ts  Pasarse de un límite congela; no borra
    src/lib/purga.ts      Lo único que borra contenido. Con retención por plan
    src/lib/auth.ts       Cuentas y sesiones opacas · password.ts  Argon2id
    src/lib/ratelimit.ts  Contador en Postgres, por hash de la identidad
    src/lib/client-ip.ts  Identidad del cliente (política de TRUST_PROXY)
    src/storage/          Puerto Storage + cuatro adaptadores: r2, supabase, fs, memory
    src/worker.ts         La cola (vistta.jobs) vive en Postgres, no en Redis
    migrations/           SQL en dialecto PostgreSQL, de 0001 a 0009
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

**La ruta de producción es un VPS propio**, no un host serverless: Sharp y
Argon2 son binarios nativos y necesitan un servidor de verdad.

| Pieza                            | Dónde                                                    |
| -------------------------------- | -------------------------------------------------------- |
| API, panel/viewer, Caddy y la BD | **VPS Contabo x86** con Ubuntu 24.04 y Docker            |
| Medios                           | **Cloudflare R2**, jurisdicción UE (`STORAGE_DRIVER=r2`) |
| TLS y estáticos                  | Caddy, en el mismo compose                               |

Un despliegue completo es un comando:

    ./scripts/desplegar.sh

Trae los cambios, construye las dos imágenes, levanta, **espera a que la API
esté sana** y enseña el estado; si algo falla, sale con error y con el log del
servicio que lo rompió.

Las guías, en el orden en que hacen falta:

| Documento                         | Para qué                                                            |
| --------------------------------- | ------------------------------------------------------------------- |
| `docs/12-vps-produccion.md`       | Del VPS recién contratado a Docker operativo y DNS resolviendo      |
| `docs/11-puesta-en-produccion.md` | De ahí a Vistta funcionando: `.env`, medios, levantar y comprobar   |
| `docs/13-migracion-a-r2.md`       | El bucket, el token, y `pnpm r2:verificar` antes de que entre nadie |
| `docs/14-supabase-opcional.md`    | La base fuera de la máquina. **No es el camino por defecto**        |
| `DESPLIEGUE.md`                   | Copias, restauración probada y el paso a proxy de Cloudflare        |

`TRUST_PROXY=true` solo si delante hay un proxy propio; el `compose.prod.yml` ya
lo pone, porque siempre está Caddy.

## Antes de meter clientes reales

Nada de esto es programación, y sin ello el despliegue **no está listo para el
trabajo real de nadie**:

1. **Los cuatro datos del titular**: `TITULAR_NOMBRE`, `TITULAR_IDENTIFICACION`,
   `TITULAR_DIRECCION` y `CONTACTO_LEGAL`. Sin los cuatro, `/legal` avisa de que
   el despliegue no está configurado —`GET /api/legal` devuelve
   `"completo": false`— y **el procedimiento de retirada de contenido no lleva a
   ninguna parte**. Es el que atiende un aviso por contenido no consentido o por
   CSAM: tiene que llegar a un buzón que alguien lee.
2. **Fijar la jurisdicción** del VPS y del bucket de R2 y anotarla en
   `legal/rat.md`, punto D. Para R2 no basta la _location hint_: la garantía es
   la **jurisdicción `eu`**, y entonces hace falta `R2_ENDPOINT` —comprobado
   contra la cuenta real: sin esa variable el bucket es inalcanzable—
   (ver `docs/13-migracion-a-r2.md`).
3. **Guardar el contrato de encargado de cada proveedor** (Contabo y
   Cloudflare). Un subencargado sin contrato incumple el art. 28.4 por bien que
   funcione el sistema.
4. **Que un abogado revise los cuatro textos públicos de `legal/`.** Están
   escritos leyendo el esquema, que es lo que un abogado no puede aportar; la
   revisión jurídica es lo que no puede aportar quien escribió el código.
5. **Pasar los medios a R2 y comprobarlo** con `pnpm r2:verificar`, que hace el
   ciclo entero contra el bucket real. Con `STORAGE_DRIVER=fs` las fotos no
   entran en ninguna copia de seguridad.
6. **Restaurar una copia** de verdad. El procedimiento está probado y descrito
   en `DESPLIEGUE.md`.
