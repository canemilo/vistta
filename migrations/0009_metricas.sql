-- Métricas de lectura: cuánto y qué miró el destinatario.
--
-- Es la función más delicada del producto en privacidad, y por eso los límites
-- están en el esquema y no solo en el código:
--
--   NO hay columna para IP, ni para user-agent, ni para nada que identifique el
--   dispositivo. No es que no se rellenen: es que no existen. Lo que no está en
--   el esquema no se puede filtrar ni se puede empezar a guardar «temporalmente»
--   un martes. El pase ya está asociado a un destinatario concreto desde la
--   0008; añadir huella técnica encima no aportaría nada y agravaría el
--   tratamiento.
--
-- Y lo que sí se guarda es AGREGADO por el navegador antes de enviarlo: tiempo
-- visible por sección y por medio, no un evento por scroll. Un rastro fino de
-- cuándo miró cada cosa sería el registro de la conducta de una persona
-- identificada, que es otra cosa distinta de «cuánto le interesó el dossier».
CREATE TABLE vistta.pass_events (
  id          TEXT   PRIMARY KEY,
  -- CASCADE: los eventos se van con el pase, sin excepción y sin trabajo de
  -- limpieza que se pueda olvidar. Es la retención más corta de las dos.
  pass_id     TEXT   NOT NULL REFERENCES vistta.passes (id) ON DELETE CASCADE,
  ts          BIGINT NOT NULL,
  tipo        TEXT   NOT NULL,
  seccion_idx INTEGER,
  media_id    TEXT,
  ms_visible  INTEGER,
  CONSTRAINT pass_events_tipo_valido CHECK (tipo IN ('apertura', 'seccion', 'medio', 'cierre')),
  -- Un cliente manipulado puede mandar lo que quiera: el tope está aquí para
  -- que una cifra absurda no llegue a la base y luego se enseñe como «4 horas
  -- en la sección Planos». Doce horas es más de lo que nadie mira un dossier.
  CONSTRAINT pass_events_tiempo_razonable CHECK (
    ms_visible IS NULL OR (ms_visible >= 0 AND ms_visible <= 43200000)
  ),
  CONSTRAINT pass_events_seccion_valida CHECK (seccion_idx IS NULL OR seccion_idx >= 0)
);

-- El panel siempre pregunta por un pase concreto.
CREATE INDEX idx_pass_events_pase ON vistta.pass_events (pass_id);
-- Y la purga, por antigüedad.
CREATE INDEX idx_pass_events_ts ON vistta.pass_events (ts);
