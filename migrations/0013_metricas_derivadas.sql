-- Lo que hacía falta para que las métricas de lectura respondan a las tres
-- preguntas del agente inmobiliario: ¿lo ha abierto?, ¿qué le interesó?, ¿hay
-- señal de compra?
--
-- Tres cambios, y ninguno abre la puerta a medir más fino. Lo que NO cambia,
-- que es lo que importa: sigue sin haber columna para IP, user-agent, resolución
-- ni nada del dispositivo, y lo que se guarda sigue siendo tiempo AGREGADO por
-- apartado, no un rastro de cuándo se miró cada cosa. La 0009 explica por qué, y
-- `legal/rat.md` lo declara.
--
-- 1. `seccion_titulo`. El índice del apartado no vale para un informe que cruza
--    treinta pases de meses distintos: el dosier se reordena y «apartado 3»
--    pasa a ser otra cosa, así que el ranking mezclaría peras con manzanas. El
--    título lo resuelve el SERVIDOR al guardar el evento, leyéndolo del perfil;
--    NO llega del navegador. Si llegara, un cliente manipulado escribiría el
--    texto que luego lee el propietario del inmueble en un informe con la marca
--    de su agente.
ALTER TABLE vistta.pass_events ADD COLUMN seccion_titulo TEXT;

ALTER TABLE vistta.pass_events
  ADD CONSTRAINT pass_events_titulo_razonable
  CHECK (seccion_titulo IS NULL OR length(seccion_titulo) <= 200);

-- 2. El tipo `final`: se emite cuando el último apartado del dosier llega a
--    verse. Es una señal distinta de `cierre` —que se manda siempre al salir,
--    haya leído o no— y es la segunda más predictiva del termómetro: quien llega
--    al final ha leído el precio.
ALTER TABLE vistta.pass_events DROP CONSTRAINT pass_events_tipo_valido;
ALTER TABLE vistta.pass_events
  ADD CONSTRAINT pass_events_tipo_valido
  CHECK (tipo IN ('apertura', 'seccion', 'medio', 'cierre', 'final'));

-- 3. Los derivados preguntan siempre por un pase Y un tipo («¿hay apertura?»,
--    «¿llegó al final?», «suma los apartados»). El índice por `pass_id` a secas
--    obligaba a recorrer todos los eventos de la lectura para responder.
CREATE INDEX idx_pass_events_pase_tipo ON vistta.pass_events (pass_id, tipo);
