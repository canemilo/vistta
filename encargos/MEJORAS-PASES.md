¡# Instrucciones para Claude Code — Vistta: pases flexibles, marca de agua nominal y métricas

Tres funciones nuevas, pensadas para el caso de uso inmobiliario/consultoría, donde el destinatario es
una persona identificada y el enlace acompaña una negociación de días, no un vistazo de un minuto.

**Léelas enteras antes de empezar.** Las tres tocan el núcleo del producto y la primera cambia un
invariante, así que el orden importa y hay decisiones que no debes tomar tú solo.

Orden obligatorio: **Fase 1 → 2 → 3**. Cada fase termina con sus pruebas en verde.

---

## Contexto: lo que ya existe (no lo rehagas)

- `src/lib/pass.ts` → `consumePass()`: **UPDATE atómico** `pending → consumed`, con un comentario que
  explica por qué es la única puerta. Devuelve `null` igual para "usado", "caducado" e "inexistente",
  a propósito, para no filtrar cuál era.
- `src/lib/media.ts` → `watermarkFor(passId, openedAt)`: devuelve `PASE · <8 chars> · HH:MM`.
- `src/lib/watermark.ts`: incrusta el texto con Sharp, por visita.
- `src/routes/passes.ts`: crear pase (`POST /api/passes`) y abrir (rate limit `pass-open`).
- Migraciones hasta `0006_solicitudes_clave.sql`. Las nuevas van a partir de `0007`.
- `docs/11-puesta-en-produccion.md` §7 comprueba el invariante **200 → 410**.

---

## Fase 1 — Modos de expiración: por accesos y por ventana de tiempo

Hoy un pase se abre **una vez**. Hay que permitir además:
- **N accesos** (p. ej. máximo 3), y
- **ventana de tiempo desde la primera apertura** (p. ej. válido 24 h tras abrirlo).

### 1.1 Lo que NO se toca

El pase de un solo uso **sigue siendo el modo por defecto** y su comportamiento no cambia: primera
apertura 200, segunda 410. Es lo único que este producto promete y `docs/11` §7 lo verifica.

### 1.2 Modelo de datos (migración `0007_modos_de_pase.sql`)

Sobre `vistta.passes`:
- `modo` — `'unico' | 'accesos' | 'ventana'`, **DEFAULT `'unico'`** (los pases existentes no cambian).
- `max_accesos` INTEGER NULL — solo para `'accesos'`.
- `accesos_usados` INTEGER NOT NULL DEFAULT 0.
- `ventana_ms` BIGINT NULL — solo para `'ventana'`.
- `primera_apertura_at` BIGINT NULL — se fija en la primera apertura.
- `valido_hasta` BIGINT NULL — calculado en la primera apertura (`primera_apertura_at + ventana_ms`).

`expires_at` **sigue significando lo mismo**: plazo para la *primera* apertura. Los modos nuevos añaden
un segundo límite **después** de abrirlo; no lo sustituyen. Documenta esa distinción en la migración,
porque es la fuente de confusión más probable.

### 1.3 El consumo sigue siendo atómico — esto es lo crítico

**No introduzcas un `SELECT` y luego un `UPDATE`.** Sería una condición de carrera: dos peticiones
simultáneas leerían el mismo contador y ambas pasarían. Todo se resuelve en **un único UPDATE
condicional** que decide y contabiliza a la vez, como el actual.

Guía (adáptala al SQL real del repo):

```sql
UPDATE vistta.passes
   SET accesos_usados      = accesos_usados + 1,
       primera_apertura_at = COALESCE(primera_apertura_at, $1),
       valido_hasta        = CASE WHEN modo = 'ventana' AND primera_apertura_at IS NULL
                                  THEN $1 + ventana_ms ELSE valido_hasta END,
       status              = CASE
                               WHEN modo = 'unico' THEN 'consumed'
                               WHEN modo = 'accesos' AND accesos_usados + 1 >= max_accesos THEN 'consumed'
                               ELSE status
                             END,
       consumed_at         = COALESCE(consumed_at, CASE WHEN /* mismos casos */ THEN $1 END)
 WHERE token_hash = $2
   AND status = 'pending'
   AND expires_at > $1
   AND (modo <> 'accesos' OR accesos_usados < max_accesos)
   AND (modo <> 'ventana' OR valido_hasta IS NULL OR valido_hasta > $1)
RETURNING id, profile_id;
```

