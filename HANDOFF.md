# HANDOFF — Vistta · plan de cierre

> Se lee junto con CLAUDE.md al inicio de cada sesión. Al cerrar un bloque, vuelca lo estable a CLAUDE.md.
>
> **Al día el 2026-09-01, tras cerrar P0, D0, D y E.** El backend es Node + Hono + PostgreSQL con
> Argon2id, los medios tienen fila propia y la marca de agua va incrustada en los píxeles. Antes de
> P0 este archivo daba por cerrados los bloques B y C describiendo un backend que no existía en el
> disco; ahora describe lo que hay.
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
- **Medios con fila propia** (`vistta.media`): el contenido del perfil guarda `mediaId`, no claves de
  almacenamiento. Subida en dos pasos (reservar y confirmar), tipo detectado de los bytes reales,
  dimensiones y LQIP medidos al confirmar.
- **Marca de agua incrustada en los píxeles** con Sharp, por visita, al servir `/m/:mediaId`.
- **Cola `vistta.jobs`** con `FOR UPDATE SKIP LOCKED` y reaper de huérfanos, en el mismo proceso.
- **Planes** (`prueba`/`pro`/`boveda`) con sus límites en `src/lib/planes.ts`, congelado reversible
  de los perfiles que sobran y purga por antigüedad sobre la cola de D.
- **87 tests** contra Postgres real. Adaptador `fs` del puerto `Storage` para desarrollo local.

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

- [x] **D — Medios** — cerrado el 2026-09-01. Migración `0002_medios` (`media`, `pass_media`,
      `jobs`); `presign` valida sesión, propiedad, tipo, tamaño y cuota **antes** de firmar;
      `confirm` inspecciona magic bytes y tamaño real; cola `jobs` con `SKIP LOCKED`; Sharp a WebP
      con la marca dentro; reaper de huérfanos; `/m/:mediaId` sirve por tipo; `open` devuelve
      `width`/`height`/`lqip`. Los tres fallos abiertos del §3 quedan cerrados y con test.
      Ver «Desvíos del plan en D», más abajo.
- [x] **E — Planes/cuotas/volatilidad** — cerrado el 2026-09-01. Migración `0003_planes`
      (`users.plan`/`plan_since`, `profiles.status`/`frozen_at`); límites de perfiles, pases
      simultáneos y cuota aplicados en los tres puntos donde se crea algo; congelado reversible;
      purga en la cola de D. Ver «Decisiones y desvíos en E», más abajo.
- [ ] **F — Facturación manual (Bizum/PayPal)**: código VISTTA-XXXX, /api/admin/activate-plan, auditoría.
- [ ] **G — Frontend Angular**: viewer con CDK; bento pipe (dimensiones reales desde BD, que D provee);
      vistas de login/register/reset, dashboard, /billing, /admin; accesibilidad + Lighthouse.
- [ ] **H — Producción/escalado**: Clean Architecture; VPS + Docker + Caddy + PostgreSQL; Cloudflare
      delante; R2 (nueva implementación del puerto `Storage`, no una reescritura); CI/CD, backups.
- [ ] **I — Cumplimiento**: RGPD (art. 28, RAT, EIPD), AUP + notice-and-takedown.

## 2.1. Desvíos del plan en D

Tres cosas salieron distintas de como estaban escritas en el plan, y las tres a propósito.

**Las dimensiones y el LQIP se calculan al confirmar, no en la cola.** Los bytes ya están en memoria
y Sharp ya está cargado; hacerlo ahí quita un estado entero —el medio `ready` del que aún no se sabe
cuánto mide— y deja que `ready` signifique siempre "inspeccionado Y medido". La cola se queda para
el reaper, que es trabajo que de verdad no cabe en una petición.

**La subida y la confirmación son la MISMA petición.** Si fueran dos, entre una y otra habría un
objeto en el almacenamiento que nadie ha mirado, y bastaría con no llamar a la segunda para dejarlo
ahí. El `presign` sigue siendo un paso aparte: es el que reserva cuota y firma.

**Se añadió un adaptador `fs` del puerto `Storage`.** No estaba en el plan, pero sin él
`pnpm setup:local` siembra en un almacén en memoria que muere con el proceso de la siembra, y deja
perfiles apuntando a bytes que ya no existen. Pon `STORAGE_DRIVER=fs` en tu `.env`.

## 2.2. Decisiones y desvíos en E

> **LAS CIFRAS DE LOS PLANES SIGUEN SIN DECIDIR.** Cuántos perfiles, cuántos pases a la vez y
> cuántos megabytes da cada plan está puesto a ojo y marcado como PROVISIONAL en
> `src/lib/planes.ts`. Ese es el único archivo que hay que tocar para fijarlas: ninguna ruta,
> ninguna consulta y ningún trabajo de la cola llevan un número escrito a mano. Lo que sí está
> decidido son los tres nombres, que Bóveda es el plan sin caducidad, y que pasarse de un límite
> nunca borra nada por sorpresa.

**Qué caduca**: el CONTENIDO del perfil, no el enlace. Pasada la retención del plan (7 días en
Prueba, 14 en Pro), el medio se borra del almacenamiento y de la base. En Bóveda no caduca nunca, y
de ahí el nombre. En el código eso es `retencionMs: null`, y `null` **no es cero**: la purga se salta
el plan entero en vez de traducirlo a un número. Hay un test que se pone rojo si alguien hace esa
traducción.

