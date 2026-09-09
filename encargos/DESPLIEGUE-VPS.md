# Instrucciones para Claude Code — Vistta en producción (VPS x86)

**Cambio de rumbo:** el destino ya **no** es Oracle Cloud Always Free (ARM). Se ha contratado un
**VPS Contabo Cloud VPS 6** (6 vCPU / 12 GB RAM / 200 GB SSD / 300 Mbit/s), arquitectura **x86_64**.

Esto **sustituye** a `DESPLIEGUE-ORACLE.md`, que queda obsoleto.

**Qué implica:** la arquitectura del VPS es la misma sobre la que el proyecto ya está ensayado en local,
así que **toda la adaptación a ARM sobra** y hay que deshacerla. Con 12 GB de RAM tampoco hacen falta
swapfile ni construir las imágenes fuera del servidor.

**Lo que NO cambia:** `compose.prod.yml`, `Dockerfile`, `Dockerfile.web` y `deploy/Caddyfile` funcionan
tal cual. R2, Supabase, backups, verificación y legal siguen igual que estaban planificados.

Trabaja por fases y **no pases de fase sin verificar la anterior**.

---

## Fase 0 — Revertir el trabajo de ARM/Oracle  · empieza AQUÍ

Se llegó hasta la Fase 3 del plan anterior. Antes de nada, deja el repositorio limpio.

1. **Inventaría primero, borra después.** Revisa `git log` y `git status` desde que empezó el plan de
   Oracle y **enséñame la lista** de lo que se creó o modificó. No borres nada hasta que lo confirme.
2. Candidatos a eliminar o revertir:
   - `docs/12-oracle-always-free.md` (y cualquier documento de Oracle, completo o a medias).
   - El apartado «Construir para ARM» añadido a `docs/11-puesta-en-produccion.md` §5.
   - `supportedArchitectures` en `.npmrc` / `pnpm-workspace.yaml`, si llegó a añadirse.
   - Límites `deploy.resources.limits` metidos en `compose.prod.yml` por la VM pequeña de Oracle:
     con 12 GB ya no hacen falta. Quítalos salvo que aporten algo por sí mismos.
   - Referencias a `--platform linux/arm64`, imágenes `:arm64`, Security List/NSG, Ampere A1
     o "out of capacity" en cualquier documento.
3. **Conserva lo que sigue siendo válido**, aunque naciera en ese plan:
   - La comprobación de **argon2** (hash + verify) si se convirtió en un `RUN` de la imagen: es una red
     de seguridad buena en cualquier arquitectura. **Mantenla**, solo quítale lo específico de ARM.
   - Cualquier corrección de un error real que se descubriera de camino.
4. Limpia también el entorno: imágenes `vistta-*:arm64` locales y cachés de buildx que ya no sirven.
5. Deja `docs/11-puesta-en-produccion.md` como estaba, salvo lo que se conserve del punto 3.

**Hecho cuando:** `git status` limpio, no queda ninguna mención a Oracle/ARM y `docs/11` vuelve a
describir el procedimiento x86 sin apartados huérfanos.

---

## Fase 1 — Guía del VPS  · rol infra-devops

Crea `docs/12-vps-produccion.md`, con el estilo de `docs/11` (comandos literales, y marcado explícito
de lo que no se ha ejecutado de verdad). Debe llevar de "VPS recién contratado" a "Docker funcionando":

1. **Acceso y endurecimiento** sobre Ubuntu 24.04:
   - Usuario no root (`adduser vistta && usermod -aG sudo vistta`).
   - **SSH solo por clave**: subir la clave pública, y después `PasswordAuthentication no`.
     (Contabo entrega la máquina con acceso por contraseña de root: cambiarlo es lo primero.)
   - Docker: `curl -fsSL https://get.docker.com | sh` y `usermod -aG docker vistta`.
   - `ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable`.
   - Actualizaciones de seguridad automáticas (`unattended-upgrades`).
   - Comprobar `docker run --rm hello-world` **sin sudo** antes de seguir.
2. **Disco:** los 200 GB son de sobra porque los medios van a R2. Documenta dónde vive `pgdata`
   y cuánto ocupa realmente el despliegue.
