# Vistta API (MVP)

Backend del MVP: Cloudflare Workers + Hono + D1. Núcleo: el **ciclo del pase** con
**consumo atómico de un solo uso**.

## Estructura

    src/index.ts           App Hono + cabeceras de seguridad + manejo de errores
    src/routes/panel.ts    POST /api/panel/session (login con PIN)
    src/routes/passes.ts   POST /api/passes (crear) · GET /v/:token (abrir+consumir)
    src/routes/media.ts    GET /m/* (medio con URL firmada y efímera)
    src/lib/pass.ts        createPass / consumePass (UPDATE ... RETURNING atómico)
    src/lib/auth.ts        PIN + sesión opaca del panel
    src/lib/ratelimit.ts   contador en D1 con ventana y bloqueo
    src/lib/media.ts       firma HMAC de medios + marca de agua por visita
    src/lib/token.ts       token opaco de 128 bits + hash SHA-256
    src/lib/crypto.ts      SHA-256, HMAC y comparación en tiempo constante
    src/lib/security.ts    CSP, frame-ancestors, no-store, HSTS, etc.
    migrations/            0001 esquema del pase · 0002 rate limit y sesiones
    seed/demo.sql          perfiles de demostración para local
    test/                  pase, seguridad y medios (21 pruebas)
    web/                   frontend Angular (standalone + signals + Tailwind)
      src/app/pass-card/   tarjeta del pase: cabecera, mosaico y marca de agua
      src/app/viewer/      /v/:token — abre el pase (lo consume) y muestra el trabajo
      src/app/panel/       /panel  — PIN, elegir perfil y generar el enlace
      src/app/demo/        /       — portada con el aspecto de un pase abierto

## Modelo de seguridad

- El enlace lleva un **token opaco de 128 bits**; en la BD solo vive su SHA-256.
- El consumo es un **único `UPDATE` condicional** (`status='pending' AND expires_at > now`):
  con dos aperturas simultáneas solo una recibe 200, la otra 410.
- Usado, caducado o inexistente devuelven **el mismo 410**: no se filtra en qué estado está.
- Los medios se sirven solo con **firma HMAC** atada al pase (`pid`) y con caducidad de 5 min.
- Login del panel: **PIN** comparado en tiempo constante, 5 intentos por ventana de 15 min y
  bloqueo de 15 min. La sesión es un token opaco guardado como hash, con TTL de 30 min.
- El rate limit guarda el **hash** de la IP, nunca la IP; los logs no llevan PII.
- Vistta no impide una captura de pantalla y no debe prometerlo: la marca de agua por visita
  solo permite **trazar** el origen de una filtración.

## Puesta en marcha (local, todo en marcha con dos comandos)

    pnpm install && pnpm --dir web install
    cp .dev.vars.example .dev.vars # PANEL_PIN, PANEL_TOKEN y MEDIA_SIGNING_KEY
    pnpm setup:local               # migra la BD local y carga perfiles de demo
    pnpm dev:all                   # API en :8787 y viewer en :4200

Con eso: <http://localhost:4200> (portada), `/panel` (PIN `123456` en local) y
`/v/:token` (viewer). `ng serve` hace de proxy de `/api` y `/m/` hacia el Worker,
así que no hay CORS ni configuración de entorno en el frontend.

    pnpm check                     # typecheck + lint + tests del Worker

## Probar a mano

    # 1. Abrir sesión en el panel con el PIN
    curl -X POST localhost:8787/api/panel/session \
      -H "content-type: application/json" -d '{"pin":"123456"}'

    # 2. Crear un pase (necesitas un profile en la BD; ver seed en test/helpers.ts)
    curl -X POST localhost:8787/api/passes \
      -H "authorization: Bearer <token-de-sesion>" -H "content-type: application/json" \
      -d '{"profileId":"pro_1"}'

    # 3. Abrir el enlace devuelto: la 1ª vez 200, la 2ª 410 (Acceso denegado)

## Despliegue (MVP gratis)

    pnpm db:migrate:remote
    wrangler secret put PANEL_PIN
    wrangler secret put PANEL_TOKEN        # opcional: acceso de servicio para CI
    wrangler secret put MEDIA_SIGNING_KEY
    pnpm deploy

El frontend se despliega aparte (Cloudflare Pages con `pnpm --dir web build`).
`BASE_URL` del Worker debe apuntar al origen del viewer: es la base de los enlaces `/v/:token`.

CI (`.github/workflows/ci.yml`) ejecuta typecheck, lint, formato, pruebas y build del frontend.
El despliegue (`deploy.yml`) necesita los secretos `CLOUDFLARE_API_TOKEN` y
`CLOUDFLARE_ACCOUNT_ID` en GitHub.

## Pendiente

- Medios reales en R2: en local los mosaicos usan degradados de reserva porque el bucket
  está vacío; en cuanto haya objetos con esas claves, el viewer los pinta encima.
- Marca de agua **incrustada** en la imagen servida (hoy se superpone en el viewer, lo que
  no sobrevive a una captura de pantalla).
- Documentos de cumplimiento: AUP con notice-and-takedown y anexo de encargado (art. 28 RGPD).
