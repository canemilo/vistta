# HANDOFF — Vistta · plan de cierre

> Se lee junto con CLAUDE.md al inicio de cada sesión. Al cerrar un bloque, vuelca lo estable a CLAUDE.md.
>
> **Al día el 2026-09-02, tras cerrar P0, D0, D, E, F, G, H e I.** El plan está completo, y
> después se han cerrado callejones que solo aparecieron usando la aplicación (ver §2.8). El backend es Node + Hono + PostgreSQL con
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
- **Puerto `Storage`** con cuatro adaptadores: R2, Supabase, disco (`fs`) y memoria.
- **Pruebas contra Postgres real.** `docker-compose.yml` en local, servicio de contenedor en el CI.
- Migraciones en dialecto PostgreSQL con `node-pg-migrate`, en el esquema `vistta` con RLS activada
  y sin políticas.
- **Medios con fila propia** (`vistta.media`): el contenido del perfil guarda `mediaId`, no claves de
  almacenamiento. Subida en dos pasos (reservar y confirmar), tipo detectado de los bytes reales,
  dimensiones y LQIP medidos al confirmar.
- **Marca de agua incrustada en los píxeles** con Sharp, por visita, al servir `/m/:mediaId`.
- **Cola `vistta.jobs`** con `FOR UPDATE SKIP LOCKED` y reaper de huérfanos, en el mismo proceso.
- **Planes** (`prueba`/`pro`/`boveda`) con sus límites en `src/lib/planes.ts`, congelado reversible
  de los perfiles que sobran y purga por antigüedad sobre la cola de D.
- **Administración de cuentas**: rol `admin` (solo por script), panel en `/admin`, suspensión
  reversible, borrado inmediato para el RGPD y auditoría de todo.
- **Facturación manual**: código VISTTA-XXXXXX, conciliación por un administrador, vencimiento de
  plan en la cola. Precios en `src/lib/planes.ts`, pendientes de decidir.
- **Cambio de contraseña por el propio cliente** (`PUT /api/panel/password`): exige la actual
  aunque haya sesión, cierra las demás sesiones y conserva la de quien la cambia, con límite por
  CUENTA. Sin ella, la temporal que entrega el administrador no se podía cambiar.
- **Frontend cerrado**: rejilla justificada con las dimensiones reales de la BD, ampliación de foto
  en el viewer, y accesibilidad medida (100 en el panel y en el documento).
- **Producción lista**: imagen de la API (bundle con esbuild, sin transpilador dentro), imagen del
  panel dentro de un Caddy, `compose.prod.yml` con base sin puerto publicado y migraciones en un
  servicio aparte, copias verificadas y restauradas, y adaptador de **R2** firmando SigV4 a mano.
- **El panel hace lo que el backend permite.** Se cerraron tres huecos en los que la capacidad
  existía en la API y ninguna pantalla la llamaba: crear perfiles según el plan, cerrar sesión y
  cambiar la contraseña. **Y el borrado de perfil**, que no existía en ninguna capa y convertía
  crear en un callejón sin salida.
- **Una cuenta de administrador no aterriza en el panel de cliente**: se la redirige a `/admin`,
  que es el reverso de lo que el panel de administración ya hacía con una sesión de cliente.
- **«He olvidado la contraseña»** por bandeja, no por correo: no se almacena el correo de nadie.
- **Identidad de marca** en las dos entradas: logo, marco con esquinas y el hilo azul→verde.
- **Documentación completa en `docs/`**: 11 documentos, 4 diagramas SVG y sus PDF, con
  `pnpm docs:verificar` para que un PDF no se quede atrás del texto en silencio.
- **166 tests de backend** contra Postgres real y **38 de frontend** en Chrome de verdad (Karma),
  los dos enganchados a `pnpm check` y al CI.

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
      purga en la cola de D, con las cifras del cliente ya aplicadas. Ver «Decisiones y desvíos en
      E», más abajo.
- [x] **F — Facturación manual + administración** — cerrado el 2026-09-01. `/api/admin/*` completo
      (listar, crear, editar, cambiar plan, reiniciar contraseña, suspender, reactivar, borrar) con
      auditoría de todo y panel en `/admin`; y el cobro: código `VISTTA-XXXXXX`, conciliación a mano
      de Bizum/PayPal y vencimiento del plan en la cola. Ver «Administración de cuentas» y
      «Facturación manual», más abajo.
