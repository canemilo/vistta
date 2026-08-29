# Vistta — memoria del proyecto

Vistta es una herramienta SaaS para **presentar trabajo** (portfolio, galería, documentos)
a un cliente concreto mediante un **enlace privado de un solo uso** que caduca al abrirse.

## Stack

- TypeScript en todo el proyecto. Gestor de paquetes: pnpm.
- **Frontend**: Angular (standalone + signals) + Tailwind. Dos superficies por rutas:
  `viewer` público (bundle mínimo) y `panel` de gestión.
- **Backend (MVP)**: Cloudflare Workers + Hono. Estado del pase en Durable Objects o D1.
  Perfil en KV. Medios en R2 + Images/Stream con URLs firmadas.
- **Backend (producción, fase 2)**: API Node/Hono en contenedor sobre VPS (Chequia/UE) +
  PostgreSQL + almacenamiento S3/MinIO, con Cloudflare (DNS/CDN/WAF/TLS) por delante.
- Validación: Zod. Pruebas: Vitest (+ @cloudflare/vitest-pool-workers), Miniflare, Playwright.
- Calidad: ESLint + Prettier. Deploy: Wrangler + GitHub Actions.

## Invariante crítico — uso único atómico

El pase se consume UNA sola vez y el consumo debe ser ATÓMICO.

- D1/PostgreSQL: `UPDATE pases SET consumed=true WHERE id=$1 AND consumed=false RETURNING *;`
- Nunca dependas de KV (eventually consistent) para el consumo del pase.

## Seguridad (no negociable)

- Token opaco de 128 bits (`crypto.getRandomValues`); el estado vive en el servidor, no en la URL.
- Cabeceras: CSP estricta, `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.
- Medios solo por URL firmada y efímera; marca de agua por visita.
- Auth del panel: PIN + rate limit + bloqueo; a futuro passkey/WebAuthn.
- NUNCA prometer que se evita una captura de pantalla. Secretos fuera del repo. Logs sin PII.

## Cumplimiento

- RGPD: el usuario es responsable; Vistta es encargado (art. 28).
- AUP con notice-and-takedown; tolerancia cero a CSAM y a contenido no consentido.

## Cómo trabajar aquí

- Delega en el subagente adecuado según la tarea: backend, frontend, security,
  infra-devops, qa-testing, compliance, docs.
- Commits pequeños y descriptivos. Una responsabilidad por módulo (arquitectura limpia).

## Orden de construcción (MVP primero)

1. Esquema del pase + endpoints crear / abrir / consumir (atómico) con pruebas.
2. Viewer público que consume el pase y sirve medios firmados.
3. Panel de generación con autenticación.
4. Marca de agua + cabeceras de seguridad + rate limit.
5. Deploy en Cloudflare (free) y validar. Después, fase de producción (VPS Chequia/UE).
