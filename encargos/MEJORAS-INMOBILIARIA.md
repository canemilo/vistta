# Instrucciones para Claude Code — Vistta: inteligencia de dosier para inmobiliaria

Tres funciones que explotan el dato que **ningún CRM inmobiliario tiene**: qué mira el comprador dentro
del dosier. El CRM sabe a quién enviaste; Vistta sabe quién lo abrió, qué miró y quién volvió.

1. **Informe al propietario** — el entregable que justifica la comisión y defiende la exclusiva.
2. **Termómetro de interés** — a quién llamar hoy.
3. **Comparativa entre propiedades** — dónde merece la pena el esfuerzo.

**Antes de nada, lee esto:** las tres se apoyan en métricas de lectura que **todavía no existen**.
La Fase 0 las construye. Sin ella, las otras tres no tienen de dónde leer.

Orden obligatorio: **0 → 1 → 2 → 3**. Cada fase con sus pruebas antes de la siguiente.

---

## Contexto real del repositorio (verificado)

- `vistta.profiles` es el **dosier/propiedad**: `id`, `display_name`, `brand_color`, `data` (JSONB con
  las secciones), `owner_id` → `users`. **No existe** noción de propietario del inmueble ni de métricas.
- `vistta.passes`: `id`, `token_hash`, `profile_id`, `status`, `created_at`, `expires_at`, `consumed_at`.
- `vistta.pass_media` es la instantánea de medios del pase.
- `vistta.jobs` ya existe (cola con `kind`, `payload`, `run_after`): **úsala** para lo asíncrono, no
  inventes otro mecanismo.
- Migraciones hasta `0006`. Las nuevas van a partir de `0007` (o de donde esté el repo si ya avanzaste).
- Rutas del panel en `src/routes/panel.ts`; Angular con componentes standalone en `web/src/app`.

**Vocabulario:** en esta funcionalidad, un `profile` es **una propiedad**. No renombres nada; usa un
alias en la interfaz si hace falta.

---

## Fase 0 — Métricas de lectura útiles (base de todo)

No midas "tiempo total": es una métrica de vanidad que no dice qué hacer. Mide lo que responde a las
tres preguntas del agente: **¿lo ha abierto?, ¿qué le interesó?, ¿hay señal de compra?**

### 0.1 Datos (`00XX_metricas.sql`)

Tabla `vistta.pass_events`:
- `id`, `pass_id` (FK → `passes`, `ON DELETE CASCADE`), `ts` BIGINT,
- `tipo`: `'apertura' | 'seccion' | 'final'`,
- `seccion_idx` INTEGER NULL, `seccion_titulo` TEXT NULL (para no depender del índice si cambia el dosier),
- `ms_visible` INTEGER NULL.
- Índice por (`pass_id`, `tipo`).

**No guardes IP, user-agent, resolución ni nada que identifique el dispositivo.** El pase ya está
asociado a un destinatario concreto; añadir huella técnica no aporta y agrava el tratamiento.

### 0.2 Tiempo saneado — esto decide si el dato sirve o miente

Un dato que miente en una llamada de venta es peor que no tener dato. En el viewer:
- Cuenta solo con la **pestaña visible** (`visibilitychange`); si se va a otra pestaña, el reloj para.
- **Corta a los 60 s sin interacción** (scroll, toque, ratón): pestaña abierta ≠ atención.
- **Tope por sección** (p. ej. 300 s): descarta el resto en vez de acumular.
- Usa `IntersectionObserver` y envía **un resumen agregado** con `sendBeacon` al salir, más envíos
  periódicos si la sesión es larga. Nunca un evento por scroll.

### 0.3 Recogida

- `POST /api/passes/:token/eventos`: solo acepta eventos de un pase **abierto y vigente**, con rate limit
  propio y validación Zod (topes en `ms_visible`; un cliente manipulado no puede inyectar cifras absurdas).
- Un fallo enviando métricas **nunca** puede romper la visualización. Es telemetría, no funcionalidad.

### 0.4 Derivados que sí valen

Calcula y expón: **abierto sí/no**, **cuándo**, **nº de aperturas**, **tiempo hasta la primera apertura**
(el mejor indicador de temperatura), **ranking de secciones por atención**, **secciones saltadas** y
**si llegó al final**.

### 0.5 Transparencia (no opcional)

Aviso discreto en el viewer y mención en `legal/` de que se registra actividad de lectura agregada.
Añade el tratamiento a `legal/rat.md` con finalidad y plazo. Retención corta: los eventos se borran con
el pase (ya lo hace el `ON DELETE CASCADE`, verifícalo también en `purga.ts`/`reaper.ts`).

**Hecho cuando:** un pase abierto genera eventos, el tiempo saneado no supera los topes, y los derivados
salen correctos en una prueba con datos simulados.

---

## Fase 1 — Informe al propietario

**El problema que resuelve:** cada quince días el agente tiene la misma conversación incómoda con el
dueño del inmueble: *"¿por qué no se vende mi casa?"*. Hoy responde con impresiones. Esto le da datos.

### 1.1 Datos

En `vistta.profiles`, o en tabla aparte `vistta.propiedad_meta` (elige y justifica):
- `referencia` TEXT NULL (ref. interna del inmueble), `propietario_nota` TEXT NULL (para el agente),
- `exclusiva_desde` BIGINT NULL.

**No guardes datos personales del propietario** (nombre, email, teléfono): el informe se lo entrega el
agente, Vistta no necesita conocerlo. Menos datos, menos responsabilidad.

### 1.2 Agregación — la regla que no se salta

El informe es **agregado y anónimo**. Nunca aparece un destinatario concreto:

