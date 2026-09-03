# Registro de actividades de tratamiento (RGPD art. 30)

> **Documento interno.** No se publica. Se mantiene actualizado y se entrega a la
> autoridad de control (en España, la AEPD) si lo requiere.
>
> Última revisión: 2026-09-01 (se añade A.5 al crear `password_requests`). Se revisa **cada vez que se añade una columna, una
> tabla o un subencargado**, no por calendario.

Vistta actúa en **dos papeles distintos** y este registro los separa, porque las
obligaciones no son las mismas:

- **Como responsable**, sobre los datos de las CUENTAS de sus clientes (quién
  contrata, qué plan, qué pagó, qué hizo un administrador).
- **Como encargado**, sobre el CONTENIDO que esos clientes suben para enseñarlo
  a los suyos. Ese contenido puede llevar datos personales de terceros —una
  fotografía de una persona identificable lo es— y de ese tratamiento responde
  el cliente, no Vistta.

---

## A. Vistta como RESPONSABLE — datos de las cuentas

**Responsable:** `TITULAR_NOMBRE`, `TITULAR_IDENTIFICACION`, `TITULAR_DIRECCION`,
`CONTACTO_LEGAL` (los cuatro salen de la configuración del despliegue; ver
`DESPLIEGUE.md`).

**Delegado de protección de datos:** no procede. No se cumple ninguno de los tres
supuestos del art. 37.1: no es autoridad pública, el tratamiento no exige
observación habitual y sistemática a gran escala, y no hay tratamiento a gran
escala de categorías especiales.

### A.1 Gestión de cuentas del panel

|                           |                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Fin**                   | Dar acceso al panel, aplicar los límites del plan contratado y sostener la relación contractual.                                                                                     |
| **Base jurídica**         | Art. 6.1.b: ejecución de un contrato del que el interesado es parte.                                                                                                                 |
| **Interesados**           | Los clientes de Vistta (profesionales que contratan el servicio).                                                                                                                    |
| **Categorías de datos**   | Identificador de cuenta, nombre visible, **hash** de la contraseña (Argon2id, nunca la contraseña), fecha de alta, plan, fecha de cambio de plan, rol, estado y fecha de suspensión. |
| **Categorías especiales** | Ninguna.                                                                                                                                                                             |
| **Origen**                | El propio interesado, a través de un administrador que da de alta la cuenta.                                                                                                         |
| **Conservación**          | Mientras la cuenta exista. Suspendida, la purga se la lleva pasada la gracia de 30 días. Borrada, se elimina de inmediato.                                                           |
| **Destinatarios**         | Ninguno fuera de los subencargados del punto D.                                                                                                                                      |
| **Transferencias**        | Ver punto D.                                                                                                                                                                         |

> **Nota que conviene no perder:** el sistema **no almacena la dirección de correo
> electrónico ni el teléfono** de sus clientes. No hay columna para ello. Las
> cuentas las crea un administrador y el contacto ocurre fuera del sistema. Es
> minimización de datos real, no declarada: lo que no está en el esquema no se
> puede filtrar. Si algún día se añade contacto, **este registro se actualiza
> primero**.

### A.2 Autenticación y sesiones

|                         |                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fin**                 | Mantener abierta la sesión del panel y poder cerrarla.                                                                                            |
| **Base jurídica**       | Art. 6.1.b.                                                                                                                                       |
| **Categorías de datos** | **Hash** SHA-256 del testigo de sesión, cuenta a la que pertenece, alta y caducidad. El testigo en claro solo existe en el navegador del cliente. |
| **Conservación**        | 8 horas (`SESSION_TTL_MS`). Se borran antes al cerrar sesión, al cambiar la contraseña, al suspender la cuenta o al reiniciarla un administrador. |

### A.3 Prevención de abuso (límite de intentos)

