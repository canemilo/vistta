# Instrucciones para Claude Code — Vistta: rediseño del montaje de perfiles

**El problema:** montar un perfil resulta confuso. El usuario se enfrenta a un lienzo vacío y tiene que
decidir a la vez qué secciones crear, en qué orden, qué escribir y cómo presentar las fotos.

**El objetivo:** que alguien pueda tener un dosier presentable en **menos de cinco minutos**, partiendo
de una plantilla con estructura y estilo ya puestos, y modificando desde ahí.

---

## Diagnóstico (verificado en el repositorio)

**Lo que NO hay que cambiar — el modelo de datos ya es bueno:**

`src/schemas.ts` define `ProfileDataSchema` con `tagline`, `intro` y `sections`, y `SectionSchema` es una
unión discriminada de tres bloques: `texto`, `galeria` y `proyecto`, con `display: 'cuadricula' | 'carrusel'`
opcional. El comentario del propio código lo explica bien: _«el cliente solo escribe textos y sube fotos:
el orden y el tipo de bloque son toda la estructura que necesita decidir; el diseño lo monta el viewer»_.

Esa decisión es correcta. **No toques el esquema** salvo lo que se indique en la Fase 3, y respeta la
compatibilidad hacia atrás que ya existe (`bio`/`media` del formato antiguo se siguen aceptando).

**Dónde está el problema real:**

1. **Todo el panel es un solo componente gigante:** `web/src/app/panel/panel.html` tiene **1.537 líneas**
   y `panel.ts` **936**. Ahí conviven sesión, lista de perfiles, edición, medios, pases y ajustes. Eso hace
   que la interfaz muestre demasiadas cosas a la vez y que sea muy difícil de mejorar.
2. **No hay punto de partida:** existe contenido de demostración (`seed/demo.json`, `scripts/sembrar.ts`),
   pero el usuario real empieza con un perfil vacío y cero orientación.
3. **No hay previsualización:** se monta a ciegas y solo se ve el resultado generando un pase.

---

## Fase 1 — Plantillas de partida (lo que más resuelve, y lo más barato)

Antes de rediseñar nada, dale al usuario **algo ya montado que modificar**. Es el cambio con mejor
relación esfuerzo/resultado: ataca directamente el «no sé por dónde empezar».

### 1.1 Qué es una plantilla

Un `ProfileData` prerrellenado: `tagline`, `intro`, un `sections[]` con la estructura típica de ese uso,
títulos ya escritos y **textos de ejemplo claramente marcados como sustituibles**. Nada de datos nuevos
en la base: es contenido inicial, no un tipo nuevo.

Define entre 4 y 6, por caso de uso, no por sector cerrado:

| Plantilla                   | Estructura sugerida                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| **Dosier de propiedad**     | intro · galería (cuadrícula) · texto (características) · galería (planos) · texto (condiciones) |
| **Portfolio**               | intro · proyecto · proyecto · texto (sobre mí)                                                  |
| **Presupuesto / propuesta** | intro · texto (alcance) · galería (trabajos previos) · texto (condiciones)                      |
| **Catálogo**                | intro · galería (carrusel) · texto                                                              |
| **Desde cero**              | perfil vacío (la opción de siempre, que se mantiene)                                            |

Guárdalas como constantes tipadas en el frontend (`web/src/app/panel/plantillas.ts`), validadas contra
`ProfileDataSchema` **en un test**: si alguien cambia el esquema y una plantilla deja de validar, debe
saltar en CI, no en producción.

### 1.2 Cómo se elige

Al crear un perfil, **primero se elige plantilla**, con una miniatura de la estructura (no un render
completo) y una línea de para qué sirve. Después ya se rellena.

- «Desde cero» siempre presente y en último lugar.
- La plantilla **solo afecta al crear**. No hay «cambiar de plantilla» después: machacaría contenido.
  Si el usuario quiere otra estructura, añade y borra bloques a mano.
- Los textos de ejemplo deben ser evidentemente ejemplos (p. ej. «Describe aquí…»), y hay que **impedir
  publicar un pase con el texto de ejemplo intacto**, o alguien enviará el dosier con el relleno puesto.
  Un aviso claro antes de generar el pase es suficiente; no lo bloquees en duro.

**Hecho cuando:** crear un perfil desde plantilla deja un dosier presentable que solo requiere sustituir
textos y subir fotos, y las plantillas validan contra el esquema en un test.

---

## Fase 2 — Partir el panel

`panel.html` con 1.537 líneas es la causa de fondo. Sepáralo en componentes standalone, sin cambiar
comportamiento.

