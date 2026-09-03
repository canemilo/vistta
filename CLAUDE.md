# Vistta — memoria del proyecto

Vistta es una herramienta SaaS para **presentar trabajo** (portfolio, galería, documentos)
a un cliente concreto mediante un **enlace privado de un solo uso** que caduca al abrirse.

## Stack (decisión de datos: v1.2)

- TypeScript en todo el proyecto. Gestor: npm/pnpm.
- **Runtime backend: Node** (elegido porque Argon2id y Sharp no corren nativos en Workers).
- **Backend**: Node + Hono. **Base de datos: PostgreSQL** desde el MVP —**Supabase (gratis, sin tarjeta)**—
  y el mismo Postgres en producción (VPS), así no hay migración de motor.
- **Frontend**: Angular (standalone + signals) + Tailwind. Dos superficies: `viewer` público (ligero) y `panel`.
- **Medios (MVP)**: Supabase Storage con signed URLs (sin tarjeta). **Producción**: Cloudflare R2 (egress 0, requiere tarjeta al activar).
  En desarrollo local, `STORAGE_DRIVER=fs` deja los bytes en disco: con `memory` la siembra muere
  con su proceso y deja perfiles apuntando a nada.
- **Límites de medios por archivo**: imagen 10 MB, PDF 15 MB, **vídeo 50 MB** (el plan gratuito de
  Supabase topa el fichero; verificar la cifra antes de fijarla). La cuota por perfil ya no es una
  cifra fija: sale del plan (ver abajo). El tamaño **declarado** por el cliente no vale nada: se
  valida contra los bytes reales al confirmar la subida.
- Validación: Zod. Pruebas: Vitest contra **Postgres real** (servicio de contenedor en CI, Docker en
  local). **pg-mem queda descartado**: es monohilo y sin MVCC, así que el test del consumo atómico del
  pase pasaría aunque el UPDATE estuviera mal. Un verde falso sobre el invariante del producto.
  **Un motor real no basta**: el test tiene que provocar la carrera de verdad. Dos peticiones
  simultáneas no la provocan (se comprobó: un consumo mal hecho las pasaba). Hace falta una ráfaga.
  Deploy MVP: host Node sin tarjeta (p. ej. Render) o VPS; frontend en Cloudflare Pages.

> Nota de decisión: se descarta D1 para el MVP. D1 es gratis y sin tarjeta, pero el proyecto va a Postgres
> en producción; usar Supabase/Postgres desde el inicio evita la migración D1→Postgres. El peaje de tarjeta
> estaba en R2, no en D1: por eso los medios del MVP van en Supabase Storage.

## Invariantes de concurrencia — se prueban con RÁFAGA, siempre

Ya son seis, y **todos los que se han buscado han aparecido**. Todos fallan igual: dos peticiones
simultáneas casi nunca se solapan, así que un test de dos pasa aunque el código esté mal. Hacen
falta ~16 y romper el código a propósito para ver el test en rojo antes de darlo por bueno.

**Y `await calentarPool()` antes de la ráfaga, sin excepción.** Con el pool de conexiones frío, la
primera petición corre con la única conexión abierta y termina su transacción entera mientras las
demás siguen haciendo el saludo TCP: no coinciden, y el test es un verde falso aunque el código esté
roto. Se descubrió en F, donde el test del doble cobro pasaba habiéndole quitado las DOS
protecciones. Medido: sin ellas, el doble cobro pasa de 1 de 16 a 10 de 16.

**Al verificar por mutación, quita TODAS las defensas.** Varios de estos invariantes tienen dos
independientes; quitar una y ver el test verde no dice que el test sea malo, dice que la otra tapó
el hueco.

1. **Consumo del pase**: un único UPDATE condicional (abajo).
2. **Reserva de cuota**: la fila del perfil bloqueada con `SELECT … FOR UPDATE` dentro de la
   transacción. Sin eso, 12 de 16 reservas de 50 MB entran contra una cuota de 200 MB.
3. **Toma de trabajos de la cola**: `FOR UPDATE SKIP LOCKED` en una sola sentencia. Con "leer y
   luego marcar", 7 de 16 trabajadores se llevan el mismo trabajo.
4. **Pases simultáneos** y 5. **perfiles del plan**: la fila de la CUENTA bloqueada. Sin eso, 10 de
   16 y 9 de 16 se cuelan.
