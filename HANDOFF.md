# HANDOFF — Vistta · plan de cierre

> Se lee junto con CLAUDE.md al inicio de cada sesión. Al cerrar un bloque, vuelca lo estable a CLAUDE.md.

## 0. Estado actual (hecho)
- Backend Node + Hono + PostgreSQL. Migraciones 0001 (profiles, passes) y **0002 (clients, sessions,
  password_resets, auth_attempts, media, payment_requests + client_id/is_vaulted)**.
- Pase de un solo uso atómico + token hasheado + cabeceras + Zod.
- **Auth completa (bloque C)**: Argon2id, sesiones opacas con TTL (cookie httpOnly), register/login/logout,
  request-reset + reset-password de un solo uso, authMiddleware (inyecta client_id), **anti-IDOR**, **rate limit + bloqueo**.
- **8 tests en verde** (pase, auth, IDOR, rate limit, reset) con pg-mem + Argon2id real.
- Andamiaje: .claude/ (7 subagentes) + CLAUDE.md + slash command.

## 1. Decisiones (Bloque A)
- [x] Runtime = Node. [x] Datos = PostgreSQL/Supabase (sin tarjeta). [x] Medios MVP = Supabase Storage; R2 en producción.
- [ ] Subida directa a Storage (presigned/multipart) — pendiente (bloque D).
- [ ] Watermark de vídeo realista (overlay; no transcodificar por visita).
- [ ] Marca/paleta única en tailwind.config.js.

## 2. Bloques restantes
- [x] **B — Migración 0002** (hecho).
- [x] **C — Auth + multi-inquilino + IDOR + rate limit** (hecho).
- [ ] **D — Medios** · backend + infra-devops + security: subida a Storage con URL firmada; límites
  (img 10 MB, vídeo 100 MB, PDF 15 MB; 200 MB/pase); firma HMAC; procesado WebP con Sharp; watermark honesto;
  guardar dimensiones intrínsecas en BD.
- [ ] **E — Planes/cuotas/volatilidad** · backend: planes Prueba/Pro/Bóveda, cuotas, caducidades 7/14 días,
  máx. pases simultáneos, validación al crear pase, **cron de purga** (borra Storage + registros caducados no is_vaulted).
- [ ] **F — Facturación manual (Bizum/PayPal)** · backend: código VISTTA-XXXX, /api/admin/activate-plan, auditoría.
- [ ] **G — Frontend Angular** · frontend: tokens unificados; viewer con CDK (Overlay/Dialog) -> GET /v/:token;
  bento pipe (dimensiones desde BD); Scroll Snap; vistas login/register/reset, dashboard (contadores, cuota, días),
  /billing, /admin; fuente auto-alojada; accesibilidad + Lighthouse.
- [ ] **H — Producción/escalado** · infra-devops: Clean Architecture; VPS Hetzner CX32 + Docker Compose + Caddy +
  PostgreSQL; Cloudflare delante; R2 medios; CI/CD, staging, backups, observabilidad sin PII, IaC.
- [ ] **I — Cumplimiento** · compliance: RGPD (responsable/encargado art. 28, RAT, EIPD), AUP + notice-and-takedown.

## 3. Principios inviolables
- Consumo del pase atómico y de un solo uso. Seguridad honesta (nada de "protección" falsa ni promesas de
  impedir capturas; lo real: marca de agua por visita + URLs firmadas). Token/contraseñas hasheados; secretos
  fuera del repo; logs sin PII. Tolerancia cero a CSAM y contenido no consentido. Producto neutro.
  Gratis y sin tarjeta en el MVP (Supabase + Cloudflare Pages); tarjeta al pasar a pago (VPS + R2).

## 4. Definición de "cerrado"
- [x] Auth/IDOR con tests; rate limit activo.
- [ ] Subida a Storage con límites y firma; watermark honesto.
- [ ] Planes/cuotas + cron de purga. [ ] Facturación + admin.
- [ ] Frontend completo accesible. [ ] Legal (términos, AUP, RGPD) revisado.
- [ ] MVP validado (sin tarjeta) y, tras validar, producción en VPS + R2.
