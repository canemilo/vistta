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
- **Límites de medios**: imagen 10 MB, PDF 15 MB, **vídeo 50 MB** (el plan gratuito de Supabase topa
  el fichero; verificar la cifra antes de fijarla). 200 MB por pase. El tamaño **declarado** por el
  cliente no vale nada: se valida contra los bytes reales al confirmar la subida.
- Validación: Zod. Pruebas: Vitest contra **Postgres real** (servicio de contenedor en CI, Docker en
local). **pg-mem queda descartado**: es monohilo y sin MVCC, así que el test del consumo atómico del
pase pasaría aunque el UPDATE estuviera mal. Un verde falso sobre el invariante del producto. Deploy MVP: host Node sin tarjeta
  (p. ej. Render) o VPS; frontend en Cloudflare Pages.

> Nota de decisión: se descarta D1 para el MVP. D1 es gratis y sin tarjeta, pero el proyecto va a Postgres
> en producción; usar Supabase/Postgres desde el inicio evita la migración D1→Postgres. El peaje de tarjeta
> estaba en R2, no en D1: por eso los medios del MVP van en Supabase Storage.

## Invariante crítico — uso único atómico (PostgreSQL)
El pase se consume UNA sola vez y el consumo es ATÓMICO con un único UPDATE condicional:
    UPDATE passes SET status='consumed', consumed_at=$1
    WHERE token_hash=$2 AND status='pending' AND expires_at > $1;
Solo la primera petición válida obtiene rowCount = 1; el resto queda denegado (usado/caducado/inexistente).

## Seguridad (no negociable)
- Token opaco de 128 bits; en BD solo su **hash SHA-256** (nunca el token en claro).
- Cabeceras: CSP, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- Medios solo por URL firmada y efímera; **marca de agua incrustada en los píxeles**, por visita
  (Sharp al servir). Un overlay CSS no cuenta: "guardar imagen como" descarga el archivo limpio.
- `SUPABASE_SECRET_KEY` **salta RLS**: toda la autorización multi-inquilino recae en el código de la
  API. RLS es la red de seguridad, no la defensa. La clave secreta nunca sale del proceso Node; la
  publicable puede ir al navegador.
- Auth del panel: Argon2id + sesiones opacas con TTL + rate limit; a futuro passkey/WebAuthn.
- **Seguridad honesta**: NUNCA prometer que se evita una captura; NO vender el bloqueo de clic derecho
  como protección. Secretos fuera del repo. Logs sin PII.

## Cumplimiento
- RGPD: usuario = responsable; Vistta = encargado (art. 28).
- AUP con notice-and-takedown; **tolerancia cero** a CSAM y a contenido no consentido.

## Cómo trabajar aquí
- Delega en el subagente adecuado: backend, frontend, security, infra-devops, qa-testing, compliance, docs.
  **Ojo: `.claude/` con esos 7 subagentes no está en el repo** (nunca se commiteó). Hasta que se
  reponga, hay que darle el rol al agente en el propio prompt.
- Commits pequeños; una responsabilidad por módulo (arquitectura limpia).
- El plan de trabajo pendiente vive en HANDOFF.md.
