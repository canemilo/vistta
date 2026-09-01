# HANDOFF — Vistta · plan de cierre

> Se lee junto con CLAUDE.md al inicio de cada sesión. Al cerrar un bloque, vuelca lo estable a CLAUDE.md.
>
> **Corregido el 2026-09-01.** La versión anterior daba por cerrados los bloques B y C. No lo estaban:
> describía un backend Node + PostgreSQL + Argon2id + pg-mem que no existe en el disco ni en el historial
> de git. Lo que hay es el prototipo Workers + D1 + R2 con PBKDF2. Este documento describe ahora el
> estado real. **Si vuelves a encontrar una discrepancia, gana el disco, no este archivo.**

## 0. Estado real (verificado en el árbol de trabajo)

- Backend **Cloudflare Workers + D1 + R2**. `src/env.ts` declara `DB: D1Database` y `MEDIA?: R2Bucket`.
- **Pase de un solo uso atómico**: implementado y correcto (`src/lib/pass.ts`). Es lo mejor del repo.
- **Firma HMAC de medios** (`src/lib/media.ts`): implementada y portable a Node sin cambios (WebCrypto).
- **Auth a medias**: hay cuentas, sesiones y rate limit, pero con **PBKDF2**, no Argon2id.
- **El esquema no está en el repo.** Ninguna migración crea `users`, `profiles.owner_id` ni
  `panel_sessions.user_id`, que el código sí usa. El esquema real vive solo en
  `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`, que está en `.gitignore`.
- **La suite no arranca**: `vitest.config.ts` perdió `nodejs_compat`, el binding `MEDIA` y
  `MEDIA_SIGNING_KEY`. `npx vitest run` da "no tests" y un error de configuración.
- **El CI está rojo**: `ci.yml` invoca `pnpm lint` y `pnpm format:check`, que `package.json` ya no define.
- Todo ello queda sellado en el commit `3aac675` de la rama `wip-bloques-b-c`.

## 1. Decisiones (Bloque A)
- [x] Runtime = Node. [x] Datos = PostgreSQL/Supabase (sin tarjeta). [x] Medios MVP = Supabase Storage; R2 en producción.
- [x] Proyecto Supabase creado (`ysrsruebruqppmtvgozm`); credenciales en `.env`, ignorado por git.
      Falta la contraseña y la región de `DATABASE_URL`.
- [ ] Marca/paleta única en tailwind.config.js.

### Decisiones del 2026-09-01 (bloque D)
- **Vídeo: sí, con tope de 50 MB** (el plan gratuito de Supabase limita el fichero; verificar la cifra
  exacta antes de fijarla). El panel debe avisar de que **el vídeo no lleva marca incrustada**.
- **Marca de agua incrustada en los píxeles, por visita** (Sharp al servir). Las imágenes pasan por
  Node y no se cachean: es el precio de que "marca de agua por visita" sea verdad y no marketing.
- **Instantánea del contenido al crear el pase** (tabla `pass_media`). Da significado exacto a la
  cuota por pase y deja bien definida la purga del bloque E.
- **Postgres real en las pruebas, no pg-mem.** Los dos invariantes críticos (consumo atómico del pase
  y reserva de cuota) son de concurrencia; pg-mem es monohilo y sin MVCC, así que dejaría pasar un
  test que no demuestra nada. GitHub Actions da Postgres como servicio, gratis.
- **Esquema `vistta` propio, no expuesto a PostgREST**, más RLS sin políticas. Si las tablas viven en
  `public` sin RLS, la clave publicable del navegador puede leer los hashes de contraseña.
- Herramientas: `node-pg-migrate`, `@node-rs/argon2` (precompilado), `bigint` de milisegundos.

## 2. Bloques restantes

- [ ] **P0 — Higiene** (bloqueante, antes de nada): reconstruir la migración con `users`,
      `profiles.owner_id`, `panel_sessions.user_id` y `rate_limits` (fuente: el `.schema` del SQLite
      local, ya volcado); devolver a `package.json` los scripts que el CI invoca; restaurar los
      bindings de `vitest.config.ts` para tener línea base verde **desde la que** migrar.
- [ ] **B+C — rehacer de verdad**, ahora dentro de D0: no existen sobre Postgres.
- [ ] **D0 — Node + Postgres + Supabase**: `config.ts` con Zod; `db.ts` con `pg`; migraciones en
      dialecto Postgres; portar `pass`/`ratelimit`/`auth`; `@hono/node-server` + inyección de
      dependencias (ojo: `c.env` en Node **no** son bindings); Argon2id; arnés de tests; puerto
      `Storage` + adaptador Supabase + adaptador en memoria.
      **Hito de cierre: los 5 tests de firma vuelven a verde.**