3. **Snapshots de Contabo:** el plan incluye 2. Documenta la norma: **hacer un snapshot antes de cada
   cambio de riesgo** (migrar a R2, actualizar mayor). Y deja claro que un snapshot **no sustituye**
   a `scripts/backup.sh`: uno es la máquina, el otro es la base.
4. **DNS:** en el registrador (dinahosting), `A @ <IP-DEL-VPS>` con TTL 300, quitando los registros del
   parking y **dejando `mail` intacto**. Verificar con `dig +short vistta.es` **antes** de levantar Caddy:
   sin DNS correcto, Let's Encrypt falla y limita los reintentos.
5. Nota honesta a incluir: Contabo tiene rendimiento más variable que otros proveedores ("CPU steal")
   y soporte más lento. Para esta carga es asumible; conviene saberlo.

**Hecho cuando:** el documento permite llegar a "Docker operativo y DNS resolviendo" sin buscar fuera.

---

## Fase 2 — R2 como almacén de medios  · roles backend + security

`STORAGE_DRIVER=r2` ya existe. **Aviso del repo: el adaptador nunca ha hablado con R2 real** (está
verificado contra MinIO). El objetivo de esta fase es reducir esa incertidumbre, no darla por buena.

1. `docs/13-migracion-a-r2.md`: bucket **privado y sin dominio público** (`vistta-medios`), token de API
   **Object Read & Write limitado a ese bucket**, y las cuatro variables (`R2_ACCOUNT_ID`,
   `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). Recomienda **región UE**, coherente con el VPS.
2. Script de verificación (`scripts/verificar-r2.ts`) que pruebe contra el bucket real el ciclo completo:
   **subir → servir firmado → borrar**, y falle con un mensaje legible.
3. Documenta la migración `fs → R2` (`rclone` / `aws s3 sync` contra
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`), avisando de que las claves de objeto deben coincidir
   con `media.file_path` de la base o los medios no se encontrarán.
4. Deja escrito donde no se pueda pasar por alto: **`MEDIA_SIGNING_KEY` no se cambia nunca**
   (invalida todas las URLs de medios ya emitidas, incluidos los pases abiertos en ese momento).

**Hecho cuando:** existe el script y la guía. **No** des la fase por buena hasta ejecutarlo contra R2 real,
con la comprobación de la Fase 5 delante y sin clientes dentro.

---

## Fase 3 — Supabase como base gestionada (opcional)  · roles backend + qa-testing

`docs/14-supabase-opcional.md`, como alternativa documentada, **no** como camino principal:

1. `DATABASE_URL` debe ser la del **Session pooler** (IPv4). La conexión directa `db.<ref>.supabase.co`
   resuelve solo por IPv6 y **falla** en muchos servidores.
2. Cómo desactivar el servicio `db` del compose y apuntar `api`/`migrar` a Supabase.
3. Límites del plan gratis: se **pausa a los 7 días sin actividad** y **no incluye backups**;
   `scripts/backup.sh` sigue siendo obligatorio.
4. **Por defecto: PostgreSQL en el propio VPS** (menos piezas, sin pausa, sin límites, y con 12 GB va sobrado).

**Hecho cuando:** ambas variantes están descritas y se sabe cuál es la de por defecto.

---

## Fase 4 — Despliegue reproducible  · rol infra-devops

1. `scripts/desplegar.sh` idempotente: `git pull` → `docker build` de las dos imágenes →
   `docker compose -f compose.prod.yml --env-file .env up -d` → esperar `healthy` → mostrar estado.
   `migrar` corre antes que `api` por dependencia declarada; no lo dupliques.
   Con 12 GB, **construir en el propio servidor es lo normal**: no hace falta plan alternativo.
2. `crontab` de `scripts/backup.sh` **y el procedimiento de restauración probado**. Una copia que nunca
   se ha restaurado no es una copia.
