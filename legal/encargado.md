# Contrato de encargado del tratamiento (RGPD art. 28)

> **Forma parte de los términos del servicio.** Aceptar los términos es aceptar
> este anexo. No hay que firmarlo aparte, pero el cliente puede pedir una copia
> firmada.
>
> Versión 1.0 · 2026-09-01

## 1. Quién es quién

Cuando usas Vistta para enseñar tu trabajo, **tú eres el responsable del
tratamiento** y **Vistta es el encargado**. No es una fórmula: significa que las
decisiones sobre ese contenido son tuyas y que Vistta solo hace lo que estas
instrucciones dicen.

- **Responsable:** el cliente titular de la cuenta.
- **Encargado:** `TITULAR_NOMBRE`, `TITULAR_IDENTIFICACION`, `TITULAR_DIRECCION`.
  Contacto: `CONTACTO_LEGAL`.

Para los datos de **tu cuenta** (quién eres, qué plan tienes, qué pagaste) el
responsable es Vistta, y eso se rige por la política de privacidad, no por este
documento. Los dos papeles conviven y no se mezclan.

## 2. Objeto, duración y naturaleza

Vistta aloja el contenido que subes, lo transforma (mide sus dimensiones, genera
una miniatura, incrusta una marca de agua al servirlo) y lo entrega a quien abra
el enlace privado que tú generas y envías.

Dura lo que dure tu cuenta. Termina cuando la cierras, cuando la borras o cuando
la retención de tu plan se lleva el contenido, lo que pase antes.

## 3. Qué datos y de quién

- **Categorías de datos:** imágenes, vídeos y documentos con lo que contengan;
  los textos que escribes; y los metadatos técnicos que Vistta mide de los bytes.
- **Interesados:** quien aparezca en el contenido que subas.

**Tú decides qué subes, y respondes de ello.** Si subes la fotografía de una
persona identificable, estás tratando sus datos personales y necesitas una base
jurídica para hacerlo. Vistta no la comprueba y no puede comprobarla.

## 4. Instrucciones documentadas (art. 28.3.a)

Vistta trata el contenido **únicamente** para:

1. guardarlo y devolvértelo en tu panel;
2. medirlo e inspeccionarlo al subirlo, para aplicar los límites y para no servir
   nunca algo que no ha mirado;
3. transformarlo al servirlo: reducirlo, quitarle los metadatos EXIF (ahí viven
   el GPS y el número de serie de la cámara) e incrustarle la marca de la visita;
4. entregarlo a quien abra un pase válido que tú hayas creado;
5. borrarlo cuando toque.

**No se usa para nada más.** En particular, no se usa para entrenar modelos, no
se cede a terceros, no se analiza con fines comerciales y no se mira salvo que
una denuncia lo obligue (ver `legal/aup.md`).

Si Vistta recibiera una instrucción tuya que a su juicio infringe el RGPD, te lo
dirá antes de ejecutarla (art. 28.3, párrafo segundo).

## 5. Confidencialidad (art. 28.3.b)

Quien tiene acceso técnico al sistema está obligado a confidencialidad. El acceso
de administración **no incluye el contenido**: no hay ninguna ruta que permita a
un administrador ver perfiles, medios ni pases de un cliente, y hay una prueba
automática que lo comprueba sobre la respuesta real del servidor. La
administración gestiona cuentas, no contenido.

## 6. Seguridad (art. 28.3.c y art. 32)

Las medidas concretas están en `legal/rat.md`, punto E, y se actualizan con el
sistema. En resumen: TLS en tránsito, contraseñas con Argon2id, testigos solo
hasheados en la base, enlaces de un solo uso con consumo atómico, medios en
almacenamiento privado servidos solo por URL firmada y efímera tras tres
comprobaciones, marca de agua en los píxeles y copias verificadas.

**Lo que no se hace, dicho aquí y no en la letra pequeña:** nada de esto impide
una captura de pantalla, el vídeo y los documentos se sirven sin marca, y el
servidor ve el contenido porque tiene que transformarlo.

## 7. Subencargados (art. 28.2 y 28.4)

Autorizas de forma general que Vistta recurra a los subencargados listados en
`legal/rat.md`, punto D (proveedor del VPS, Cloudflare R2, Supabase). Cada uno
está sujeto por contrato a las mismas obligaciones.

**Antes de añadir o sustituir uno, Vistta te lo comunicará con al menos 30 días
de antelación** y podrás oponerte; si te opones, podrás resolver el contrato y
recuperar tu contenido sin penalización.

## 8. Derechos de los interesados (art. 28.3.e)

Si alguien que aparece en tu contenido ejerce sus derechos, **el que responde
eres tú**: eres el responsable. Vistta te ayuda con lo que puede, que es
bastante concreto: tú mismo puedes borrar cualquier medio desde el panel, y
borrarlo lo borra del almacenamiento y de la base.

Si una solicitud le llega directamente a Vistta, te la reenviará sin responderla
por su cuenta, salvo que la ley le obligue a actuar (por ejemplo, ante contenido
manifiestamente ilícito: ver `legal/aup.md`).

## 9. Brechas de seguridad (art. 28.3.f, 33 y 34)

Si Vistta detecta una violación de seguridad que afecte a tu contenido, **te lo
comunicará sin dilación indebida** y con lo que sepa: qué pasó, a qué afecta,
qué consecuencias probables tiene y qué se está haciendo.

**La notificación a la autoridad de control en 72 horas te corresponde a ti**,
como responsable. Vistta te dará lo necesario para que puedas hacerla a tiempo,
y por eso avisa cuanto antes aunque la investigación no esté cerrada.

## 10. Fin del tratamiento (art. 28.3.g)

Al terminar, **tú eliges**: que Vistta te devuelva el contenido o que lo suprima.
Por defecto se suprime.

Con dos precisiones honestas:

- **Las copias de seguridad no se pueden reescribir.** Un contenido borrado
  desaparece del sistema vivo de inmediato, pero puede seguir en una copia hasta
  que esa copia se rote (14 días por defecto). No se restaura salvo desastre, y
  si hay que restaurar, el borrado se vuelve a aplicar.
- **Lo que la ley obliga a conservar se conserva**: los justificantes de pago
  tienen su propio plazo fiscal y no se van con la cuenta.

## 11. Auditoría (art. 28.3.h)

Vistta pondrá a tu disposición la información necesaria para demostrar que
cumple, y admitirá auditorías —tuyas o de un auditor que designes— con aviso
razonable y sin comprometer la seguridad de otros clientes. La documentación
técnica de este repositorio (`legal/rat.md`, `DESPLIEGUE.md`, `CLAUDE.md`) forma
parte de esa información y no es un resumen comercial: describe el sistema como
es, incluidas sus limitaciones.

## 12. Transferencias internacionales

Vistta no transfiere tu contenido fuera del Espacio Económico Europeo salvo por
los subencargados del punto D del RAT, y en ese caso con Cláusulas Contractuales
Tipo. **Antes de abrir el servicio al público debe fijarse la jurisdicción de
almacenamiento**; hasta que eso esté hecho y anotado, el despliegue no está listo
para datos de clientes reales.