- ✅ «Enviado a 12 compradores · 9 lo abrieron (75%)»
- ✅ «El 70% se detuvo en Planos; solo 2 llegaron a Precio»
- ✅ «3 volvieron a abrirlo»
- ❌ «Juan Pérez estuvo 4 minutos» ← **prohibido**

Dos razones, y las dos importan: identificar compradores ante un tercero es un problema de protección de
datos, y además el agente **pierde su valor como intermediario** si el propietario ve a sus clientes.

**Umbral mínimo:** si hay **menos de 4 pases abiertos**, no generes porcentajes — con 2 datos, «el 50%»
es ruido estadístico presentado como hecho. Muestra los números absolutos y una nota de que aún hay pocos
datos.

### 1.3 Contenido del informe

Por propiedad y periodo (p. ej. últimos 30 días):
- Dosieres enviados, abiertos, y % de apertura.
- Tiempo medio de lectura (redondeado: «unos 3 minutos»).
- **Ranking de secciones**: qué se mira más y qué se salta. Es lo más accionable: si nadie llega a
  Precio, hay una conversación que tener.
- Relecturas (cuántos volvieron).
- Evolución respecto al periodo anterior, si hay datos.

### 1.4 Entrega

- `GET /api/profiles/:id/informe?desde=&hasta=` (solo el dueño del perfil; mismo criterio de autorización
  que el resto de `profiles`).
- Vista en el panel + **exportable a PDF con la marca del agente** (`brand_color`, nombre). Que el agente
  pueda reenviarlo tal cual es lo que hace que te recomiende.
- Genera el PDF con lo que ya hay en el proyecto; si hace falta trabajo pesado, encólalo en `vistta.jobs`.

**Hecho cuando:** un perfil con datos genera un informe correcto, el umbral funciona, y en ninguna salida
aparece un destinatario identificable.

---

## Fase 2 — Termómetro de interés

**El problema:** el agente no sabe a quién llamar hoy. El CRM sabe a quién envió; no sabe quién volvió a
abrirlo el domingo por la noche.

### 2.1 Señales, por fuerza

De más a menos predictiva:
1. **Relectura** (volver a abrir otro día) — la señal más fuerte.
2. **Llegar al final** del dosier.
3. **Atención concentrada** en una sección (planos, precio).
4. **Apertura rápida** tras el envío (minutos = caliente; días = frío).

### 2.2 Presentación

- Estados **cualitativos**, no una puntuación: «Caliente · reabrió ayer», «Tibio · lo abrió, no terminó»,
  «Frío · sin abrir hace 4 días».
- **Cada estado dice por qué.** Un número del 1 al 100 sin explicación no genera confianza ni acción.
- Lista ordenada «a quién llamar hoy» en el panel, con la razón al lado.
- **Nada de perfilado automático de personas**: describe el comportamiento sobre ese dosier, no juicios
  sobre el individuo («este comprador es indeciso» ← no).

### 2.3 Avisos

- Aviso al agente cuando alguien **reabre** un dosier (el momento de llamar).
- Agrupado y con límite: si un pase se abre cinco veces, un aviso, no cinco. Usa `vistta.jobs`.
- Configurable y desactivable. Si más adelante hay email, reutiliza el mecanismo existente.

**Hecho cuando:** el panel ordena los pases por temperatura con su razón visible, y la reapertura dispara
un aviso agrupado.

---

## Fase 3 — Comparativa entre propiedades

**El problema:** con varias exclusivas, el agente no sabe dónde invertir esfuerzo.

- Vista con una fila por propiedad: dosieres enviados, % de apertura, tiempo medio, % que llega al final.
- Ordenable. Marca lo que destaque **en positivo y en negativo**: «apertura muy baja» es tan útil como
  «la más vista» — sugiere que el problema está en cómo se envía, no en el inmueble.
- **Solo entre propiedades del mismo agente.** Nunca compares con datos de otros usuarios, ni agregados,
  ni anonimizados: es información comercial ajena.
- Mismo umbral de la Fase 1: sin datos suficientes, números absolutos y aviso, no porcentajes.

**Hecho cuando:** la vista compara correctamente y respeta el aislamiento por `owner_id`.

---

## Reglas transversales

- **Aislamiento por inquilino**: toda consulta nueva filtra por `owner_id`. Añade una prueba de que un
  usuario no ve informes ni métricas de otro (el patrón anti-IDOR del repo).
- **Redondea siempre** en la interfaz: «unos 40 segundos», no «42 s». La precisión al segundo no aporta
  valor comercial y sugiere una vigilancia que ni es exacta ni conviene enseñar.
- **Nada de datos personales nuevos en logs.**
- **No prometas exactitud**: el tiempo de navegador es aproximado. Que la interfaz diga «aproximado»
  donde toque, en la línea honesta del resto del producto.
- Migraciones correlativas, sin tocar las anteriores.
- Actualiza `docs/` y `legal/` en la misma fase que el código.
- Si algo no se puede probar aquí, **dilo y márcalo**, como hace `docs/11`.

---

## Advertencia sobre el orden

Estas tres funciones son una **hipótesis comercial sin validar**: que el agente inmobiliario pagará por
este dato. Antes de construir las tres enteras, lo sensato es tener la Fase 0 y la Fase 1 y **enseñárselas
a dos o tres agentes reales**. Si el informe al propietario no les entusiasma, las Fases 2 y 3 no
arreglarán eso y habrás invertido semanas.

## Empieza por aquí

Lee `migrations/0001_esquema_inicial.sql`, `src/lib/pass.ts`, `src/routes/profiles.ts` y
`web/src/app/viewer/`. Confírmame en pocas líneas: cómo piensas sanear el tiempo en el viewer (§0.2) y
si pones la metadata de propiedad en `profiles` o en tabla aparte (§1.1), con el motivo.
**No toques código hasta que lo apruebe.**