- [x] **G — Frontend Angular** — cerrado el 2026-09-01. Rejilla justificada con las dimensiones
      reales que guarda D; ampliación de foto en el viewer; cambio de contraseña por el cliente;
      accesibilidad medida con Lighthouse sobre el build de producción (100 en el panel y en el
      documento del pase); primera prueba de frontend y su arnés en el CI. Ver «Decisiones y desvíos
      en G», más abajo.
- [x] **H — Producción/escalado** — cerrado el 2026-09-01. `Dockerfile` de la API y `Dockerfile.web`
      (Angular dentro de un Caddy); `compose.prod.yml` con los cuatro servicios; `deploy/Caddyfile`
      con TLS, CSP estricta y la reescritura de `X-Forwarded-For`; `src/storage/r2.ts` firmando
      SigV4 sin SDK; `scripts/backup.sh` con verificación antes de rotar; el CI construye y ARRANCA
      las dos imágenes; runbook en `DESPLIEGUE.md`. Ver «Decisiones y desvíos en H», más abajo.
      **Queda probarlo contra R2 y un VPS de verdad**: sin cuenta con tarjeta no se puede.
- [x] **I — Cumplimiento** — cerrado el 2026-09-01. Seis documentos en `legal/`, escritos contra el
      sistema real y no sobre plantilla: términos, privacidad, contrato de encargado del art. 28,
      política de uso aceptable con notice-and-takedown, registro de actividades del art. 30 y
      análisis del art. 35. La identidad del titular sale de la configuración (`GET /api/legal`) y
      la página `/legal` los sirve desde su única versión. Ver «Decisiones y desvíos en I».
      **Falta que un abogado los revise**, y las cuatro cosas de `legal/README.md`.

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

> **Cifras fijadas por el cliente el 2026-09-01** (1/3/10 perfiles · 5/30/ilimitado pases a la vez ·
> 70 MB/200 MB/1 GB por perfil · 7/15 días/nunca de retención). Siguen viviendo solo en
> `src/lib/planes.ts`. **Queda una sin decidir**: `GRACIA_CONGELADO_MS`, cuánto sobrevive un perfil
> congelado antes de borrarse, hoy en 30 días. Es el plazo más delicado del proyecto, porque cuando
> vence se destruye trabajo de un cliente sin vuelta atrás.

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

**«Ilimitado» y «nunca» son `null`, no números grandes.** Bóveda no topa los pases simultáneos y no
caduca; las dos cosas se escriben como ausencia de límite y el código se salta la comprobación
entera. Escribirlas como una cifra alta funcionaría hoy y fallaría el día que alguien la compare o
la sume. Hay un test por cada una, y los dos se ponen rojos si se sustituye el `null` por un número.

**Dos protecciones de la purga que conviene no quitar sin leer**: no toca un medio que esté en la
instantánea de un pase todavía abrible (ese enlace ya salió y tiene que seguir enseñando lo que
prometía), y no aplica una retención nueva a contenido anterior al plan actual (`plan_since`), para
que bajar de Bóveda no evapore el archivo esa misma noche. Las dos tienen test y las dos se han
verificado por mutación.

## 2.3. Administración de cuentas

Es la primera pieza que **rompe el aislamiento entre inquilinos a propósito**. Todo lo demás está
construido sobre que ninguna cuenta ve la de al lado; un administrador sí. Lo que sostiene que eso
sea aceptable:

**El rol no se concede por ninguna ruta HTTP.** Ni siquiera para otro administrador. Se da con
`pnpm admin:create <id>`, desde la máquina que tiene la base. Un endpoint que otorgue admin
convierte cualquier fallo de autorización futuro en una toma de control completa.

**A quien no es admin se le responde 404, no 403.** Un 403 confirma que el panel existe y dónde.

**El admin gestiona cuentas, no contenido.** No hay ninguna ruta que le deje ver perfiles, medios ni
pases de un cliente, y el test lo comprueba sobre la respuesta real. Vistta es encargado del
tratamiento (RGPD art. 28), no espectador.