5. **Confirmación de un pago**: `SELECT … FOR UPDATE` sobre la fila del pago Y `UPDATE … WHERE
status = 'pendiente'`. Sin las dos, 10 de 16 confirmaciones cobran el mismo código y suman el
   periodo diez veces. Esto es dinero.

La regla, a estas alturas, va al revés: si añades un contador con un tope, da por hecho que tiene
carrera. Escribe el `FOR UPDATE` y el test de ráfaga desde el principio.

## Invariante crítico — consumo atómico (PostgreSQL)

El pase se abre **las veces que diga su modo, ni una más**, y el consumo es ATÓMICO: un ÚNICO
UPDATE condicional que decide y contabiliza a la vez (`src/lib/pass.ts`). Nunca un `SELECT` del
contador y un `UPDATE` después: verificado por mutación, así se cuelan **15 de 16**.

Basta el UPDATE, sin `FOR UPDATE`, porque la petición que despierta del bloqueo de fila reevalúa su
WHERE contra la fila ya cambiada.

- **`unico` (por defecto) no ha cambiado**: 200 la primera vez, 410 la segunda. Es lo único que este
  producto promete y `docs/11` §7 lo comprueba en cada despliegue.
- `accesos` (N aperturas) y `ventana` (plazo desde la primera apertura) se añadieron después. Los dos
  llevan SIEMPRE ventana: un pase sin plazo se queda abrible para siempre, y la purga no borra los
  medios de un pase abrible —ese contenido quedaría inmovilizado contra la retención, para siempre—.

**Los dos plazos son distintos y se confunden**: `expires_at` es el plazo para la PRIMERA apertura;
`valido_hasta` es hasta cuándo se sigue abriendo, y se calcula AL ABRIR. Aplicar `expires_at` también
después rompe el modo ventana entero (el plazo por defecto son 15 minutos).

**Qué significa «abrible» se escribe UNA vez** (`pasAbribleSql`) y lo usan el consumo, el recuento de
pases del plan y la purga. Si divergen, la que se equivoca es la purga, y equivocarse ahí es borrar
una foto que un pase vivo todavía puede pedir.

## Seguridad (no negociable)

- Token opaco de 128 bits; en BD solo su **hash SHA-256** (nunca el token en claro).
- Cabeceras: CSP, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- Medios solo por URL firmada y efímera; **marca de agua incrustada en los píxeles**, por visita
  (Sharp al servir). Un overlay CSS no cuenta: "guardar imagen como" descarga el archivo limpio.
- **La fila manda, no el objeto.** Un medio existe porque hay fila en `vistta.media`, y la fila dice
  de qué perfil es. El JSON del perfil guarda `mediaId`, nunca claves de almacenamiento: con claves,
  un usuario podía escribir la de otro y el backend la firmaba. Y **lo que el backend no ha
  inspeccionado no se sirve nunca**: el tipo sale de los magic bytes, no del `Content-Type`.
- La firma de medios lleva **prefijo de longitud por campo** y **dominio separado para lectura y
  escritura**. Concatenar con un separador no basta: si un campo admite ese separador, dos juegos de
  campos distintos producen el mismo mensaje.
- Servir un medio exige **tres** cosas: firma válida, fila en `pass_media` (la instantánea del pase)
  y `status='ready'`. La firma sola no basta —era el IDOR entre inquilinos—.
- `SUPABASE_SECRET_KEY` **salta RLS**: toda la autorización multi-inquilino recae en el código de la
  API. RLS es la red de seguridad, no la defensa. La clave secreta nunca sale del proceso Node; la
  publicable puede ir al navegador.
- Auth del panel: Argon2id + sesiones opacas con TTL + rate limit; a futuro passkey/WebAuthn.
- **Seguridad honesta**: NUNCA prometer que se evita una captura; NO vender el bloqueo de clic derecho
  como protección. Secretos fuera del repo. Logs sin PII.

## Planes y volatilidad (desde E)

- Las CIFRAS de los planes viven solo en `src/lib/planes.ts`. Ninguna ruta, consulta ni trabajo de
  la cola lleva un número escrito a mano: cambiar de oferta comercial es editar ese archivo.
  Fijadas por el cliente el 2026-09-01:

  |                | Prueba | Pro     | Bóveda    |
  | -------------- | ------ | ------- | --------- |
  | Perfiles       | 1      | 3       | 10        |
  | Pases a la vez | 5      | 30      | ilimitado |
  | Cuota/perfil   | 70 MB  | 200 MB  | 1 GB      |
  | Retención      | 7 días | 15 días | nunca     |

