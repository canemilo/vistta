# Instrucciones para Claude Code — Vistta: integración con CRM por webhooks

Conectar Vistta con el CRM que el agente ya usa (Witei, Inmovilla, HubSpot, Pipedrive, o Make/Zapier),
sin pedirle cambiar de herramienta. Dos direcciones:

1. **Entrantes:** el CRM le pide a Vistta que genere un pase (al mover un contacto de etapa, por ejemplo).
2. **Salientes:** Vistta avisa al CRM cuando el destinatario abre o **reabre** el dosier.

Los salientes son la pieza valiosa: es el termómetro de interés aterrizado donde el agente ya trabaja.

---

## AVISO: corrige el borrador antes de copiarlo

Este trabajo parte de un borrador previo cuyo SQL **no encaja con este repositorio** y fallaría al aplicar
la migración. Verificado contra `migrations/0001_esquema_inicial.sql`:

| El borrador usa | Este proyecto usa |
|---|---|
| `UUID PRIMARY KEY DEFAULT gen_random_uuid()` | **`TEXT PRIMARY KEY`** (id generado en la aplicación) |
| `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | **`BIGINT NOT NULL`** (epoch en ms) |
| `REFERENCES vistta.users(id)` con UUID | `users.id` y `profiles.id` son **TEXT** |
| `TEXT[]` para la lista de eventos | usa **JSONB** o tabla aparte, como el resto del repo |

Adapta todo a los tipos reales. Una FK con tipo distinto **no aplica**, no es un detalle de estilo.

También: el borrador propone `ALTER TABLE passes ADD recipient_ref`. Si ya existe `destinatario_ref`
de la marca de agua nominal, **no dupliques la columna**: reutilízala. Comprueba el estado real antes.

---

## Contexto verificado del repositorio

- `vistta.users`, `vistta.profiles`, `vistta.passes`: ids **TEXT**, fechas **BIGINT** (epoch ms).
- `vistta.jobs` ya existe (cola con `kind`, `payload`, `run_after`, `attempts`, `last_error`):
  **es el mecanismo para los envíos salientes**. No inventes otro.
- `src/lib/ratelimit.ts` ya existe: úsalo, no escribas otro limitador.
- Migraciones hasta `0006` (o donde esté el repo). Las nuevas, correlativas.
- Panel Angular con componentes standalone en `web/src/app/panel/`.

---

## Fase 1 — Webhooks entrantes (el CRM crea pases)

### 1.1 Datos

Dos tablas, con los tipos correctos:

```sql
CREATE TABLE vistta.webhooks_entrada (
  id             TEXT PRIMARY KEY,
  owner_id       TEXT   NOT NULL REFERENCES vistta.users (id)    ON DELETE CASCADE,
  profile_id     TEXT   REFERENCES vistta.profiles (id)          ON DELETE CASCADE,
  token_hash     TEXT   NOT NULL UNIQUE,   -- SHA-256; el token en claro solo se muestra al crearlo
  nombre         TEXT   NOT NULL,
  created_at     BIGINT NOT NULL,
  revoked_at     BIGINT,
  last_used_at   BIGINT
);
```

**Guarda el hash del token, no el token.** Es exactamente el criterio que ya sigue `passes.token_hash`
(«el token en claro solo existe en la URL, nunca en la BD»). Mantén esa coherencia: se enseña una vez al
generarlo y no se puede volver a ver.

### 1.2 Endpoint

`POST /api/webhooks/entrada/:token`

- Autentica **solo** por el token de la URL (el CRM no puede iniciar sesión). Por eso:
  - **Rate limit obligatorio** por token, con `src/lib/ratelimit.ts`.
  - Comparación del hash en **tiempo constante**.
  - Un token revocado responde igual que uno inexistente: **404 siempre**, sin distinguir.
- Cuerpo validado con Zod: `profileId` (o el fijado en el webhook), `destinatarioRef` opcional, y los
  parámetros de expiración que el proyecto ya soporte.
- **Respeta los límites del plan** (`src/lib/planes.ts`): un webhook no puede ser la puerta trasera para
  saltarse cuotas. Si el plan no da, 403 con motivo claro.
- Respuesta: el `url` del pase generado, para que el CRM lo guarde en la ficha del contacto.
- Registra `last_used_at` (útil para diagnosticar «no me funciona»).

### 1.3 Seguridad — esto es una superficie nueva expuesta

Este endpoint **crea recursos sin sesión**. Trátalo como tal:
- Que el token viaje en la URL implica que puede acabar en logs de terceros: por eso hash en BD,
  revocación fácil y `last_used_at` visible.
- Confirma que los logs del proyecto **no registran la ruta real** (ya registran patrón de ruta y tipo de
  error; verifica que este endpoint no rompe esa norma, igual que pasa con el token del pase).
- Añade un test: token revocado → 404; token válido de otro `owner_id` → no puede crear pases sobre
  perfiles ajenos.

---

## Fase 2 — Webhooks salientes (Vistta avisa al CRM)

### 2.1 Datos

```sql
CREATE TABLE vistta.webhooks_salida (
  id           TEXT   PRIMARY KEY,
  owner_id     TEXT   NOT NULL REFERENCES vistta.users (id) ON DELETE CASCADE,
  target_url   TEXT   NOT NULL,
  secret       TEXT,                    -- para firmar el envío (HMAC)
  eventos      JSONB  NOT NULL DEFAULT '["apertura","reapertura"]'::jsonb,
  activo       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   BIGINT NOT NULL,
  last_error   TEXT,
  last_sent_at BIGINT
);
```

### 2.2 Envío: por la cola, nunca en línea

**El envío no puede ocurrir dentro de la petición de apertura del pase.** Si el CRM del agente tarda o
está caído, el comprador se quedaría esperando a que cargue el dosier. Encola un job en `vistta.jobs`
(`kind: 'webhook_salida'`) y que el worker lo envíe.

- **Reintentos con espera creciente** y un máximo; `jobs` ya tiene `attempts` y `last_error`, úsalos.
- **Tiempo de espera corto** por petición.
- Firma la carga con HMAC-SHA256 en una cabecera (`X-Vistta-Firma`) e incluye marca de tiempo, para que
  el CRM pueda verificar y descartar reenvíos.
- Tras N fallos, marca `activo = FALSE` y **avisa al agente en el panel**: un webhook roto en silencio es
  peor que no tenerlo.

### 2.3 SSRF: el agente escribe una URL arbitraria

Esto es lo más delicado de toda la funcionalidad. Tu servidor va a hacer peticiones a una dirección que
escribe el usuario, **desde dentro de tu red**. Sin controles, alguien puede apuntar a `localhost`, a la
red interna o a los metadatos del proveedor.

Obligatorio:
- **Solo `https://`**.
- **Rechazar IP privadas y locales** (127.0.0.0/8, 10/8, 172.16/12, 192.168/16, 169.254/16, `::1`, etc.)
  **resolviendo el DNS y comprobando la IP**, no solo mirando el texto de la URL.
