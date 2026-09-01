# Política de privacidad

> Pública. Versión 1.0 · 2026-09-01

Esto cuenta qué hace Vistta con **tus datos como cliente**. Lo que hace con el
**contenido que subes** es otra cosa y se rige por el contrato de encargado
(`legal/encargado.md`): de ese contenido el responsable eres tú, no Vistta.

## Quién trata tus datos

`TITULAR_NOMBRE` · `TITULAR_IDENTIFICACION` · `TITULAR_DIRECCION`
Contacto: **`CONTACTO_LEGAL`**

## Lo primero, porque es lo que menos se espera

**Vistta no guarda tu correo electrónico ni tu teléfono.** No hay ningún sitio
donde ponerlos: el esquema de la base no tiene columna para ellos. Tu cuenta es
un identificador, un nombre visible y el hash de tu contraseña.

No es una promesa, es una propiedad del sistema. Lo que no existe no se filtra.

## Qué se guarda, para qué y por cuánto tiempo

| Qué                                                                | Para qué                                         | Base jurídica                                 | Cuánto                    |
| ------------------------------------------------------------------ | ------------------------------------------------ | --------------------------------------------- | ------------------------- |
| Identificador, nombre visible, hash de la contraseña, plan, estado | Darte acceso y aplicar los límites de tu plan    | Ejecución del contrato (art. 6.1.b)           | Mientras exista la cuenta |
| Hash del testigo de sesión                                         | Mantener la sesión abierta                       | Ejecución del contrato                        | 8 horas                   |
| Hash de tu IP o de tu cuenta, con un contador                      | Que nadie adivine contraseñas a base de intentos | Interés legítimo en la seguridad (art. 6.1.f) | Minutos                   |
| Códigos y justificantes de pago                                    | Cobrar y cumplir con Hacienda                    | Contrato y obligación legal (art. 6.1.b y c)  | El plazo fiscal aplicable |
| Registro de acciones de administración                             | Saber quién hizo qué sobre una cuenta            | Interés legítimo en la trazabilidad           | Indefinido (ver abajo)    |

**Tu contraseña no se guarda.** Se guarda un hash Argon2id, del que no se puede
volver atrás. Nadie de Vistta puede leerla, ni decírtela si la olvidas: solo
generarte una nueva.

**Tu dirección IP no se guarda en claro** en ninguna tabla. Del límite de
intentos se guarda un hash. Con todo, un hash de una IP **sigue siendo un dato
personal**, porque el conjunto de direcciones posibles es enumerable, y como tal
se trata. No te vamos a decir que es anónimo, porque no lo es.

### El registro de administración se conserva indefinidamente

Y es deliberado. Si un administrador toca tu cuenta, ese hecho queda escrito, y
sigue escrito aunque después la cuenta se borre. Un registro que desapareciera
con lo que registra dejaría sin rastro justo la operación más delicada. Guarda
qué se hizo, no el contenido de lo que se hizo.

## Cookies y rastreo

**Ninguna.** Vistta no usa cookies de análisis ni de publicidad, no incrusta
piezas de terceros y no te sigue entre sitios. La sesión del panel se guarda en
el almacenamiento de la pestaña y se borra al cerrarla.

No hay banner de cookies porque no hay nada que consentir.

## Quién más ve tus datos

Los proveedores que hacen falta para que el servicio exista: el del servidor, el
del almacenamiento de los medios y el de la base. Están listados en
`legal/rat.md`, punto D, cada uno con su contrato.

**No se venden datos. No se ceden con fines comerciales. No se usan para entrenar
modelos.**

Si pagas por Bizum o PayPal, esa entidad trata los datos de tu ingreso por su
cuenta y bajo su propia política: Vistta no le manda nada, solo mira su extracto.
Vistta **no almacena tarjetas, IBAN ni credenciales de pago**; no hay pasarela.

## Tus derechos

Puedes pedir **acceso, rectificación, supresión, limitación, portabilidad y
oposición** escribiendo a `CONTACTO_LEGAL`. Se responde en un mes.

En la práctica, dos de ellos ya los ejerces tú solo desde el panel: puedes
cambiar tu contraseña y borrar cualquier contenido cuando quieras.

Sobre la **supresión** (art. 17), tres cosas dichas claras:

- Borrar la cuenta es **inmediato e irreversible**. No hay papelera.
- Lo que la ley obliga a conservar se conserva: los justificantes de pago tienen
  su plazo fiscal y no se van con la cuenta.
- **Las copias de seguridad no se pueden reescribir.** Lo borrado desaparece del
  sistema vivo al instante, pero puede seguir en una copia hasta que esa copia se
  rote (14 días por defecto). No se restauran salvo desastre, y si hay que
  restaurar, el borrado se vuelve a aplicar.

Si crees que no se te ha atendido bien, puedes reclamar ante la Agencia Española
de Protección de Datos (**www.aepd.es**). Preferimos que nos escribas primero,
pero es tu derecho y no hace falta pasar por nosotros.

## Qué pasa si hay una brecha

Si ocurre y te afecta, se te comunica sin dilación indebida y con lo que se sepa
en ese momento, aunque la investigación no esté cerrada. A la AEPD se le notifica
en 72 horas cuando proceda.

## Cambios

Si esta política cambia de forma que te afecte, se avisa con antelación. El
historial de cambios está en el repositorio del proyecto: cada versión de este
documento tiene su commit, con fecha y motivo.
