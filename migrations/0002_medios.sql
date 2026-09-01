-- Bloque D — medios.
--
-- La idea que ordena todo lo demás: **la fila manda, no el objeto**. Hasta
-- ahora un medio era una clave de almacenamiento escrita en el JSON del perfil,
-- y eso tenía dos consecuencias malas: el backend servía bytes que nunca había
-- mirado, y un usuario podía escribir en su perfil la clave de otro (el IDOR
-- del §3 del HANDOFF). Con esta tabla, un medio existe porque hay fila, la fila
-- dice de quién es, y el JSON del perfil solo guarda su id.

CREATE TABLE vistta.media (
  id          TEXT PRIMARY KEY,
  -- El eje de la autorización, igual que `owner_id` en profiles: ninguna
  -- consulta de medios puede prescindir de él.
  profile_id  TEXT   NOT NULL REFERENCES vistta.profiles (id) ON DELETE CASCADE,
  -- Dónde están los bytes. La genera el servidor, nunca el cliente.
  storage_key TEXT   NOT NULL UNIQUE,
  kind        TEXT   NOT NULL,
  mime        TEXT   NOT NULL,
  -- Al reservar (presign) son los bytes DECLARADOS por el cliente, que no valen
  -- nada; al confirmar se sobrescriben con los bytes REALES que ha contado el
  -- backend. La cuota se recalcula con los reales.
  bytes       BIGINT NOT NULL DEFAULT 0,
  -- Dimensiones reales, para que el bento del bloque G no las adivine. Las
  -- rellena el trabajo de derivados; NULL mientras tanto.
  width       INTEGER,
  height      INTEGER,
  -- Miniatura minúscula en data URI para el hueco mientras carga.
  lqip        TEXT,
  -- 'pending' = hay reserva pero el backend no ha visto los bytes.
  -- 'ready'   = el backend los ha inspeccionado (magic bytes y tamaño).
  -- 'failed'  = los inspeccionó y no eran lo que decían.
  -- Solo 'ready' se sirve. Lo que el backend no ha mirado no sale nunca.
  status      TEXT   NOT NULL DEFAULT 'pending',
  created_at  BIGINT NOT NULL,
  confirmed_at BIGINT,
  CONSTRAINT media_kind_valido CHECK (kind IN ('image', 'video', 'doc')),
  CONSTRAINT media_status_valido CHECK (status IN ('pending', 'ready', 'failed')),
  -- Un medio servible tiene fecha de confirmación. Si alguna vez se pusiera
  -- 'ready' por otro camino que no sea confirmar, la base lo rechaza.
  CONSTRAINT media_confirmacion_coherente CHECK (
    status <> 'ready' OR confirmed_at IS NOT NULL
  ),
  CONSTRAINT media_bytes_no_negativos CHECK (bytes >= 0)
);

CREATE INDEX idx_media_profile ON vistta.media (profile_id);
-- El reaper busca reservas viejas sin confirmar: por estado y por fecha.
CREATE INDEX idx_media_huerfanos ON vistta.media (status, created_at);

-- Instantánea del contenido en el momento de crear el pase.
--
-- Sirve para dos cosas. Una: da significado exacto a "cuota por pase" —es la
-- suma de estas filas y no lo que el perfil tenga hoy—. Dos, y más importante:
-- es la lista blanca de lo que ese pase puede pedir. Aunque alguien fabricase
-- una firma válida para otro medio, sin fila aquí no se sirve.
CREATE TABLE vistta.pass_media (
  pass_id  TEXT NOT NULL REFERENCES vistta.passes (id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES vistta.media (id) ON DELETE CASCADE,
  PRIMARY KEY (pass_id, media_id)
);

CREATE INDEX idx_pass_media_media ON vistta.pass_media (media_id);

-- Cola de trabajos. Se toma con FOR UPDATE SKIP LOCKED: varios trabajadores a
-- la vez no se pisan y ninguno espera al de al lado. Postgres ya es la base del
-- proyecto, así que una cola aquí evita meter Redis para cuatro trabajos.
CREATE TABLE vistta.jobs (
  id         TEXT   PRIMARY KEY,
  kind       TEXT   NOT NULL,
  payload    JSONB  NOT NULL DEFAULT '{}'::jsonb,
  status     TEXT   NOT NULL DEFAULT 'pending',
  attempts   INTEGER NOT NULL DEFAULT 0,
  -- Reintentos con espera: el trabajo no se vuelve a tomar hasta esta hora.
  run_after  BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_error TEXT,
  CONSTRAINT jobs_status_valido CHECK (status IN ('pending', 'running', 'done', 'failed'))
);

-- El índice que usa la toma de trabajos: pendientes cuya hora ya ha llegado.
CREATE INDEX idx_jobs_por_tomar ON vistta.jobs (status, run_after);

ALTER TABLE vistta.media      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vistta.pass_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE vistta.jobs       ENABLE ROW LEVEL SECURITY;
