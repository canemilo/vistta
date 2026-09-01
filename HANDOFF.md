# HANDOFF — Vistta · plan de cierre

> Se lee junto con CLAUDE.md al inicio de cada sesión. Al cerrar un bloque, vuelca lo estable a CLAUDE.md.
>
> **Al día el 2026-09-01, tras cerrar P0 y D0.** El backend ya es Node + Hono + PostgreSQL con
> Argon2id, y las pruebas van contra Postgres real. Antes de P0 este archivo daba por cerrados los
> bloques B y C describiendo un backend que no existía en el disco; ahora describe lo que hay.
> **Si vuelves a encontrar una discrepancia, gana el disco, no este archivo.**

## 0. Estado real (verificado en el árbol de trabajo)

- Backend **Node + Hono + PostgreSQL**. Cloudflare Workers, D1 y R2 han desaparecido del repo.
- `src/server.ts` es lo único que lee `process.env`; `src/app.ts` expone `createApp(deps)`.
- **Pase de un solo uso atómico**: portado a Postgres, con `RETURNING` sobre el UPDATE condicional.
- **Argon2id** (`@node-rs/argon2`) sustituye a PBKDF2. El hash PHC lleva salt y coste dentro, así
  que las columnas `salt` e `iterations` han desaparecido del esquema.
- **Puerto `Storage`** con adaptador en memoria (pruebas) y de Supabase Storage por REST.
- **Pruebas contra Postgres real**: 39 tests. `docker-compose.yml` en local, servicio de contenedor
  en el CI.
- Migraciones en dialecto PostgreSQL con `node-pg-migrate`, en el esquema `vistta` con RLS activada
  y sin políticas.

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

- [x] **P0 — Higiene** — cerrado el 2026-09-01. Línea base verde desde la que migrar:
      migraciones `0002`/`0003` reconstruidas y verificadas contra el SQLite local; `package.json`
      con sus scripts y devDependencies (el lockfile ya los traía, así que `--frozen-lockfile`
      fallaba); `vitest.config.ts` con `nodejs_compat`, `r2Buckets: ["MEDIA"]` y `MEDIA_SIGNING_KEY`;
      `nodejs_compat` de vuelta en `wrangler.toml`. Dos roturas más que el CI también tocaba y que
      el plan no había registrado: `eslint` no tenía globales de Node para `scripts/*.mjs`, y
      `web/src/app/panel/panel.html` seguía pidiendo un `pin` que el componente ya no tiene (era
      del login viejo; ahora usa usuario + contraseña, como `Api.login`).
- [x] **B+C — rehechos dentro de D0**: cuentas, sesiones, perfiles, contenido y pases existen ya
      sobre Postgres, con sus tests.
- [x] **D0 — Node + Postgres + Supabase** — cerrado el 2026-09-01. `config.ts` con Zod; `db.ts` con
      `pg` e interfaz `Db`; migraciones Postgres; `pass`/`ratelimit`/`auth` portados; `@hono/node-server`
      con `createApp(deps)`; Argon2id; arnés contra Postgres real; puerto `Storage` con adaptador
      Supabase y en memoria. **Los 5 tests de firma vuelven a verde**, y con ellos los otros 34.

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

## 3. Fallos conocidos

Auditados el 2026-09-01. Tres se cerraron en D0 porque el propio salto a Node los empeoraba;
los otros tres siguen abiertos y son el bloque D.

**Cerrados en D0**

1. ~~El token del pase acaba en los logs.~~ `src/app.ts` registra `c.req.routePath`, el patrón, no
   la URL: un 500 en `/api/open/:token` ya no escribe la credencial.
2. ~~Traversal en `/api/media/*`.~~ La clave se valida contra una forma exacta
   (`u/<perfil>/<archivo>`) **antes** de tocar el almacenamiento. Se cierra en el código y no en el
   proveedor a propósito: con R2 una clave con `..` daba 404 por suerte, pero Supabase Storage
   normaliza la ruta y habría servido el objeto de otro.
3. ~~`X-Forwarded-For` sin validar.~~ `src/lib/client-ip.ts`: la cabecera solo se mira con
   `TRUST_PROXY=true`, y entonces se toma la última entrada, que es la que añade el proxy propio.
   Con `TRUST_PROXY=false` se ignora del todo. Cubierto por `test/client-ip.spec.ts`.

**Abiertos — son el bloque D**

4. **IDOR entre inquilinos.** `MediaItemSchema` no restringe `key`; `/api/open/:token` firma
   cualquier clave que haya en las secciones. Un usuario puede poner en su perfil la clave de otro
   y servirla. La corrección es referenciar `media.id` con propiedad verificada en BD, nunca claves
   de almacenamiento en un JSON del usuario.
5. **Ambigüedad de concatenación en la firma**: el payload `key\npassId\nexp` no delimita campos y
   `key` admite `\n`. Prefijo de longitud o hash por campo, y separar el dominio de firma de
   lectura del de escritura.
6. **La marca de agua no está en los píxeles**: hoy es un overlay CSS, así que "guardar imagen
   como" descarga el archivo limpio. La corrección es Sharp al servir.

### Aprendizaje de D0, que vale para todo lo que venga

El test de concurrencia del pase **era un verde falso**. Probar contra Postgres real es necesario y
no suficiente: dos peticiones simultáneas casi nunca se solapan, y se comprobó midiendo —con el
consumo reescrito a "leer y luego escribir", las dos peticiones seguían pasando—. Con una ráfaga de
16 el fallo aparece: 13 de 16 consumían el pase. Antes de dar por bueno un test de un invariante,
rómpelo a propósito y comprueba que se pone rojo.

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

- [x] P0: la suite arranca (33 tests verdes) y el CI pasa entero en local.
- [x] D0: Node + Postgres + Argon2id, con el test de concurrencia del pase verde contra Postgres real
      **y verificado por mutación** (se rompe el consumo a propósito y el test se pone rojo).
- [ ] D: subida con límites verificados sobre bytes reales; marca incrustada; dimensiones en BD;
      los tres fallos que siguen abiertos en §3 corregidos y con test.
- [ ] Planes/cuotas + cron de purga. [ ] Facturación + admin.
- [ ] Frontend completo accesible. [ ] Legal (términos, AUP, RGPD) revisado.
- [ ] MVP validado (sin tarjeta) y, tras validar, producción en VPS + R2.
