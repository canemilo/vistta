-- Ningún plan de pago se queda sin fecha de vencimiento.
--
-- Hasta aquí, la fecha (`plan_until`) solo la ponía la confirmación de un pago.
-- Cambiar el plan a mano desde el panel de administración no la tocaba, así que
-- un Pro o un Bóveda concedido desde ahí nacía sin plazo: en la tabla salía
-- «sin plazo» y en la práctica era un plan de por vida regalado sin querer.
-- Nadie lo veía vencer y `aplicarVencimientos` ni lo miraba, porque esa función
-- solo recorre las filas que TIENEN fecha.
--
-- El código ya no los crea así (`asignarPlan` concede periodo). Esto es para
-- los que quedaron de antes, que el código nuevo no alcanza: son filas ya
-- escritas.
--
-- LOS NÚMEROS DE AQUÍ NO SON POLÍTICA, SON HISTORIA. La regla del proyecto es
-- que las cifras de los planes viven solo en `src/lib/planes.ts`, y sigue en
-- pie: este archivo no la aplica cada día, se ejecuta UNA vez y describe lo que
-- se le concedió a unas cuentas concretas en el momento de desplegarlo. Por eso
-- los 30 días van escritos y no importados: si mañana un mes pasa a ser otra
-- cosa, lo que se dio aquí siguió siendo esto.
--
-- No borra ni degrada nada: da un mes por delante desde el despliegue, tiempo
-- de sobra para cobrar o renovar. Y vencer, cuando llegue, tampoco borra: baja
-- a `prueba` y congela lo que sobre, que se rescata pagando.
UPDATE vistta.users
   SET plan_until = (EXTRACT(EPOCH FROM now()) * 1000)::bigint + 2592000000  -- 30 días
 WHERE plan <> 'prueba'
   AND plan_until IS NULL;

-- Y el reverso: en `prueba` la fecha sobra siempre.
--
-- Ahí no caduca el plan, caduca el CONTENIDO —a los 7 días, por retención, que
-- es cosa de `lib/purga.ts` y no de esta columna—. Una fecha heredada del plan
-- anterior dejaría a la cuenta venciendo otra vez en cada pasada del trabajo de
-- vencimientos, sobre un plan del que ya no se puede bajar más.
UPDATE vistta.users
   SET plan_until = NULL
 WHERE plan = 'prueba'
   AND plan_until IS NOT NULL;