- [ ] **D — Medios**: tabla `media` + cuota; `presign` (valida sesión, propiedad, tipo, tamaño y cuota
      **antes** de firmar); `confirm` (magic bytes + tamaño real; los bytes que el backend no ha
      inspeccionado no se sirven nunca); cola `jobs` con `SKIP LOCKED`; Sharp a WebP; reaper de
      huérfanos; `/m/*` por tipo; `open` devuelve `width`/`height`/`lqip`.
- [ ] **E — Planes/cuotas/volatilidad** · planes Prueba/Pro/Bóveda, caducidades 7/14 días, máx. pases
      simultáneos, **cron de purga** (reutiliza la cola `jobs` de D).
- [ ] **F — Facturación manual (Bizum/PayPal)**: código VISTTA-XXXX, /api/admin/activate-plan, auditoría.
- [ ] **G — Frontend Angular**: viewer con CDK; bento pipe (dimensiones reales desde BD, que D provee);
      vistas de login/register/reset, dashboard, /billing, /admin; accesibilidad + Lighthouse.
- [ ] **H — Producción/escalado**: Clean Architecture; VPS + Docker + Caddy + PostgreSQL; Cloudflare
      delante; R2 (nueva implementación del puerto `Storage`, no una reescritura); CI/CD, backups.
- [ ] **I — Cumplimiento**: RGPD (art. 28, RAT, EIPD), AUP + notice-and-takedown.

## 3. Fallos conocidos, a corregir dentro de D

Auditados y verificados el 2026-09-01. No son teóricos.

1. **El token del pase acaba en los logs.** `src/index.ts:20` registra el pathname, y la ruta es
   `/api/open/:token`. Cualquier 500 escribe una credencial de un solo uso. Usa `c.req.routePath`.
2. **IDOR entre inquilinos, explotable hoy.** `MediaItemSchema` no restringe `key`; `/api/open/:token`
   firma cualquier clave que haya en las secciones; `/m/*` la sirve sin comprobar propiedad. Un usuario
   puede poner en su perfil la clave de otro y servirla. **El bloque D es la corrección**: referenciar
   `media.id` con propiedad verificada en BD, nunca claves de almacenamiento en un JSON del usuario.
3. **Traversal latente** en `/api/media/*` (`src/routes/profiles.ts:113`): la autorización sale de
   `key.split("/")[1]` y el `decodeURIComponent` corre después de que `URL` normalice, así que `%2e%2e`
   sobrevive. Con R2 da 404; **con Supabase Storage pasa a ser IDOR real**.
4. **Ambigüedad de concatenación en la firma**: el payload `key\npassId\nexp` no delimita campos y
   `key` admite `\n`. Prefijo de longitud o hash por campo, y separar el dominio de firma de lectura
   del de escritura.
5. **La marca de agua no está en los píxeles**: hoy es un overlay CSS, así que "guardar imagen como"
   descarga el archivo limpio. Ver la decisión de arriba.
6. **`X-Forwarded-For` sin validar** (`src/lib/ratelimit.ts:23`): en Workers `CF-Connecting-IP` es de
   confianza; en Node detrás de un proxy, cualquiera puede falsificar la cabecera y saltarse todos los
   límites, incluido el del login.

## 4. Principios inviolables

- Consumo del pase atómico y de un solo uso.
- **Seguridad honesta**: nada de "protección" falsa ni promesas de impedir capturas. Lo real es marca
  de agua incrustada + URLs firmadas efímeras. Nunca vender el bloqueo del clic derecho como seguridad.
  Vetado en el copy: "protegido", "seguro frente a copias", "anti-captura", "DRM".
- Token y contraseñas hasheados; secretos fuera del repo; logs sin PII.
- `SUPABASE_SECRET_KEY` salta RLS: **toda la autorización multi-inquilino recae en el código**. RLS es
  la red, no la defensa.
- Tolerancia cero a CSAM y contenido no consentido. Producto neutro.
- Gratis y sin tarjeta en el MVP; tarjeta al pasar a pago (VPS + R2).

## 5. Definición de "cerrado"

- [ ] P0: la suite arranca y el CI pasa.
- [ ] D0: Node + Postgres + Argon2id, con el test de concurrencia del pase verde contra Postgres real.
- [ ] D: subida con límites verificados sobre bytes reales; marca incrustada; dimensiones en BD;
      los seis fallos de §3 corregidos y con test.
- [ ] Planes/cuotas + cron de purga. [ ] Facturación + admin.
- [ ] Frontend completo accesible. [ ] Legal (términos, AUP, RGPD) revisado.
- [ ] MVP validado (sin tarjeta) y, tras validar, producción en VPS + R2.