3. Deja preparado, **sin activar**, el paso a proxy de Cloudflare: el `deploy/Caddyfile` avisa de que con
   la nube naranja hay que leer `Cf-Connecting-Ip` en vez de `{remote_host}` **y** cerrar el origen a los
   rangos de Cloudflare. Si solo se hace una de las dos, se rompe el límite del login.

**Hecho cuando:** un despliegue completo es un solo comando y la restauración está escrita paso a paso.

---

## Fase 5 — Verificación y cierre  · roles qa-testing, security, compliance

1. Ejecuta la secuencia de `docs/11` §7 y confirma **el invariante**: abrir el pase dos veces da
   **200 y luego 410**. Si el segundo no da 410, **para y avisa**: es lo único que este producto promete.
2. Comprobación manual que ninguna máquina hace: subir una foto, generar un pase, abrirlo y ver
   **la marca de agua** encima.
3. Seguridad: cabeceras (CSP, `frame-ancestors`, `no-store`); que los logs no lleven la ruta real del pase
   (el token es una credencial); que las credenciales de R2 no aparezcan en logs ni en el bundle del Angular.
4. Cumplimiento — **antes de clientes reales**: rellenar `TITULAR_NOMBRE`, `TITULAR_IDENTIFICACION`,
   `TITULAR_DIRECCION` y `CONTACTO_LEGAL` (sin los cuatro, `/legal` avisa de que el despliegue no está
   configurado y la retirada de contenido no lleva a ninguna parte); fijar la jurisdicción en `legal/rat.md`
   (VPS en Alemania, bucket en UE); **guardar el contrato de encargado de Contabo y de Cloudflare**
   (subencargados, art. 28.4); y revisión de un abogado de los textos de `legal/`.

---

## Fase 6 — Documentación  · rol docs

Actualiza `README.md` con la ruta de producción real y enlaza `12-vps-produccion.md`,
`13-migracion-a-r2.md` y `14-supabase-opcional.md`. Borra cualquier resto de la ruta de Oracle.
Mantén el estilo del repo: comandos exactos y **marcado explícito de lo que no se ha ejecutado de verdad**.

---

## Subagentes

`.claude/` no está en el repositorio. Al terminar la Fase 0, créalo: `.claude/agents/` con siete
subagentes (`backend`, `frontend`, `security`, `infra-devops`, `qa-testing`, `compliance`, `docs`),
cada uno un `.md` con frontmatter (`name`, `description`, `tools`, `model`). Los de revisión
(`security`, `compliance`) **sin permiso de escritura**: solo leen y proponen. A partir de ahí, delega.

---

## Reglas que no se negocian

- **No inventes lo que no has ejecutado.** Marca lo no probado, como hace `docs/11`.
- **Ningún secreto en el repositorio.** El `.env` se crea en el servidor y está en `.gitignore`.
- **El rol de administrador nunca se concede por HTTP**, solo desde la imagen, en la máquina con la base.
- **No prometas** que se impide una captura de pantalla; lo real es marca de agua por visita + URLs firmadas.
- **Tolerancia cero** a CSAM y a contenido no consentido; el procedimiento de retirada debe llevar a un
  contacto real y atendido.
- Cambios pequeños y verificables; si algo no se puede probar aquí, dilo en vez de darlo por hecho.

---

## Variables del `.env` (referencia)

```
DOMINIO=vistta.es
ACME_EMAIL=<tu-correo>
BASE_URL=https://vistta.es
POSTGRES_USER=vistta
POSTGRES_DB=vistta
POSTGRES_PASSWORD=        # openssl rand -base64 32
MEDIA_SIGNING_KEY=        # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  (NO se cambia nunca)
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=vistta-medios
BIZUM_TELEFONO=
PAYPAL_DESTINO=
TITULAR_NOMBRE=
TITULAR_IDENTIFICACION=
TITULAR_DIRECCION=
CONTACTO_LEGAL=
IMAGEN_API=vistta-api:latest
IMAGEN_WEB=vistta-web:latest
```

## Empieza por aquí

Lee la Fase 0 y **enséñame el inventario** de lo que se creó o modificó durante el plan de Oracle
(`git log`, `git status`) antes de borrar nada. No toques el repositorio hasta que lo confirme.