|                         |                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fin**                 | Impedir la adivinación de contraseñas y el abuso de las rutas públicas.                                                                       |
| **Base jurídica**       | Art. 6.1.f: interés legítimo en la seguridad del servicio (considerando 49, que lo reconoce expresamente).                                    |
| **Categorías de datos** | **Hash SHA-256 de `ámbito:identidad`**, contador, inicio de ventana y bloqueo. La identidad es una dirección IP o un identificador de cuenta. |
| **Conservación**        | La ventana del límite (minutos). Las filas se sobrescriben; no hay histórico.                                                                 |

> **La IP no se guarda en claro en ninguna tabla.** Se guarda el hash. Eso es
> **seudonimización, no anonimización**: el espacio de direcciones IPv4 es
> enumerable, así que un hash sigue siendo dato personal a efectos del RGPD y se
> trata como tal. Decir lo contrario sería el tipo de afirmación cómoda que este
> proyecto tiene vetada.

### A.4 Facturación manual

|                         |                                                                                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fin**                 | Cobrar el plan y conservar el justificante de la operación.                                                                                                                        |
| **Base jurídica**       | Art. 6.1.b (ejecución del contrato) y art. 6.1.c (obligaciones fiscales y contables).                                                                                              |
| **Categorías de datos** | Código `VISTTA-XXXXXX`, cuenta, plan, periodo, importe congelado, moneda, estado, método declarado (Bizum/PayPal), nota de conciliación, quién confirmó y cuándo.                  |
| **Conservación**        | La que impone la normativa mercantil y fiscal aplicable al titular, que es más larga que la vida de la cuenta y prevalece sobre una solicitud de supresión.                        |
| **Destinatarios**       | La entidad de pago elegida por el cliente (Bizum o PayPal) trata los datos del ingreso **por su cuenta y como responsable propio**: Vistta no le envía nada, solo lee su extracto. |

> **Vistta no almacena datos de tarjeta, IBAN ni credenciales de pago.** No hay
> pasarela. El código viaja en el concepto de una transferencia que hace el
> cliente por su cuenta.

### A.5 Solicitudes de contraseña nueva

|                         |                                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fin**                 | Que quien pierde el acceso pueda pedir que se lo restablezcan, y que la petición no se pierda por el camino.                                        |
| **Base jurídica**       | Art. 6.1.b: ejecución del contrato (dar acceso al servicio contratado).                                                                             |
| **Categorías de datos** | Identificador de la cuenta, fecha de la petición, y quién la atendió y cuándo.                                                                      |
| **Conservación**        | Hasta que se atiende o se descarta; la fila se conserva cerrada como constancia de que se atendió. Se borra con la cuenta (clave ajena en cascada). |
| **Destinatarios**       | Ninguno.                                                                                                                                            |

> **No hay recuperación por correo, y es una consecuencia directa de A.1**: no se
> almacena el correo de los clientes. Montarla obligaría a guardar contacto,
> verificarlo y contratar un proveedor de envío —un subencargado más—, y a
> rehacer este registro, el contrato del art. 28 y la política de privacidad. La
> petición **no autoriza nada**: solo dice que alguien afirma haber perdido el
> acceso. Quien comprueba la identidad es un administrador, fuera del sistema y
> por el mismo canal por el que entregó la cuenta.
>
> A diferencia de `admin_audit`, esta tabla **sí** tiene clave ajena: es una
> bandeja de trabajo, no historia. Lo que queda para la historia es el
> `reiniciar_password` del registro de auditoría.

### A.6 Auditoría de administración

|                         |                                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fin**                 | Poder responder a «quién hizo qué» sobre una cuenta ajena. Es la contrapartida de que exista un rol que se salta el aislamiento entre clientes.                                                                                                         |
| **Base jurídica**       | Art. 6.1.f: interés legítimo en la trazabilidad de los accesos privilegiados, y art. 5.2 (responsabilidad proactiva).                                                                                                                                   |
| **Categorías de datos** | Administrador, acción, cuenta afectada, detalle en JSON, fecha.                                                                                                                                                                                         |
| **Conservación**        | **Indefinida y a propósito.** La tabla no tiene claves ajenas: es historia, y lo que pasó no cambia porque después se borre la cuenta a la que se refiere. Un borrado que borrase su propio registro haría inauditable justo la operación más delicada. |
| **Minimización**        | El detalle no guarda contraseñas ni contenido; guarda qué cambió, no el valor de lo cambiado.                                                                                                                                                           |