- **«Ilimitado» y «nunca» se escriben como `null`, jamás como un número grande.** Un tope enorme
  sigue siendo un tope y alguien acabará comparándolo, sumándolo o dividiéndolo. El código se salta
  la comprobación entera cuando es `null`, y hay un test por cada uno que se pone rojo si alguien
  los traduce a cifras.
- El contenido de este producto **caduca**: es para enseñar trabajo, no para alojarlo. `Bóveda` es
  el plan sin caducidad.
- Ojo al cruzar cifras: la cuota de Prueba (70 MB) es menor que dos vídeos al máximo (50 MB). Es
  coherente, pero si el tope por tipo llegara a superar la cuota de un plan, ese plan no podría
  aceptar ni un archivo de ese tipo.
- **Pasarse de un límite nunca borra nada por sorpresa.** Lo que sobra se congela (reversible,
  `lib/congelado.ts`), el cliente elige qué deja activo y el cambio intercambia en vez de rechazar.
  Solo agotada la gracia entera se borra, y eso vive aparte en `lib/purga.ts`.
- La purga no toca un medio que esté en la instantánea de un pase todavía abrible, ni aplica una
  retención nueva a contenido anterior al plan actual (`users.plan_since`).

## Administración (desde F)

La única parte del sistema que **se salta el aislamiento entre inquilinos a propósito**. Reglas que
no se negocian:

- **El rol `admin` NO se concede por ninguna ruta HTTP**, ni siquiera a otro admin. Solo
  `pnpm admin:create <id>`, desde la máquina que tiene la base. Un endpoint que otorgue admin
  convierte cualquier fallo de autorización futuro en una toma de control completa.
- **404, no 403**, a quien no es admin: un 403 ya confirma que el panel existe.
- **El admin gestiona cuentas, no contenido.** No hay ni debe haber ruta que le enseñe perfiles,
  medios o pases de un cliente. Vistta es encargado del tratamiento, no espectador.
- **Un administrador NO TIENE PERFILES**, y el panel se apoya en ello: `admin:create` borra el
  perfil del alta, y **se niega a promover una cuenta que tenga contenido** —ese trabajo se quedaría
  sin ninguna pantalla desde la que llegar a él—. Entrar por el panel de cliente con una sesión de
  administrador **redirige** a `/admin`, que es el reverso de lo que ya hacía el panel de
  administración con una sesión de cliente. Se redirige y no se da error: las credenciales son
  correctas y el rol es real, lo que no encaja es la pantalla, y solo ocurre tras demostrar el rol,
  así que no revela nada.
- **Suspender ≠ borrar.** Suspender es reversible (bloquea login, tira sesiones, cierra pases) y la
  purga se la lleva pasada la gracia. Borrar es inmediato, es para el art. 17 del RGPD, y exige
  teclear el identificador.
- **No hay recuperación de contraseña por correo, y no es un olvido**: no se almacena el correo de
  los clientes (no hay columna). «He olvidado la contraseña» deja una fila en `password_requests`,
  el administrador la ve marcada en la fila de esa cuenta y la atiende con el reinicio que ya
  existía; atenderla la cierra sola. La petición **no autoriza nada** —mismo criterio que el código
  de pago— y la ruta pública responde igual exista la cuenta o no, para no ser un comprobador de
  usuarios.
- **Las contraseñas se generan, no se leen ni se teclean.** Temporal de un solo uso, alfabeto sin
  caracteres confundibles al dictar. Reiniciarla tira todas las sesiones de esa cuenta.
- **Todo queda en `admin_audit`**, que no tiene claves ajenas: es historia, y no cambia porque
  después se borre la cuenta a la que se refiere.

## Facturación manual (desde F)

- **Los PRECIOS viven en `src/lib/planes.ts`**, en céntimos y enteros, con el resto de cifras. Hoy
  son provisionales. El importe se **congela** en la fila del pago al generar el código: cambiar la
  tabla no altera lo que ya se pidió cobrar.
