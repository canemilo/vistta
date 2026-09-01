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

Ya son cinco, y **todos los que se han buscado han aparecido**. Todos fallan igual: dos peticiones
simultáneas casi nunca se solapan, así que un test de dos pasa aunque el código esté mal. Hacen
falta ~16 y romper el código a propósito para ver el test en rojo antes de darlo por bueno.

1. **Consumo del pase**: un único UPDATE condicional (abajo).
2. **Reserva de cuota**: la fila del perfil bloqueada con `SELECT … FOR UPDATE` dentro de la
   transacción. Sin eso, 12 de 16 reservas de 50 MB entran contra una cuota de 200 MB.
3. **Toma de trabajos de la cola**: `FOR UPDATE SKIP LOCKED` en una sola sentencia. Con "leer y
   luego marcar", 7 de 16 trabajadores se llevan el mismo trabajo.
4. **Pases simultáneos** y 5. **perfiles del plan**: la fila de la CUENTA bloqueada. Sin eso, 10 de
   16 y 9 de 16 se cuelan.

La regla, a estas alturas, va al revés: si añades un contador con un tope, da por hecho que tiene
carrera. Escribe el `FOR UPDATE` y el test de ráfaga desde el principio.

## Invariante crítico — uso único atómico (PostgreSQL)

El pase se consume UNA sola vez y el consumo es ATÓMICO con un único UPDATE condicional:

```sql
UPDATE vistta.passes SET status='consumed', consumed_at=$1
WHERE token_hash=$2 AND status='pending' AND expires_at > $1;
```

Solo la primera petición válida obtiene rowCount = 1; el resto queda denegado (usado/caducado/inexistente).

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
- **Suspender ≠ borrar.** Suspender es reversible (bloquea login, tira sesiones, cierra pases) y la
  purga se la lleva pasada la gracia. Borrar es inmediato, es para el art. 17 del RGPD, y exige
  teclear el identificador.
- **Las contraseñas se generan, no se leen ni se teclean.** Temporal de un solo uso, alfabeto sin
  caracteres confundibles al dictar. Reiniciarla tira todas las sesiones de esa cuenta.
- **Todo queda en `admin_audit`**, que no tiene claves ajenas: es historia, y no cambia porque
  después se borre la cuenta a la que se refiere.

## Cumplimiento

- RGPD: usuario = responsable; Vistta = encargado (art. 28).
- AUP con notice-and-takedown; **tolerancia cero** a CSAM y a contenido no consentido.

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

- Delega en el subagente adecuado: backend, frontend, security, infra-devops, qa-testing, compliance, docs.
  **Ojo: `.claude/` con esos 7 subagentes no está en el repo** (nunca se commiteó). Hasta que se
  reponga, hay que darle el rol al agente en el propio prompt.
- Commits pequeños; una responsabilidad por módulo (arquitectura limpia).
- El plan de trabajo pendiente vive en HANDOFF.md.