**Suspender y borrar son cosas distintas.** Suspender es reversible: bloquea el login, tira las
sesiones abiertas y cierra los pases vivos, pero no borra nada; pasada la misma gracia que los
perfiles congelados, la purga se lleva la cuenta. Borrar es inmediato e irreversible, existe para la
supresión del art. 17 del RGPD, y exige teclear el identificador de la cuenta.

**Las contraseñas no se leen: se generan.** Al crear una cuenta o reiniciarla, el servidor genera
una temporal y la enseña UNA vez. Usa un alfabeto sin caracteres que se confundan al dictarla por
teléfono (sin `l`/`1`/`i`, sin `o`/`0`, todo minúscula) y va en grupos de cuatro. Reiniciarla tira
todas las sesiones de esa cuenta: si se reinicia porque está comprometida, dejar viva la sesión del
que entró no arregla nada.

**Un administrador no puede suspenderse ni borrarse a sí mismo**: dejaría el sistema sin quien lo
administre y sin forma de arreglarlo desde el panel.

**`admin_audit` no tiene claves ajenas, y no es un descuido.** Es un registro de lo que PASÓ, y lo
que pasó no cambia porque después se borre una cuenta. Con una clave ajena habría que elegir entre
que CASCADE borrase el registro de un borrado justo al borrar, o que SET NULL perdiese quién lo hizo.

## 2.4. Facturación manual

> **PRECIOS PENDIENTES DE DECIDIR.** Están en `src/lib/planes.ts` (`PRECIOS`), en céntimos, junto al
> resto de cifras. Hoy: Pro 12 €/mes o 120 €/año, Bóveda 29 €/mes o 290 €/año. Cambiarlos no altera
> lo ya pedido: el importe se congela en la fila del pago al generar el código.

No hay pasarela. El cliente pide un plan, recibe un código `VISTTA-XXXXXX`, lo escribe en el
concepto de un Bizum o un PayPal, y una persona coteja el extracto y lo da por cobrado. Lo que
sostiene que eso no sea un coladero:

**El código no autoriza nada.** Viaja en el concepto de una transferencia: lo ve el banco y puede
acabar en una captura. Confirmar es una acción de administrador; el código solo dice a qué cuenta
corresponde un ingreso que ya se ha visto. Hay un test que comprueba que un cliente con su propio
código en la mano recibe 404.

**El importe se congela al pedirlo.** Si mañana suben los precios, quien pidió el código ayer paga
lo que se le dijo. Por eso `payments.importe` es una columna y no una consulta a la tabla de precios.

**Los periodos se encadenan.** Renovar antes de tiempo suma al periodo que quedaba, no lo reinicia:
adelantarse no puede costarle días al que paga. Cambiar de plan sí empieza de cero, porque es otro
producto.

**Vencer no borra nada.** El trabajo de la cola baja la cuenta a `prueba` y deja que el bloque E
congele los perfiles que sobren, que se recuperan pagando. Lo irreversible sigue siendo el tiempo.

**Los códigos sin pagar caducan a los 14 días.** Si no, alguien podría pagar dentro de un año a
precio del año pasado.

**A dónde se paga sale de la configuración** (`BIZUM_TELEFONO`, `PAYPAL_DESTINO`), no del código.
Sin ninguno de los dos, pedir plan devuelve 503 en vez de dar un código que no lleva a ninguna parte.

## 2.5. Decisiones y desvíos en G

**La rejilla se calcula, no se cicla.** El plan hablaba de un «bento pipe» y lo que había era un
ciclo fijo: la foto 1 ocupa cuatro columnas y es 3/2, la 2 ocupa dos y es 3/4, y vuelta a empezar —
con la proporción REAL superpuesta encima. Tres reglas peleándose por la misma caja: ganaba la
última y una foto vertical acababa recortada dentro de un hueco apaisado. Ahora cada foto ocupa un
ancho proporcional a lo apaisada que sea y la fila se reparte entre las que caben: como todas crecen
en proporción a su ratio, acaban a la misma altura y la fila cierra exacta sin recortar ninguna.
Todo en CSS, sin medir el contenedor ni escuchar el `resize`. **Esto solo es posible porque D mide
`width`/`height` de los bytes reales al confirmar**; sin esas columnas no hay nada que calcular.