---

## B. Vistta como ENCARGADO — contenido de los clientes

**Responsable:** cada cliente de Vistta, sobre el contenido que sube.
**Encargado:** el titular de Vistta.
**Instrucciones documentadas:** el contrato del art. 28 (`legal/encargado.md`).

|                            |                                                                                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fin**                    | Alojar, transformar y servir el contenido para que el cliente lo enseñe a un destinatario concreto mediante un enlace de un solo uso.                                             |
| **Interesados**            | Quien aparezca en el contenido que suba el cliente, y el destinatario del enlace.                                                                                                 |
| **Categorías de datos**    | Imágenes, vídeos y documentos, con lo que contengan; títulos, pies y textos escritos por el cliente; dimensiones, tipo y tamaño medidos de los bytes.                             |
| **Categorías especiales**  | **No se admiten.** La política de uso aceptable (`legal/aup.md`) las prohíbe expresamente, junto al contenido no consentido. Vistta no está diseñado ni asegurado para tratarlas. |
| **Conservación**           | La retención del plan: 7 días (Prueba), 15 (Pro), **sin caducidad** (Bóveda). Contada desde la subida y aplicada por la purga.                                                    |
| **Excepciones a la purga** | Un medio que esté en la instantánea de un pase todavía abrible no se borra —ese enlace ya salió—, y una retención nueva no se aplica a contenido anterior al plan actual.         |

### B.1 Apertura de un pase (destinatario final)

Lo que Vistta trata del **destinatario** del enlace:

|                       |                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Se guarda**         | Que el pase se consumió, cuándo, y cuántas aperturas lleva. Y, **solo si el cliente la escribe**, la referencia del destinatario (`destinatario_ref`) y una nota privada suya. |
| **NO se guarda**      | Quién lo abrió de verdad, su nombre, su correo, su IP ni su dispositivo. Nada llega del navegador que abre.                                                                    |
| **Marca de agua**     | Identificador del pase, hora UTC y, si existe, la referencia del destinatario. Se incrusta en los píxeles, por visita.                                                         |
| **Origen de la ref.** | **El cliente**, no el destinatario. Vistta no la obtiene, no la verifica y no la usa para nada más que dibujarla.                                                              |
| **Conservación**      | Vive en la fila del pase y se borra con ella: al purgar el pase, al borrar el perfil o al borrar la cuenta. No se copia a ninguna otra tabla.                                  |

> **La distinción que sostiene todo lo demás, y que hay que leer despacio:**
> Vistta sigue sin saber **quién abre** un pase. Lo que puede saber, si el cliente
> lo escribe, es **a quién dijo su cliente que se lo mandaba**. No es lo mismo: un
> enlace reenviado lo abre otra persona, y la marca seguirá diciendo el nombre del
> destinatario previsto. La marca es trazabilidad de a quién se le entregó, no
> identificación de quién miró.
>
> `destinatario_ref` es **dato personal de un tercero** que introduce el cliente.
> El cliente es su responsable y declara, al escribirlo, que tiene base para
> tratarlo; Vistta es encargado también de ese dato. Por eso el campo es opcional,
> la interfaz lo dice en el momento de escribirlo, y el dato no sale de ahí: no va
> a los logs, no se expone a nadie más que al dueño del pase y no se conserva
> aparte.
>
> Para el art. 28 esto cambia lo que hay que declarar, y por eso está escrito aquí
> antes que en ningún otro sitio. Lo que **sigue vetado** es registrar quién abre:
> identidad, IP o huella del dispositivo. Añadir eso cambiaría este registro, el
> contrato del art. 28 y la política de privacidad, en ese orden.

---

## C. Registros técnicos (logs)

Los registros del servidor guardan **método, PATRÓN de ruta y nombre del error**:
`error GET /api/open/:token : TypeError`. El patrón, no la URL.

