# Vistta API (MVP)

Backend del MVP: Cloudflare Workers + Hono + D1. Núcleo: el **ciclo del pase** con
**consumo atómico de un solo uso**.

## Estructura

    src/index.ts          App Hono + cabeceras de seguridad
    src/routes/passes.ts  POST /api/passes (crear) · GET /v/:token (abrir+consumir)
    src/lib/pass.ts       createPass / consumePass (UPDATE atómico)
    src/lib/token.ts      token opaco 128 bits + hash SHA-256
    src/lib/security.ts   CSP, frame-ancestors, no-store, etc.
    src/lib/media.ts      firma de medios (placeholder)
    migrations/0001_init.sql
    test/pass.spec.ts     un solo uso, caducidad, auth, concurrencia

## Puesta en marcha

    pnpm install
    pnpm db:create                 # copia el database_id al wrangler.toml
    pnpm db:migrate:local
    cp .dev.vars.example .dev.vars # y pon un PANEL_TOKEN
    pnpm dev                       # http://localhost:8787
    pnpm test                      # ejecuta las pruebas

## Probar a mano

    # crear un pase (necesitas un profile en la BD; ver seed en el test)
    curl -X POST localhost:8787/api/passes \
      -H "authorization: Bearer <PANEL_TOKEN>" -H "content-type: application/json" \
      -d '{"profileId":"pro_1"}'
    # abrir el enlace devuelto: la 1ª vez 200, la 2ª 410 (Acceso denegado)

## Despliegue (MVP gratis)

    pnpm db:migrate:remote
    wrangler secret put PANEL_TOKEN
    pnpm deploy
