# Acuerdos y encargos

> **Resumen:** Qué incluye el servicio, cómo se piden cambios y cómo se estiman. Plantillas de acuerdo y de encargo listas para adaptar. **Borradores: falta revisión jurídica.**

> ## ⚠ Estos textos son borradores de trabajo
>
> Están escritos desde el conocimiento del sistema, que es lo que un abogado no
> puede aportar. **Les falta la revisión jurídica**, que es lo que no puede
> aportar quien escribió el código. No se firman sin ella.
>
> Los documentos **con efecto jurídico ya en vigor** son otros y viven en
> `legal/`: términos, privacidad, contrato de encargado del art. 28 y política
> de uso aceptable.

## Los dos papeles, que no se mezclan

Sobre los datos de **la cuenta** (quién contrata, qué plan, qué pagó), Vistta es
**responsable del tratamiento**.

Sobre **el contenido que el cliente sube**, el responsable es **el cliente** y
Vistta es **encargado**. Eso significa que las decisiones sobre ese contenido son
del cliente y que Vistta solo hace lo que las instrucciones documentadas dicen.

Confundirlos es el error más común en este tipo de servicio, y cambia quién
responde ante quién. Está desarrollado en `legal/encargado.md`.

---

## Acuerdo de servicio · esquema

### 1. Objeto

Acceso a la plataforma Vistta en la modalidad del plan contratado, tal y como se
describe en `docs/02-propuesta-comercial.md` y con los límites de
`docs/04-ficha-tecnica.md`.

### 2. Qué incluye

- Uso del panel y del viewer, sin límite de usuarios dentro de la cuenta.
- Alojamiento del contenido dentro de la cuota, y tráfico de las visitas.
- Marca de agua incrustada en imágenes, por visita.
- Actualizaciones del producto sin coste.
- Soporte por correo, en los plazos de `docs/08-operacion-y-mantenimiento.md`.
- Copias de seguridad diarias de la base.

### 3. Qué NO incluye

- **Custodia de originales.** Vistta es para enseñar trabajo, no para
  guardarlo; el contenido caduca según el plan. El cliente conserva sus
  originales.
- **Garantía de que el contenido no se copie.** Nada impide una captura de
  pantalla, y el vídeo y los documentos se sirven sin marca.
- Desarrollos a medida, integraciones, migraciones ni formación, que van por
  encargo.
- Un porcentaje de disponibilidad garantizado, salvo que se pacte por escrito.

### 4. Obligaciones del cliente

- Usar el servicio conforme a la política de uso aceptable (`legal/aup.md`).
- Tener base jurídica para el contenido que suba: **una fotografía de una
  persona identificable es un dato personal**.
- Custodiar sus credenciales y avisar si sospecha un acceso indebido.
- Mantener sus propios originales.

### 5. Precio y pago

Según plan. Sin domiciliación: el cliente paga por Bizum o PayPal indicando el
código, y una persona lo concilia. El importe se congela al pedir el código.

### 6. Duración y baja

Mensual o anual, sin permanencia. **No hay nada que cancelar**: si no se paga, el
plan vence, la cuenta baja a Prueba y lo que sobra se congela. El cliente puede
pedir la supresión inmediata en cualquier momento.

### 7. Protección de datos

Se rige por `legal/privacidad.md` y por el contrato de encargado
`legal/encargado.md`, que forma parte del acuerdo.

### 8. Responsabilidad

Vistta responde de los daños causados por su propio incumplimiento. **No responde
del contenido que el cliente suba ni de a quién se lo envíe.** En lo que la ley
permita, el límite es lo pagado en los 12 meses anteriores; esto no limita la
responsabilidad por dolo ni negligencia grave, ni afecta a los derechos del
consumidor.

---

## Encargos: cómo se pide algo que no está

Un **encargo** es cualquier trabajo fuera del servicio: una función nueva, una
integración, una migración, una personalización.

### El circuito

| #   | Quién   | Qué                                                                                              |
| --- | ------- | ------------------------------------------------------------------------------------------------ |
| 1   | Cliente | Describe **el problema**, no la solución: qué no puede hacer hoy y qué pasa si no se hace        |
| 2   | Equipo  | Devuelve alcance, riesgos, estimación en jornadas e importe                                      |
| 3   | Cliente | Acepta por escrito                                                                               |
| 4   | Equipo  | Lo construye con la misma disciplina: pruebas y, si toca un invariante, verificadas por mutación |
| 5   | Equipo  | Entrega con documentación actualizada en el mismo commit                                         |

**Nada empieza sin el paso 3.**

### Plantilla de encargo

```
ENCARGO Nº ..... / .....                              Fecha: ..........

Solicita ..........................................................
Problema ..........................................................
  ¿Qué no se puede hacer hoy? .....................................
  ¿Qué pasa si no se hace? ........................................
  ¿Cada cuánto ocurre? ............................................

Alcance ...........................................................
Queda FUERA .......................................................
Afecta a un invariante crítico     [ ] Sí   [ ] No
  (consumo del pase, cuota, límites del plan, aislamiento, cobro)
Toca datos personales              [ ] Sí   [ ] No
  Si sí: ¿hay que actualizar el RAT, el art. 28 o la EIPD? .........

Estimación ......... jornadas        Importe ............... €
Entrega prevista ..........
Documentación que se actualiza ....................................

Aceptado por ..............................  Fecha ..........
```

### Cómo se estima

Por **jornadas de 8 h**, con un multiplicador declarado según el riesgo:

| Tipo de trabajo                        | Multiplicador | Por qué                                            |
| -------------------------------------- | ------------- | -------------------------------------------------- |
| Pantalla nueva, sin lógica de negocio  | ×1,0          | —                                                  |
| Función que toca la base               | ×1,3          | Migración y datos existentes                       |
| **Toca un invariante de concurrencia** | **×2,0**      | Exige prueba de ráfaga y verificación por mutación |
| Toca datos personales                  | ×1,5          | Hay que revisar tres documentos legales            |
| Integración con un tercero             | ×1,8          | Su API, sus caídas, sus límites                    |

El multiplicador **se dice en la estimación**, no se esconde dentro del número.
Si un encargo cuesta el doble porque toca el consumo del pase, el cliente tiene
derecho a saber que ese es el motivo y a decidir si le compensa.

### Lo que no se acepta por encargo

- Cualquier cosa que **prometa impedir la copia**: no se puede cumplir.
- **Analítica de quién abre los pases**: rompe una propiedad declarada en los
  documentos de protección de datos.
- **Una ruta HTTP que conceda permisos de administración**: convierte cualquier
  fallo de autorización futuro en una toma de control completa.
- Quitar la marca de agua manteniendo el discurso de trazabilidad.

Si se pide alguna de estas, la respuesta es un **no razonado por escrito** y, si
la hay, una alternativa que sí se pueda sostener.

## Propiedad

El **contenido del cliente es suyo**. Vistta no adquiere ningún derecho sobre él
más allá del permiso técnico imprescindible para alojarlo, transformarlo y
mostrarlo a quien abra sus pases. No se usa para promoción sin permiso escrito y
**no se usa para entrenar modelos**.

El **código de la plataforma** es de quien lo desarrolla, salvo que un encargo
diga otra cosa por escrito.