**La ampliación de foto es `<dialog>` nativo, no CDK.** El plan decía «viewer con CDK».
`showModal()` ya trae lo que se iba a buscar allí —atrapa el foco, cierra con Escape, tapa el fondo
y devuelve el foco al botón de origen— y cuesta cero bytes. El viewer es el único bundle que abre
alguien que no es cliente nuestro, probablemente desde el móvil: meterle el CDK entero por un
lightbox no sale a cuenta. Se recorre el documento COMPLETO y no la sección de la que se salió, y no
da la vuelta en los bordes: volver al principio sin avisar oculta que se ha llegado al final.

**No hay registro ni recuperación de contraseña, y no es un olvido.** El plan pedía
«login/register/reset». Desde F las cuentas las crea un administrador y las contraseñas se generan,
nunca se teclean: un formulario de alta pública contradiría eso, y un «he olvidado mi contraseña»
por correo exigiría un canal de correo que el MVP no tiene. Lo que sí faltaba —y ya está— es que el
cliente pueda cambiar la temporal que le entregan: sin eso, «cámbiala al entrar» era una
instrucción imposible de cumplir.

**Se estrenó el arnés de pruebas del frontend.** Estaba configurado en `angular.json` desde el
`ng new` y sin un solo test. Las seis primeras prueban la ampliación por el DOM en un Chrome de
verdad, y van en `pnpm check` y en el CI: un arnés que no corre solo se pudre. Verificadas por
mutación, como todo lo demás.

**El SEO de Lighthouse se queda en 63 y ahí se queda.** Lo único que falla es `is-crawlable`, o sea
el `noindex`, que está puesto a propósito y en tres sitios (`robots.txt`, la etiqueta del HTML y la
cabecera de la API). Un buscador que encontrara un pase y lo abriera lo consumiría, y el cliente al
que iba dirigido se encontraría un enlace muerto. Si alguien «arregla» ese 63, rompe el producto.

**Un fallo real que salió al tocarlo**: en el panel, el pie de foto y el botón de quitar pasaban
`$index` tanto como sección como como foto, así que editar una foto de la tercera sección tocaba la
primera. Y el botón de quitar era `sr-only`: existía solo para un lector de pantalla y ni siquiera
hacía lo que decía.

## 2.6. Decisiones y desvíos en H

**No se ha hecho el refactor a «Clean Architecture», y es deliberado.** Estaba escrito en el plan,
pero lo que hay ya es una arquitectura de puertos y adaptadores: `src/routes/*` son adaptadores de
entrada, `src/lib/*` es el dominio, `Db` y `Storage` son puertos con varias implementaciones, y nada
lee `process.env` salvo `server.ts`. Mover eso a carpetas llamadas `domain/`, `application/` e
`infrastructure/` cambiaría 40 archivos, invalidaría todo el historial de `git blame` y no arreglaría
ni un fallo. Si algún día aparece una razón concreta —un segundo adaptador de entrada, por ejemplo—
se hace entonces y por esa razón.

**La imagen no lleva transpilador.** El proyecto se ejecuta con `tsx` en desarrollo; en producción se
empaqueta con esbuild (`dist/server.js`, `dist/migrar.js`) y corre con `node` a secas. Arranca antes,
no hay que instalar dependencias de desarrollo en el servidor y la superficie es menor. Los binarios
nativos (Sharp, Argon2, pg) se quedan externos y siguen viniendo de `node_modules`.

**`packageManager` fijado a pnpm 9.15.9** en los dos `package.json`. Sin eso, corepack coge la última
dentro del contenedor; pnpm 10 bloquea los scripts de instalación y Sharp y Argon2 se quedan sin su
binario nativo. La construcción fallaba con un mensaje que no menciona ninguna de las dos cosas.

**El aviso de las fuentes de la marca de agua era cierto y hoy ya no lo es.** Se midió: quitando
`fontconfig` y las fuentes de la imagen, el texto del SVG **se sigue dibujando**, porque el libvips
que Sharp trae precompilado lleva su propia fuente de reserva; lo único que cambia es un
`Fontconfig error` por stderr. Se instalan igual —quitan ese error y la propiedad deja de depender de
un detalle interno de Sharp—, pero quien sostiene la garantía es `scripts/comprobar-fuentes.ts`, que
corre DENTRO de la construcción: si el texto no se dibuja, la imagen no llega a existir. El día que
se compile contra el libvips del sistema o se cambie a una base musl, el aviso vuelve.

