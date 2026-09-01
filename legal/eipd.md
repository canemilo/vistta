# Evaluación de impacto (RGPD art. 35) — análisis previo

> **Documento interno.** Versión 1.0 · 2026-09-01.
> Se rehace **antes** de cualquier cambio que toque los supuestos del punto 2:
> analítica de aperturas, reconocimiento facial, moderación automática, retención
> indefinida por defecto o cualquier tratamiento de categorías especiales.

## 1. Para qué sirve este documento

El art. 35 exige una evaluación de impacto **solo** cuando un tratamiento es
probable que entrañe un alto riesgo. Este documento decide si Vistta está en ese
caso. La conclusión es que **hoy no lo está**, y aquí queda el razonamiento, que
es lo que hay que poder enseñar: la responsabilidad proactiva del art. 5.2 no se
demuestra con una conclusión, sino con el análisis que lleva a ella.

## 2. ¿Es obligatoria?

### 2.1 Los tres supuestos del art. 35.3

| Supuesto                                                                                     | ¿Aplica? | Por qué                                                                                                 |
| -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| Evaluación sistemática y exhaustiva de aspectos personales con efectos jurídicos (perfilado) | **No**   | Vistta no perfila a nadie. No hay puntuación, ni segmentación, ni decisión automatizada sobre personas. |
| Tratamiento a gran escala de categorías especiales (art. 9) o datos penales                  | **No**   | La política de uso aceptable las prohíbe expresamente y el sistema no está diseñado para ellas.         |
| Observación sistemática a gran escala de una zona de acceso público                          | **No**   | No hay videovigilancia ni observación de espacios.                                                      |

### 2.2 La lista de la AEPD

De los criterios que la AEPD publica para orientar cuándo hace falta una EIPD, se
examinan uno a uno los que podrían rozar a Vistta:

- **Datos biométricos**: no. Las fotografías **no son datos biométricos** salvo
  que se traten técnicamente para identificar a alguien de forma unívoca. Vistta
  no hace reconocimiento facial ni ningún análisis del contenido de la imagen.
  _Si algún día se añadiera, esta evaluación pasa a ser obligatoria._
- **Datos de personas vulnerables**: no de forma inherente al servicio.
- **Uso innovador de tecnología**: no. Redimensionar y componer una marca de agua
  con una biblioteca de imagen no es una tecnología novedosa en el sentido del
  considerando 91.
- **Impedir a los interesados ejercer un derecho**: no. Vistta no condiciona
  ningún derecho ni acceso a un servicio.
- **Tratamiento a gran escala**: no en el sentido del considerando 91. El servicio
  es de nicho, el número de interesados es reducido y el contenido **caduca por
  diseño** en 7 o 15 días según el plan.

### 2.3 Conclusión

**No es obligatoria una EIPD** para el tratamiento tal y como está descrito en
`legal/rat.md`. Se conserva este análisis como prueba de que la decisión se tomó
razonando, no por omisión.

**Lo que sigue es un análisis de riesgos voluntario**, que es la parte útil: los
riesgos existen aunque la evaluación formal no sea exigible.

## 3. Riesgos analizados y qué los mitiga

### R1 — Que un enlace llegue a quien no debía

**Escenario:** el cliente envía el pase a una dirección equivocada, o se lo
reenvían.

- _Probabilidad:_ media. Es un error humano y ocurre.
- _Impacto:_ medio o alto, según lo que enseñe el perfil.
- **Mitigación real:** el pase se consume **una sola vez** y caduca a los 15
  minutos sin abrir. Un enlace reenviado o filtrado ya está muerto casi siempre,
  y quien lo abrió por error se delata al dejarlo inservible para el destinatario.
- _Riesgo residual:_ **bajo**. El primero que abre lo ve entero.
- **Limitación honesta:** Vistta no puede verificar la identidad del destinatario
  ni sabe quién abrió. El control sobre a quién se manda es del cliente.

### R2 — Que una copia salga del viewer

**Escenario:** el destinatario guarda las imágenes y las difunde.

- _Probabilidad:_ alta. Cualquiera puede hacer una captura de pantalla.
- _Impacto:_ variable.
- **Mitigación real:** la marca de agua va **incrustada en los píxeles**, no
  superpuesta por CSS, y es distinta en cada visita. Una copia que circule permite
  saber de qué pase salió, y de ahí qué cuenta lo generó.