- **No seguir redirecciones** (o revalidar el destino en cada salto).
- Sin credenciales del servidor en la petición.

Añade tests con `http://localhost`, `http://169.254.169.254` y un dominio que resuelva a IP privada.

### 2.4 Qué se envía — el límite que no se cruza

La carga lleva: id del pase, propiedad, tipo de evento, marca de tiempo y la referencia del destinatario
**que el propio agente introdujo**.

**No envíes las métricas detalladas de lectura** (tiempo por sección, ranking) a un sistema de terceros.
Una cosa es que el agente vea en su panel «reabrió ayer» y otra bombear el comportamiento de una persona
identificada a un CRM externo. Manda el evento y el enlace de vuelta al panel; el detalle se consulta en
Vistta.

Esto también hay que reflejarlo: el CRM del agente pasa a ser un **destinatario de datos**. Añádelo a
`legal/rat.md` y menciónalo en la interfaz («los avisos se envían al sistema que tú configures»).

---

## Fase 3 — Interfaz en el panel

Componente standalone `web/src/app/panel/ajustes/integracion-crm/`, como tarjeta en la configuración.

**Regla de lenguaje:** el agente no es técnico. Nada de «inbound», «payload» ni «endpoint». Usa
«conexión», «enlaces automáticos», «avisos de lectura».

**Sección A — Crear enlaces automáticamente desde tu CRM**
- Sin configurar: botón «Generar conexión».
- Configurado: campo de solo lectura con la URL, botón **Copiar** (usa `Clipboard` del CDK) con
  confirmación visual, y «Revocar» en secundario.
- Al generarla, avisa de que **la URL solo se muestra ahora** y actúa como una contraseña.
- Muestra el último uso: es lo primero que mira alguien cuando «no funciona».

**Sección B — Recibir avisos de lectura en tu CRM**
- Campo para la URL de destino y «Guardar conexión».
- Botón **«Enviar prueba»** que dispare un evento simulado: imprescindible, es lo que convierte
  «configurar un webhook» en algo que un comercial puede hacer solo.
- Si está desactivado por fallos, dilo claramente y ofrece reactivar.
- **Sin ayuda no sirve de nada:** enlaza una página breve con los pasos para Witei, HubSpot y Make.
  Un campo de URL sin instrucciones lo rellenan cero agentes.

**Estilo:** respeta el sistema de diseño que exista en el panel; no introduzcas una paleta nueva sin
comprobar antes qué usa el resto de la interfaz.

---

## Reglas transversales

- **Aislamiento por inquilino** en todas las consultas nuevas (`owner_id`), con test anti-IDOR.
- Migraciones correlativas y con los **tipos reales** (TEXT / BIGINT).
- Secretos y tokens **hasheados** en BD; nunca en logs ni en respuestas de la API.
- Nada de lógica de envío dentro de la petición del viewer.
- Actualiza `docs/` y `legal/` en la misma fase que el código.
- Si algo no se puede probar aquí, **dilo y márcalo**, como hace `docs/11`.

---

## Sobre el orden y la oportunidad

Los **salientes (Fase 2) valen mucho más** que los entrantes: «tu CRM te avisa cuando el inversor reabre
el dosier» es un argumento de venta; «tu CRM puede crear enlaces» es comodidad. Si hay que priorizar,
Fase 2 antes que Fase 1.

Y lo de siempre, dicho sin rodeos: esto es **una hipótesis sin validar**. Un agente que no usa las
automatizaciones de su CRM no va a configurar un webhook. Antes de construir las tres fases, conviene
preguntar a dos o tres agentes reales si usan Witei/Inmovilla con automatizaciones. Si la respuesta es
que no, esta funcionalidad es trabajo para nadie.

## Empieza por aquí

Lee `migrations/0001_esquema_inicial.sql`, `src/lib/jobs.ts` (o el worker), `src/lib/ratelimit.ts` y
`src/lib/planes.ts`. Confírmame: (1) los tipos que vas a usar en las tablas nuevas, (2) cómo piensas
bloquear el SSRF (§2.3), y (3) si ya existe `destinatario_ref` para no duplicarla.
**No toques código hasta que lo apruebe.**