No es un detalle de formato: la URL real lleva el testigo del pase, que es una
credencial de un solo uso. Escribirla en un log la convertiría en una credencial
guardada en texto plano y fuera del control de la base. Tampoco se registran
cuerpos de petición, cabeceras ni direcciones IP.

**Caddy tampoco escribe registro de acceso**, y esto se comprobó sobre el
despliegue real el 2026-09-03: `deploy/Caddyfile` no lleva la directiva `log`, y
Caddy no registra peticiones si no se le pide. Tras decenas de solicitudes, su
salida contenía únicamente líneas de arranque y de certificados: ninguna de
acceso. Es decir, **de la visita a un pase no queda IP ni URL en ninguna parte**.

Que siga así no es opcional por descuido, es una propiedad del diseño: la URL de
un pase **es** la credencial. Activar el registro de acceso escribiría testigos
de un solo uso en texto plano y fuera del control de la base, y además metería
direcciones IP de personas que no son clientes de Vistta. Si alguna vez se
activa —para depurar, o para medir latencias—, hay que hacer las tres cosas a la
vez: excluir `/api/open/*` y `/m/*`, fijar una retención corta, y anotarla
aquí.

---

## D. Subencargados y transferencias internacionales

| Subencargado         | Para qué                                   | Dónde                                          | Garantía                                                          |
| -------------------- | ------------------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------- |
| Proveedor del VPS    | Alojar la aplicación y la base             | A elegir en la UE al contratar                 | Contrato art. 28 del proveedor                                    |
| Cloudflare (R2)      | Almacenamiento de los medios en producción | Configurable; **debe fijarse jurisdicción UE** | CCT + medidas suplementarias                                      |
| Supabase             | Base y almacenamiento durante el MVP       | Región elegida al crear el proyecto            | CCT                                                               |
| Let's Encrypt (ISRG) | Certificados TLS                           | EE. UU.                                        | No trata datos personales del servicio: solo el nombre de dominio |

**Pendiente y obligatorio antes de abrir al público:** fijar la región de R2 y la
del VPS, y guardar el contrato de encargado de cada proveedor. Un subencargado sin
contrato firmado es un incumplimiento del art. 28.4, con independencia de lo bien
que funcione el sistema.

---

## E. Medidas de seguridad (art. 32)

Lo que hay, en concreto, y no como declaración de intenciones:

- **Contraseñas con Argon2id.** El hash lleva sal y coste dentro; no se guarda ni
  se puede leer la contraseña. Las temporales se generan, no se teclean.
- **Testigos de pase y de sesión: solo el hash SHA-256 en la base.** Quien lea la
  base entera no puede abrir ningún pase ni suplantar ninguna sesión.
- **Consumo del pase atómico**: un único `UPDATE` condicional. Un enlace se abre
  una vez aunque lleguen dieciséis peticiones a la vez.
- **Medios servidos tras tres comprobaciones**: firma válida y vigente, fila en la
  instantánea del pase, y estado `ready`. La firma sola no basta.
- **Marca de agua incrustada en los píxeles**, por visita, no superpuesta por CSS.
- **Aislamiento entre clientes en el código**, porque la clave de servicio se
  salta RLS. RLS es la red, no la defensa.
- **Cabeceras**: CSP estricta en scripts, `frame-ancestors 'none'`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, HSTS.
- **Copias de seguridad diarias**, verificadas antes de rotar y **probadas
  restaurando**, no solo generadas.
- **Cifrado en tránsito** con TLS. En reposo, el que ofrezca el proveedor de disco
  y de objetos; **debe verificarse y anotarse aquí al contratar**.

### Lo que este sistema NO hace, dicho aquí para no venderlo fuera

- No impide una captura de pantalla ni una fotografía a la pantalla. Nada puede.
- El vídeo y los documentos **se sirven sin marca de agua**: marcarlos exigiría
  recodificar en cada visita. El panel se lo dice al cliente con esas palabras.
- No hay cifrado extremo a extremo: el servidor ve el contenido, porque tiene que
  transformarlo para marcarlo.