Requisitos:
- Denegar **sigue devolviendo lo mismo** (`null` → 410) en todos los casos: usado, agotado, fuera de
  ventana, caducado o inexistente. No añadas mensajes que distingan.
- Un pase en modo `'ventana'` que agota su ventana debe quedar cerrado también para la purga; comprueba
  cómo lo trata `src/lib/reaper.ts` / `purga.ts` y ajústalo.

### 1.4 API y panel

- `CreatePassSchema` (en `src/schemas.ts`): acepta `modo` y sus parámetros, **validando la combinación**
  (`accesos` exige `max_accesos` entre 2 y un tope razonable; `ventana` exige `ventana_ms` con tope, p. ej.
  máximo 7 días). Rechaza combinaciones incoherentes con 400.
- El tope de accesos y de ventana **no puede exceder lo que permita el plan**; mira `src/lib/planes.ts`
  y respeta esa lógica. Si un plan no admite estos modos, el endpoint devuelve 403, no un pase silencioso.
- En el panel (Angular), al generar el pase: selector de modo con **«un solo uso» preseleccionado**, y
  texto que explique en una línea qué implica cada opción. Al listar pases, muestra el estado real
  («2 de 3 accesos», «caduca en 6 h»).

### 1.5 Pruebas (obligatorias antes de pasar de fase)

- Modo `unico`: 200 → 410 (el invariante de siempre, **debe seguir pasando tal cual**).
- Modo `accesos` con `max_accesos = 3`: 200, 200, 200, **410**.
- Modo `accesos`: **N peticiones concurrentes** con `max_accesos = 3` → exactamente 3 con 200. Esta es
  la prueba que justifica el UPDATE único; si falla, el diseño está mal.
- Modo `ventana`: dentro de la ventana abre; pasada la ventana, 410.
- Modo `ventana`: `expires_at` vencido y nunca abierto → 410 (el plazo de primera apertura sigue vivo).

---

## Fase 2 — Marca de agua con el destinatario

Hoy la marca lleva id de pase y hora. Añadir la **referencia del destinatario** (email o teléfono que
el agente escribe al generar el enlace) para que una captura filtrada sea atribuible a una persona.

### 2.1 Datos (migración `0008_destinatario.sql`)

En `vistta.passes`:
- `destinatario_ref` TEXT NULL — lo que el agente escribe (email o teléfono).
- `destinatario_nota` TEXT NULL — opcional, nombre para que el agente identifique el pase en su lista.

### 2.2 Marca de agua

- `watermarkFor()` pasa a aceptar la referencia y componer algo como
  `<destinatario> · PASE <8 chars> · HH:MM`. **Mantén la firma retrocompatible**: sin destinatario, el
  texto actual no cambia.
- Ojo al espacio: el comentario del código ya advierte de que el texto debe **caber incrustado**. Si la
  referencia es larga, **trúncala** (p. ej. 28 caracteres) en vez de dejar que se salga o se solape.
  Comprueba el resultado sobre una imagen real: esto se verifica **a ojo**, no hay test que lo detecte.
- Verifica que `src/lib/watermark.ts` escapa el texto: una referencia con `<`, `&` o comillas no puede
  romper el SVG que se compone para Sharp. **Añade un test con esos caracteres.**

### 2.3 Privacidad — esto no es opcional

El destinatario es **un dato personal de un tercero** que el cliente introduce. Implica:
- El **cliente** (el agente) es responsable de tener base para tratarlo; en `legal/` debe quedar dicho
  que al introducirlo declara estar legitimado. Coordina el texto con lo que ya hay en `legal/`.