**La firma de R2 se ha verificado contra un servidor que la valida.** `src/storage/r2.ts` implementa
SigV4 a mano, sin SDK de AWS: de él se usarían tres llamadas y arrastra decenas de dependencias a
una imagen que se despliega. Probado contra MinIO —sube, baja y borra con claves que llevan barras y
espacios— y por mutación: saltarse un paso de la derivación de la clave da 403, y firmar un cuerpo
vacío mandando bytes de verdad da 400 (o sea, `x-amz-content-sha256` cubre el cuerpo de verdad).
**Contra R2 no se ha probado**: hace falta una cuenta con tarjeta.

**Un fallo real que solo apareció levantando la pila entera.** Una variable de entorno opcional
VACÍA no es lo mismo que ausente para Zod: con `SUPABASE_URL=` y `PAYPAL_DESTINO=` en el `.env` —que
es exactamente como queda una plantilla rellenada a medias— la API entraba en bucle de reinicio
quejándose de una URL de Supabase que nadie había pedido usar. Arreglado en `config.ts` y fijado con
`test/config.spec.ts`. No se encuentra leyendo el código: hay que arrancarlo.

**La API no arranca si no llega a la base, y así se queda.** Antes se caía con un volcado de pila de
`pg`; ahora imprime el motivo y sale con código 1. Fallar rápido es lo correcto —una API sin base no
sirve y el orquestador reintenta—, pero tenía que decir por qué.

**`X-Forwarded-For` se REESCRIBE en Caddy, no se añade.** El backend se queda con la última entrada
(`client-ip.ts`), así que si Caddy acumulara lo que mandó el cliente, cualquiera podría fijar su
propia identidad y saltarse el límite del login mandando una distinta en cada intento. Y por eso el
Caddyfile NO declara `trusted_proxies`: se quiere que `{remote_host}` sea siempre el par real del
socket. Activar el proxy de Cloudflare obliga a cambiar dos cosas a la vez —la cabecera y el
cortafuegos del origen—, y está escrito en `DESPLIEGUE.md`.

**La CSP del panel es estricta en scripts y no en estilos.** Para poder poner `script-src 'self'` se
apagó `inlineCritical` en `angular.json`: Angular metía un `<style>` en línea y, peor, un
`onload="this.media='all'"`, que es un manejador en línea y habría exigido `'unsafe-inline'` en
scripts. En estilos sí se deja `'unsafe-inline'`, porque Angular inyecta los estilos de cada
componente como `<style>` al montar y la alternativa es un nonce por petición, que obliga a generar
el HTML dinámicamente. Un estilo inyectado no ejecuta código.

**La copia de seguridad se comprueba ANTES de rotar.** Si el volcado no se puede leer, el script sale
con error y no borra nada: al revés, una noche con la base caída se llevaría por delante las copias
buenas. Se ha restaurado de verdad —11 tablas y las filas vuelven—, no solo generado. **Los medios no
están en esas copias**: viven en R2.

## 2.7. Decisiones y desvíos en I

**Los documentos describen ESTE sistema.** No son una plantilla rellenada: el registro del art. 30
se escribió leyendo el esquema tabla por tabla, y por eso dice cosas que una plantilla no diría —que
no hay columna para el correo del cliente, que la IP se guarda hasheada, que la marca de agua no
lleva ningún dato del que mira—. Cuando cambie el esquema, cambian ellos.

**Tres hallazgos del inventario que conviene no perder**, porque son propiedades del diseño que hay
que conservar y que un cambio inocente puede destruir:

1. **No se almacena el correo ni el teléfono de los clientes.** No hay columna. Las cuentas las crea
   un administrador y el contacto ocurre fuera del sistema. Es minimización real, no declarada.
2. **La IP no se guarda en claro en ninguna tabla**: el límite de intentos guarda el SHA-256 de
   `ámbito:identidad`. Los documentos dicen que eso es **seudonimización y no anonimización**,
   porque el espacio de direcciones es enumerable. Decir lo contrario habría sido cómodo y falso.