- No hay pasarela. El cliente pide plan → recibe `VISTTA-XXXXXX` → lo pone en el concepto de un
  Bizum o PayPal → un administrador coteja el extracto y lo da por cobrado.
- **El código NO es un secreto ni autoriza nada**: viaja en el concepto de una transferencia.
  Confirmar es una acción de administrador; el código solo dice de quién es un ingreso ya visto.
- **Renovar antes de tiempo encadena** el periodo, no lo reinicia. Cambiar de plan sí empieza de
  cero: es otro producto.
- **Vencer no borra nada**: baja a `prueba` y el bloque E congela lo que sobre, recuperable pagando.
- A dónde se paga sale de la configuración (`BIZUM_TELEFONO`, `PAYPAL_DESTINO`), no del código. Sin
  ninguno de los dos, pedir plan devuelve 503 en vez de dar un código que no lleva a ningún sitio.

## Frontend (desde G)

- **Las proporciones salen de la BD, nunca de un ciclo fijo.** La rejilla del documento reparte cada
  fila con el `width`/`height` que D midió de los bytes reales: cada foto ocupa un ancho proporcional
  a su ratio, así que la fila cierra exacta y nada se recorta. Un ciclo de anchos por posición
  («la foto 1 ocupa cuatro columnas») vuelve a recortar la primera vertical que entre.
- **El viewer es el bundle que tiene que pesar poco**: lo abre alguien que no es cliente nuestro,
  desde el móvil y una sola vez. La ampliación de foto es `<dialog>` nativo por eso —`showModal()`
  atrapa el foco, cierra con Escape y devuelve el foco al origen, gratis—; no se mete el CDK.
- **No hay alta pública ni «he olvidado mi contraseña»**, y es coherente con F: las cuentas las crea
  un administrador y las contraseñas se generan. Lo que sí existe es que el cliente cambie la
  temporal (`PUT /api/panel/password`), que exige la actual y cierra las demás sesiones.
- **Nada se indexa, en tres sitios**: `robots.txt`, la etiqueta `robots` del HTML y la cabecera
  `X-Robots-Tag` de la API. Por eso el SEO de Lighthouse marca 63 y **debe seguir marcándolo**: lo
  único que falla es `is-crawlable`. Un buscador que abra un pase lo consume.
- Accesibilidad medida sobre el BUILD DE PRODUCCIÓN, no sobre `ng serve` (allí el rendimiento no
  significa nada): 100 de accesibilidad y 100 de buenas prácticas en el panel y en el documento.
- Hay pruebas de frontend (Karma + Chrome de verdad) y van en `pnpm check` y en el CI.

## Producción (desde H)

- **En producción no se transpila nada.** `pnpm build` empaqueta con esbuild a `dist/` y el
  contenedor corre `node dist/server.js`. `tsx` es solo de desarrollo y no entra en la imagen.
- **`packageManager` fijado a pnpm 9.15.9** en los dos `package.json`. Sin eso, corepack coge pnpm 10
  dentro del contenedor, que bloquea los scripts de instalación, y Sharp y Argon2 se quedan sin
  binario nativo con un error que no menciona ninguna de las dos cosas.
- **Una variable de entorno vacía es una variable ausente** (`config.ts`). Un `.env` de despliegue
  deja las opcionales escritas y en blanco; para Zod `""` no es `undefined`, y la API entraba en
  bucle de reinicio. Hay prueba.
- **La API no arranca si no llega a la base**, a propósito, pero sale con motivo legible y código 1.
- **`X-Forwarded-For` lo REESCRIBE Caddy, no lo añade**: el backend se queda con la última entrada,
  así que acumular lo del cliente le dejaría elegir su identidad y saltarse el rate limit. Por eso el
  Caddyfile no declara `trusted_proxies`. Poner Cloudflare delante obliga a cambiar DOS cosas a la
  vez: la cabecera y el cortafuegos del origen (ver `DESPLIEGUE.md`).
- **CSP: estricta en scripts, `'unsafe-inline'` en estilos.** Para lo primero se apagó
  `inlineCritical` en `angular.json` (metía un `<style>` y un `onload=` en línea); lo segundo es
  inevitable mientras Angular inyecte los estilos de componente al montar.
- **R2 se firma a mano** (`src/storage/r2.ts`), sin SDK de AWS. Se eligió R2 por el egreso: cada
  visita relee el original para marcarlo. Verificado contra MinIO y por mutación; **no contra R2**.
