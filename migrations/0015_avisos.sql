-- Avisos al agente. Hoy uno solo: alguien ha vuelto a abrir un dosier.
--
-- LA AGRUPACIÓN ESTÁ EN EL ÍNDICE, NO EN EL CÓDIGO, y esa es la decisión de
-- este archivo. «Si un pase se abre cinco veces, un aviso, no cinco» es un tope
-- con un contador, y la regla del proyecto (ver CLAUDE.md) es que todo tope con
-- contador tiene carrera hasta que se demuestre lo contrario. Comprobar en el
-- código si ya existe un aviso y crearlo si no son dos sentencias, y entre las
-- dos caben otras quince reaperturas: se crearían quince avisos.
--
-- Con el índice único parcial, el INSERT ... ON CONFLICT DO UPDATE es UNA
-- sentencia que decide y contabiliza a la vez, igual que el consumo del pase.
-- Hay una prueba de ráfaga de 16 que lo comprueba, verificada por mutación.
--
-- El índice es PARCIAL —solo sobre los que están sin ver— a propósito: una vez
-- que el agente ha visto el aviso y ha llamado, que el comprador vuelva mañana
-- es una noticia nueva y merece su propio aviso.
CREATE TABLE vistta.avisos (
  id         TEXT   PRIMARY KEY,
  -- A quién se avisa. Es el dueño del perfil, resuelto al crear el aviso.
  user_id    TEXT   NOT NULL REFERENCES vistta.users (id)    ON DELETE CASCADE,
  profile_id TEXT   NOT NULL REFERENCES vistta.profiles (id) ON DELETE CASCADE,
  -- En cascada: al limpiar los enlaces cerrados de un perfil, sus avisos se van
  -- con ellos. Un aviso que apunta a un enlace que ya no existe no lleva a
  -- ninguna parte.
  pass_id    TEXT   NOT NULL REFERENCES vistta.passes (id)   ON DELETE CASCADE,
  tipo       TEXT   NOT NULL,
  -- Cuántas veces ha pasado desde que se creó el aviso. Es el agrupador: el
  -- panel dice «reabierto 5 veces», no enseña cinco filas.
  veces      INTEGER NOT NULL DEFAULT 1,
  creado_en  BIGINT NOT NULL,
  ultimo_en  BIGINT NOT NULL,
  visto_en   BIGINT,
  CONSTRAINT avisos_tipo_valido CHECK (tipo IN ('reapertura')),
  CONSTRAINT avisos_veces_positivo CHECK (veces >= 1)
);

-- La agrupación, en el esquema.
CREATE UNIQUE INDEX idx_avisos_sin_ver
  ON vistta.avisos (pass_id, tipo) WHERE visto_en IS NULL;

-- Y la consulta del panel: los míos, sin ver, los últimos primero.
CREATE INDEX idx_avisos_usuario ON vistta.avisos (user_id, visto_en, ultimo_en DESC);

-- Desactivable, y por cuenta. Va en `users` y no en una tabla de preferencias
-- porque es una sola casilla: una tabla para un booleano es infraestructura sin
-- nada que infraestructurar. Por defecto encendido: el aviso es la razón de ser
-- de la función, y quien no lo quiera lo apaga en una casilla del panel.
ALTER TABLE vistta.users
  ADD COLUMN avisos_reapertura BOOLEAN NOT NULL DEFAULT true;