3. **Vistta no sabe quién abre un pase.** No guarda identidad, correo, IP ni dispositivo del
   destinatario, y la marca de agua lleva el pase y la hora, no a la persona. Añadir analítica de
   aperturas obliga a rehacer el RAT, el contrato del art. 28 y la EIPD, en ese orden.

**La EIPD del art. 35 no es obligatoria, y el documento explica por qué.** Se examinan los tres
supuestos del art. 35.3 y los criterios de la AEPD uno a uno. Lo útil no es la conclusión sino el
razonamiento: la responsabilidad proactiva del art. 5.2 se demuestra con el análisis, no con el
veredicto. El análisis de riesgos se hizo igualmente, y hay dos con riesgo residual que **no se
puede bajar más**: que salga una copia del viewer (nada impide una captura) y que se suba contenido
ilícito (no hay detección automática, y es una decisión consciente que hay que revisar si el
servicio crece).

**La identidad del titular sale de la configuración, no del texto.** Misma razón que el teléfono del
Bizum: son datos del negocio, cambian sin que cambie el software y en el despliegue de otro no son
los mismos. `GET /api/legal` es **pública y sin sesión**, a propósito: quien necesita avisar de un
contenido suele ser alguien que no es cliente —la persona que aparece en una foto, o quien recibió
el enlace—, y exigirle una cuenta convertiría el procedimiento de retirada en un trámite imposible.

**Sin configurar, la aplicación lo dice.** Si faltan los cuatro datos, `/legal` avisa en grande de
que los documentos no están en vigor y los huecos salen como «(pendiente de configurar)». Enseñar un
aviso legal con los marcadores crudos parecería un error de programación; con el hueco relleno de
nada, parecería un texto vigente. Las dos cosas son peores que decirlo.

**Solo se publican cuatro de los seis.** El registro del art. 30 y el análisis del art. 35 son
internos. El copiador los deja fuera **por nombre**, no filtrando por extensión: copiar todo lo que
acabe en `.md` haría que el próximo documento interno que alguien escriba se publicase solo, sin que
nadie tomara esa decisión. Hay dos pruebas: una falla si un interno aparece en la lista de públicos,
y otra si se añade un documento a `legal/` sin clasificarlo en ninguna de las dos listas.

**Un enlace muerto no cierra un aviso.** La AUP lo dice porque es una particularidad de este
producto: un pase se abre una sola vez, así que cuando llegue una denuncia lo más probable es que el
enlace ya no funcione. El contenido puede seguir en la cuenta y volver a enviarse. Se actúa sobre el
contenido y sobre la cuenta, no sobre el enlace.

**El enlace legal está en la pantalla del DESTINATARIO**, no solo en el panel. Quien más
probablemente necesite el procedimiento de retirada es justamente quien no tiene cuenta.

## 2.8. Lo que apareció USANDO la aplicación

Todo lo de esta sección salió después de dar el plan por completo, y ninguna de estas cosas se
encuentra leyendo el código: hay que abrir el panel y usarlo.

**El patrón que se repitió tres veces: capacidad sin pantalla.** El backend permitía algo, `Api` lo
exponía, y ninguna plantilla lo llamaba. Pasó con el cambio de contraseña, con la creación de
perfiles y con el cierre de sesión. La comprobación que lo detecta es mecánica y está hecha: cruzar
los métodos de `Api` con sus usos, y los manejadores `protected` de cada componente con su
plantilla. **Hoy no queda ninguno**, y conviene repetirla al añadir una función.

**Crear sin poder deshacer es un callejón.** Al añadir la creación de perfiles quedó un límite que
contaba perfiles ACTIVOS sin forma de liberar una plaza: un perfil creado por error la ocupaba para
siempre, y con el plan Prueba encerraba la cuenta entera. Congelar no servía de sustituto porque la
purga se lleva un congelado pasada la gracia: ofrecerlo habría sido programar su destrucción sin
decirlo. Se añadió el borrado, con el nombre tecleado y avisando de que los pases ya enviados dejan
de abrirse.