- `destinatario_ref` **no puede aparecer en logs** (los logs registran método, patrón de ruta y tipo de
  error, y así debe seguir), ni en respuestas de la API salvo al propio dueño del pase.
- Debe **borrarse con el pase** en la purga, como el resto: revisa `purga.ts`/`reaper.ts`.
- Añádelo a `legal/rat.md` como categoría de datos tratada.

### 2.4 Qué NO se puede prometer

En el panel, describe la función como **disuasoria y de trazabilidad**. No escribas ni permitas escribir
que "impide" capturas o filtraciones: no las impide, las hace atribuibles. Mantén la línea honesta del
resto del producto.

---

## Fase 3 — Métricas de lectura

Que el agente sepa **cuánto y qué** miró el destinatario. Es la función más delicada de las tres en
privacidad, así que va con límites desde el diseño.

### 3.1 Datos (migración `0009_metricas.sql`)

Tabla `vistta.pass_events`:
- `id`, `pass_id` (FK), `ts` BIGINT, `tipo` (`'apertura' | 'seccion' | 'medio' | 'cierre'`),
  `seccion_idx` INTEGER NULL, `media_id` TEXT NULL, `ms_visible` INTEGER NULL.
- Índice por `pass_id`.
- **No guardes IP, user-agent ni nada que identifique el dispositivo.** El pase ya está asociado a un
  destinatario concreto (Fase 2); añadir huella técnica no aporta y agrava el tratamiento.

### 3.2 Recogida (viewer Angular)

- Usa `IntersectionObserver` para medir el tiempo visible por sección/medio y **envía un resumen
  agregado**, no un evento por scroll. Un `sendBeacon` al salir, más envíos periódicos si la sesión es larga.
- Endpoint `POST /api/passes/:token/eventos`: **solo acepta eventos de un pase abierto y vigente**
  (mismo criterio que la apertura), con rate limit propio, y **valida con Zod** (topes en `ms_visible`
  para que un cliente manipulado no inyecte cifras absurdas).
- Que un fallo al enviar métricas **nunca** rompa la visualización: es telemetría, no funcionalidad.

### 3.3 Presentación (panel)

- En el detalle del pase: tiempo total, tiempo por sección, y qué medios se miraron más.
- **Redondea**: «unos 4 minutos», «~40 s en la sección Planos». Nada de precisión al segundo — sugiere
  una vigilancia que ni es exacta ni es sana enseñar.
- Estado claro cuando no hay datos («aún sin abrir»), sin inventar ceros.

### 3.4 Privacidad y transparencia

- El destinatario **debe poder saberlo**: incluye en el viewer un aviso discreto y en `legal/` que se
  registra actividad de lectura agregada. No es aceptable medir a alguien sin decírselo.
- Retención corta y explícita: los eventos se borran con el pase, y en todo caso a los X días. Decide el
  plazo, escríbelo en `legal/rat.md` y aplícalo en la purga.
- Añade el tratamiento al RAT (finalidad, categorías, plazo).

---

## Reglas transversales

- **El modo `unico` no cambia.** Si al terminar `docs/11` §7 no da 200 → 410, algo se ha roto: para y avísame.
- Migraciones nuevas a partir de `0007`, sin tocar las anteriores.
- Cada fase, con sus pruebas en verde antes de la siguiente.
- Ningún dato personal nuevo en logs.
- Actualiza `docs/` y `legal/` en la misma fase que el código, no al final.
- Si algo no se puede probar aquí, **dilo y márcalo**, como hace `docs/11`.

## Empieza por aquí

Lee el contexto y `src/lib/pass.ts`, `src/lib/media.ts`, `src/lib/watermark.ts` y `src/schemas.ts`.
Confírmame en pocas líneas cómo piensas resolver el **UPDATE único de la Fase 1** (§1.3) y qué topes
propones para `max_accesos` y `ventana_ms`. **No toques código hasta que lo apruebe.**