- _Riesgo residual:_ **medio, y no se puede bajar más.**
- **Limitación honesta:** nada impide una captura de pantalla ni una fotografía a
  la pantalla; el vídeo y los documentos se sirven sin marca. Está escrito en el
  panel, con esas palabras, para que el cliente no crea lo contrario.

### R3 — Que un cliente vea el contenido de otro

**Escenario:** un fallo de autorización rompe el aislamiento entre inquilinos.

- _Probabilidad:_ baja.
- _Impacto:_ **alto**. Sería la peor brecha posible en este producto.
- **Mitigación real:** servir un medio exige **tres** cosas independientes —firma
  válida y vigente, fila en la instantánea del pase, y estado `ready`—; el
  contenido del perfil guarda identificadores de medio contrastados contra su
  dueño al guardar; la firma lleva prefijo de longitud por campo y dominios
  separados para lectura y escritura. Este fallo **existió** y está cerrado, con
  pruebas verificadas por mutación.
- _Riesgo residual:_ **bajo**, y vigilado: cada puerta tiene su prueba.
- **Nota:** la clave de servicio del proveedor **se salta RLS**, así que toda la
  autorización recae en el código. RLS es la red, no la defensa.

### R4 — Que se destruya trabajo de un cliente

**Escenario:** el contenido desaparece por caducidad, por bajar de plan o por un
borrado.

- _Probabilidad:_ media. La caducidad es el funcionamiento normal del producto.
- _Impacto:_ alto para el cliente.
- **Mitigación real:** pasarse de un límite **no borra nada**: lo que sobra se
  congela y es reversible durante 30 días, con aviso a los 7. La purga no toca un
  medio que esté en un pase todavía abrible, ni aplica una retención nueva a
  contenido anterior al plan actual. Vencer un plan baja a `prueba` y congela, no
  destruye.
- _Riesgo residual:_ **bajo**, salvo el borrado voluntario de cuenta, que es
  inmediato e irreversible **a propósito** (art. 17) y exige teclear el
  identificador.

### R5 — Que se suba contenido ilícito

**Escenario:** alguien usa Vistta para material de abuso o contenido no
consentido.

- _Probabilidad:_ baja pero no nula. Le pasa a todo servicio que aloje archivos.
- _Impacto:_ **muy alto**, para las víctimas antes que para nadie.
- **Mitigación real:** política de tolerancia cero, procedimiento de aviso y
  retirada con plazos escritos (`legal/aup.md`), suspensión reversible que cierra
  los pases vivos al instante, y auditoría de toda acción de administración.
- _Riesgo residual:_ **medio**. **No hay detección automática ni escaneo
  proactivo**, y el sistema es reactivo por diseño: no se mira el contenido de los
  clientes. Se acepta conscientemente, y la contrapartida es que el procedimiento
  de retirada sea rápido y esté publicado.
- **Si el servicio crece**, esta decisión debe revisarse: lo razonable para un
  puñado de clientes deja de serlo a otra escala.

### R6 — Que un administrador abuse de su posición

**Escenario:** quien administra usa su acceso para algo que no debe.

- _Probabilidad:_ baja.
- _Impacto:_ alto.
- **Mitigación real:** el rol `admin` **no se concede por ninguna ruta HTTP**,
  solo con un script desde la máquina que tiene la base; el administrador
  **gestiona cuentas, no contenido**, y no hay ruta que le enseñe perfiles, medios
  ni pases; toda acción queda en `admin_audit`; y no puede suspenderse ni borrarse
  a sí mismo.
- _Riesgo residual:_ **bajo**. Con acceso directo a la base, cualquier control de
  la aplicación es superable: eso lo cubre el control de acceso al servidor.

## 4. Consulta previa a la AEPD (art. 36)

**No procede.** No queda ningún riesgo alto sin mitigar.

## 5. Cuándo hay que rehacer esto

Cualquiera de estas cosas obliga a repetir la evaluación **antes** de
implementarla:

1. Registrar quién abre un pase (identidad, correo, IP o dispositivo).
2. Cualquier análisis del contenido de las imágenes: reconocimiento facial,
   etiquetado automático, moderación por modelo.
3. Admitir categorías especiales del art. 9.
4. Retención indefinida por defecto, o quitar la caducidad del contenido.
5. Un aumento de escala que convierta «pocos clientes» en «gran escala».
6. Ceder datos a un tercero con fines propios.