Estructura sugerida bajo `web/src/app/panel/`:

- `perfiles/` — lista y creación (aquí vive el selector de plantillas).
- `editor/` — edición de un perfil: `editor-cabecera`, `lista-secciones`, y un componente por tipo de
  bloque (`bloque-texto`, `bloque-galeria`, `bloque-proyecto`).
- `medios/` — subida y biblioteca.
- `pases/` — generación y listado.
- `ajustes/` — cuenta y plan.

Reglas:

- **Un refactor por commit**, moviendo el HTML tal cual antes de mejorarlo. Primero mover, luego mejorar:
  si haces las dos cosas a la vez, cualquier fallo es imposible de localizar.
- `panel.spec.ts` (880 líneas) tiene que **seguir pasando**; adáptalo, no lo borres.
- Estado compartido en un servicio, no pasando señales entre diez componentes.

**Hecho cuando:** ningún archivo del panel pasa de ~300 líneas y las pruebas siguen en verde.

---

## Fase 3 — El editor: que se entienda qué se está montando

Con el panel partido, arregla la experiencia de edición.

### 3.1 Estructura visible

- **Lista vertical de bloques** con el título y el tipo bien visibles («Galería · 8 fotos»), no un formulario
  interminable.
- **Reordenar arrastrando** (usa `@angular/cdk/drag-drop`, que ya está disponible en el ecosistema Angular
  del proyecto) y mover arriba/abajo con botones, que el arrastre en móvil es incómodo.
- **Colapsar bloques**: al editar uno, los demás encogidos. Es lo que quita la sensación de caos.
- Añadir bloque desde un botón claro con las tres opciones y una frase de qué es cada una.

### 3.2 Previsualización

Un botón **«Ver como lo verá el cliente»** que abra el mismo render del viewer con el contenido actual,
sin generar un pase. Hoy hay que crear un pase para ver el resultado, y eso es lo que hace que se monte
a ciegas.

Reutiliza el componente del viewer; no dupliques el render, o acabarán divergiendo.

### 3.3 Ayuda en contexto

- En cada bloque, una línea de cuándo usarlo («Proyecto: fotos + descripción, para un trabajo concreto»).
- Contadores de límites visibles (fotos por bloque, caracteres) **antes** de que el usuario choque con ellos.
- Estado de guardado explícito («Guardado», «Sin guardar»): la duda de si se ha guardado genera mucha
  desconfianza.

### 3.4 Estilo del perfil

Hoy solo hay `brand_color`. Si quieres «un estilo ya puesto que se pueda modificar», el cambio mínimo y
compatible es añadir a `ProfileDataSchema` un campo **opcional** `estilo` (p. ej. `'claro' | 'oscuro' | 'editorial'`)
que el viewer traduzca a su presentación.

Requisitos: **opcional y con valor por defecto**, exactamente como se hizo con `display` en las galerías
(el propio código explica que si fuera obligatorio, guardar un perfil antiguo empezaría a fallar). Y que
sean **tres opciones bien resueltas**, no un editor de temas: el objetivo es quitar decisiones, no añadirlas.

---

## Reglas transversales

- **No rompas la compatibilidad**: perfiles existentes deben seguir abriéndose y guardándose igual.
  Los campos nuevos, opcionales.
- El **viewer manda en el diseño**. El editor decide contenido y orden; la presentación la resuelve el
  viewer, como ya está planteado.
- Móvil primero en el editor: se monta desde el móvil más de lo que parece.
- Accesibilidad: foco, teclado y `prefers-reduced-motion` en arrastre y colapsables.
- `panel.spec.ts` y el resto de pruebas, en verde en cada fase.
- Si algo no se puede probar aquí, **dilo y márcalo**, como hace `docs/11`.

---

## Orden y prioridad

1. **Fase 1 (plantillas)** — resuelve el 70% de la confusión con el menor esfuerzo. Empieza aquí.
2. **Fase 2 (partir el panel)** — necesaria para que la Fase 3 sea viable.
3. **Fase 3 (editor)** — la mejora fina.

Si solo hay tiempo para una, haz la Fase 1: un punto de partida vale más que un editor perfecto sobre un
lienzo en blanco.

## Empieza por aquí

Lee `src/schemas.ts` (`ProfileDataSchema`, `SectionSchema`), `web/src/app/panel/panel.ts` y
`panel.html`, y `seed/demo.json`. Confírmame: (1) qué 4-5 plantillas propones y con qué bloques,
(2) cómo piensas partir `panel.html` sin romper `panel.spec.ts`.
**No toques código hasta que lo apruebe.**
