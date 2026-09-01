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
- **Límites de medios**: imagen 10 MB, PDF 15 MB, **vídeo 50 MB** (el plan gratuito de Supabase topa
  el fichero; verificar la cifra antes de fijarla). 200 MB por pase. El tamaño **declarado** por el
  cliente no vale nada: se valida contra los bytes reales al confirmar la subida.
- Validación: Zod. Pruebas: Vitest contra **Postgres real** (servicio de contenedor en CI, Docker en
  local). **pg-mem queda descartado**: es monohilo y sin MVCC, así que el test del consumo atómico del
  pase pasaría aunque el UPDATE estuviera mal. Un verde falso sobre el invariante del producto.
  **Un motor real no basta**: el test tiene que provocar la carrera de verdad. Dos peticiones
  simultáneas no la provocan (se comprobó: un consumo mal hecho las pasaba). Hace falta una ráfaga.
  Deploy MVP: host Node sin tarjeta (p. ej. Render) o VPS; frontend en Cloudflare Pages.

> Nota de decisión: se descarta D1 para el MVP. D1 es gratis y sin tarjeta, pero el proyecto va a Postgres
> en producción; usar Supabase/Postgres desde el inicio evita la migración D1→Postgres. El peaje de tarjeta
> estaba en R2, no en D1: por eso los medios del MVP van en Supabase Storage.

## Invariantes de concurrencia — los tres se prueban con RÁFAGA

Son tres, no uno, y los tres fallan igual: dos peticiones simultáneas casi nunca se solapan, así
que un test de dos pasa aunque el código esté mal. Hacen falta ~16 y romper el código a propósito
para ver el test en rojo antes de darlo por bueno.

1. **Consumo del pase**: un único UPDATE condicional (abajo).
2. **Reserva de cuota**: la fila del perfil se bloquea con `SELECT … FOR UPDATE` dentro de la
   transacción. Sin eso, 12 de 16 reservas de 50 MB entran contra una cuota de 200 MB.
3. **Toma de trabajos de la cola**: `FOR UPDATE SKIP LOCKED` en una sola sentencia. Con "leer y
   luego marcar", 7 de 16 trabajadores se llevan el mismo trabajo.

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