**Un `<select>` con `[value]` no se sincroniza** cuando la opción acaba de aparecer: el perfil recién
creado quedaba seleccionado en el componente y el desplegable seguía enseñando el anterior. Va con
`ngModel`.

**Una cuenta de administrador no tiene perfiles**, porque `admin:create` borra el del alta. Sin
redirección, entrar por el panel de cliente montaba el editor sin nada detrás: se podía escribir y
no se guardaba. De paso, `admin:create` **se niega ahora a promover una cuenta que tenga contenido**;
antes lo dejaba sin ninguna pantalla desde la que llegar a él.

**Un derivado commiteado se queda viejo en silencio.** Los PDF de `docs/pdf/` están en el
repositorio, así que alguien puede corregir un documento y no regenerarlos, y semanas después enviar
a un cliente un PDF que ya no dice lo que dice el texto. Lo detecta `pnpm docs:verificar`, que
compara por hash del contenido —no por fecha, que git no conserva— y va dentro de `pnpm check`.

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

**Aviso para el bloque H — resuelto y matizado en H.** Se temía que la marca, que usa texto SVG,
saliera vacía en una imagen de contenedor sin fontconfig. Se midió sobre la imagen real y **no pasa**:
el libvips precompilado de Sharp lleva su propia fuente de reserva. Las fuentes se instalan igual y,
sobre todo, `scripts/comprobar-fuentes.ts` corre dentro de la construcción y la tumba si el texto no
se dibuja. La banda opaca de la capa sigue ahí como segunda red.

### Aprendizaje de F — el verde falso que ninguna mutación detectaba

El test del doble cobro pasaba **incluso quitándole las DOS protecciones** que lo impiden. No era el
motivo conocido de D0 —dos peticiones no se solapan—: era el pool de conexiones **frío**. La primera
llamada corría con la única conexión ya abierta y terminaba su transacción entera mientras las otras
quince seguían haciendo el saludo TCP con Postgres. Nunca coincidían, así que la carrera no ocurría
por mucho que el código estuviera mal.

La corrección es `calentarPool()` en `test/helpers.ts`, y va **antes de toda ráfaga**. El efecto se
midió: con las protecciones quitadas, el doble cobro pasa de 1 de 16 a 10 de 16. Se añadió también a
las cuatro ráfagas que ya existían y las cuatro pasaron a fallar más fuerte bajo mutación (el consumo
del pase, de 13 de 16 a 16 de 16; la cola, de 7 a 14; la cuota, de 12 a 10 de 10 posibles).

Y un matiz sobre cómo se leen estas mutaciones: el doble cobro tiene DOS defensas independientes
—el `SELECT … FOR UPDATE` y el `UPDATE … WHERE status = 'pendiente'`— y quitar una sola no rompe
nada, porque la otra tapa el hueco. Eso está bien en el código y es una trampa al verificar: si
quitas una defensa y el test sigue verde, no significa que el test sea malo. Hay que quitarlas todas.

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
      purga verificada por mutación (Bóveda no caduca ni topa pases, la gracia se respeta, un pase
      abierto protege sus medios). Cifras del cliente aplicadas; falta solo fijar
      `GRACIA_CONGELADO_MS`.
- [x] Admin: hecho y con test (rol solo por script, 404 a los no-admin, sin acceso al contenido,
      suspensión reversible, borrado confirmado, auditoría), y la facturación manual con él.
- [x] Frontend completo accesible: 100 de accesibilidad y 100 de buenas prácticas en Lighthouse,
      medido sobre el build de producción, en el panel y en el documento del pase.
- [x] Producción reproducible: las dos imágenes construyen y arrancan en el CI, la pila entera se
      ha levantado en local (Caddy con TLS, migraciones, API sana) y la copia de seguridad se ha
      restaurado de verdad. Falta el estreno contra R2 y un VPS.
- [~] Legal: los seis documentos existen, describen el sistema real y son coherentes con el código
  (`legal/`). **Falta la revisión de un abogado** y las cuatro tareas previas al lanzamiento de
  `legal/README.md`: rellenar el titular, fijar la jurisdicción del VPS y del bucket, guardar el
  contrato de encargado de cada proveedor y decidir la retención del log de acceso de Caddy.
- [ ] MVP validado (sin tarjeta) y, tras validar, producción en VPS + R2.