- **Las copias se comprueban antes de rotar**, y se han restaurado de verdad. **Los medios no están
  en ellas**: viven en R2.
- La comprobación de fuentes de la marca de agua corre DENTRO de la construcción de la imagen: si el
  texto SVG no se dibuja, la imagen no llega a existir.

## Cumplimiento (documentos desde I)

- RGPD: usuario = responsable; Vistta = encargado (art. 28). Los dos papeles conviven y **no se
  mezclan**: de los datos de la CUENTA Vistta sí es responsable.
- AUP con notice-and-takedown; **tolerancia cero** a CSAM y a contenido no consentido.
- Los documentos viven en `legal/` y **describen este sistema**, no una plantilla: se escribieron
  leyendo el esquema. Cuando cambie el esquema, cambian ellos.
- **Solo cuatro son públicos** (términos, privacidad, encargado, AUP). `rat.md` y `eipd.md` son
  internos; `scripts/copiar-legal.mjs` los excluye **por nombre**, no por extensión, y hay pruebas
  que fallan si alguien los publica o si añade un documento sin clasificar.
- Tres propiedades del diseño que los documentos declaran y que **no se pueden romper sin rehacer
  el RAT, el contrato del art. 28 y la EIPD**: no se guarda el correo ni el teléfono del cliente (no
  hay columna), la IP solo se guarda hasheada, y **Vistta no sabe QUIÉN ABRE un pase** —del navegador
  que abre no llega nada: ni identidad, ni IP, ni huella—.
- Ojo con la tercera, que se afinó al añadir el destinatario: el cliente **sí puede escribir a quién
  dice que se lo manda** (`passes.destinatario_ref`), y eso se incrusta en la marca. No es lo mismo
  que saber quién miró —un enlace reenviado lo abre otro y la marca sigue diciendo lo escrito—. Es
  dato personal de un TERCERO que introduce el cliente: opcional, nunca en logs, solo visible para el
  dueño del pase, y se borra con el pase. Registrar quién abre sigue vetado.
- La identidad del titular sale de la CONFIGURACIÓN (`GET /api/legal`, pública y sin sesión: quien
  avisa de un contenido no suele ser cliente). Sin los cuatro datos, `/legal` dice que no está
  configurado en vez de enseñar un aviso legal con huecos.

## Estructura del backend (desde D0)

- `src/server.ts` es lo único que habla con `process.env` y abre sockets; `src/app.ts` expone
  `createApp(deps)`. **En Node `c.env` NO son bindings**: las dependencias se inyectan al construir.
- Todo lo que toca la base recibe un `Db` (`src/db.ts`), no un pool: transacción y pool son
  intercambiables y las pruebas van contra Postgres real sin dobles.
- Los medios pasan por el puerto `Storage` (`src/storage/port.ts`). Cambiar a R2 en el bloque H es
  escribir otro adaptador, no reescribir rutas. Hay tres: `supabase`, `fs` (desarrollo) y `memory`
  (pruebas).
- La subida va en dos pasos: `POST /api/media/presign` reserva cuota y firma; `PUT /api/media/confirm`
  trae los bytes, los identifica, los mide y solo entonces los guarda. Son la misma petición a
  propósito: separarlas dejaría en el bucket objetos que nadie ha mirado.
- La cola (`vistta.jobs`) vive en Postgres, no en Redis. Hoy solo la usa el reaper de huérfanos.
- El esquema es `vistta`, nunca `public`: `public` es lo que Supabase expone por PostgREST.
- Las tablas se nombran cualificadas (`vistta.passes`) en todas las consultas.

## Cómo trabajar aquí

- Delega en el subagente adecuado. Los siete viven en `.claude/agents/` y ya están en el repo:
  `backend`, `frontend`, `security`, `infra-devops`, `qa-testing`, `compliance` y `docs`.
  **`security` y `compliance` solo leen y proponen**: no tienen `Write` ni `Edit`, y su parche va en
  la respuesta para que lo aplique otro. Cada definición lleva dentro los invariantes de su área, así
  que el rol ya no hay que explicarlo en cada prompt.
- Commits pequeños; una responsabilidad por módulo (arquitectura limpia).
- El plan de trabajo pendiente vive en HANDOFF.md.