**Pasarse de un límite no borra nada.** Al bajar de plan, los perfiles que sobran quedan
`congelado`: siguen en la base con su contenido, no se editan, no generan pases y los pases que ya
tuvieran dejan de abrirse (410, el mismo que un pase usado: al cliente final no se le cuenta la
situación comercial de quien le mandó el enlace). El dueño elige cuál deja activo con
`POST /api/profiles/:id/activar`, que **intercambia** en vez de rechazar — con un plan de un solo
perfil, rechazar dejaría al cliente encerrado en el primero que creó. Subir de plan descongela solo.
Solo si un perfil agota entera la gracia se borra, y eso vive en `src/lib/purga.ts`, aparte de
`congelado.ts`, para que la parte reversible y la irreversible no se lean como si fueran lo mismo.

**Se añadió `POST /api/profiles`.** No estaba en el plan, pero sin una forma de crear perfiles el
límite de perfiles del plan no se puede ni aplicar ni probar.

**Dos protecciones de la purga que conviene no quitar sin leer**: no toca un medio que esté en la
instantánea de un pase todavía abrible (ese enlace ya salió y tiene que seguir enseñando lo que
prometía), y no aplica una retención nueva a contenido anterior al plan actual (`plan_since`), para
que bajar de Bóveda no evapore el archivo esa misma noche. Las dos tienen test y las dos se han
verificado por mutación.

## 3. Fallos conocidos

Auditados el 2026-09-01. Los seis están cerrados: tres en D0, porque el propio salto a Node los
empeoraba, y tres en D.

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

**Cerrados en D**

4. ~~IDOR entre inquilinos.~~ El contenido guarda `mediaId`, y al guardar el perfil cada id se
   contrasta contra `vistta.media`, donde consta de quién es; un id ajeno da 400 y no se guarda.
   Encima hay una segunda puerta: `/m/*` exige que el medio esté en `pass_media`, la instantánea que
   se tomó al crear el pase. Aunque alguien fabricase una firma válida, sin fila ahí no se sirve.
   Las dos puertas tienen su test, y las dos se han verificado por mutación.
5. ~~Ambigüedad de concatenación en la firma.~~ El payload lleva prefijo de longitud en bytes por
   campo, así que el separador ya no significa nada: los campos `("a\nb","c")` y `("a","b\nc")`
   producían el mismo mensaje y ahora no. Y hay dos dominios de firma —lectura y escritura—, así que
   una firma de lectura no verifica como una de subida aunque el resto del payload coincida.
6. ~~La marca de agua no está en los píxeles.~~ `/m/:mediaId` decodifica la imagen, le pinta encima
   el identificador de la visita y la reencodifica a WebP: lo que sale por el socket no son los
   bytes que subió el cliente. El overlay CSS del viewer se ha retirado. El vídeo y los PDF salen
   tal cual —marcarlos obligaría a recodificar en cada visita— **y el panel lo dice con esas
   palabras**, porque callarlo sería vender una protección que no existe.

**Aviso para el bloque H**: la marca usa texto SVG, que en una imagen de contenedor mínima sin
fontconfig saldría vacío. Por eso la capa lleva también una banda opaca: si faltan las fuentes, algo
queda incrustado igual. Aun así, la imagen de producción tiene que traer fuentes.

### Aprendizaje de E

Los invariantes de concurrencia ya son cinco, y **todos los que se han buscado han aparecido**. En E
salieron dos más: sin bloquear la fila de la cuenta, 10 de 16 peticiones se saltan el límite de
pases simultáneos y 9 de 16 el de perfiles. A estas alturas la regla es al revés de como se planteó
en D0: no es «comprobar si este contador tiene una carrera», es «este contador la tiene, escribe el
`FOR UPDATE` y el test de ráfaga desde el principio».

### Aprendizaje de D, que se suma al de D0

La cuota es el segundo invariante de concurrencia del proyecto, y falla igual que el primero: sin
bloquear la fila del perfil, dieciséis reservas simultáneas ven todas la misma suma y pasan doce
(600 MB sobre una cuota de 200). La toma de trabajos de la cola, igual: con "leer y luego marcar",
siete de dieciséis se llevan el mismo trabajo. Los dos tests son de ráfaga y los dos se han puesto
rojos a propósito antes de darlos por buenos.

Y un aviso sobre los tests que _no_ pinchan lo que parece: el caso "un contenido irreconocible se
rechaza" sigue verde aunque desactives el detector de firmas, porque lo rechaza Sharp al no poder
decodificarlo. Quien pincha el detector es el caso del PDF subido como imagen. Son dos defensas
distintas y conviene no confundirlas al tocarlas.

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
- [x] D: subida con límites verificados sobre bytes reales; marca incrustada; dimensiones en BD;
      los tres fallos del §3 corregidos y con test, verificados por mutación.
- [x] Planes/cuotas + cron de purga: límites aplicados con test de ráfaga, congelado reversible y
      purga verificada por mutación (Bóveda no caduca, la gracia se respeta, un pase abierto
      protege sus medios). **Pendiente: fijar las cifras de `src/lib/planes.ts`.**
- [ ] Facturación + admin.
- [ ] Frontend completo accesible. [ ] Legal (términos, AUP, RGPD) revisado.
- [ ] MVP validado (sin tarjeta) y, tras validar, producción en VPS + R2.
