-- Esquema inicial de Vistta sobre PostgreSQL.
--
-- Vive en el esquema `vistta`, no en `public`, y por dos motivos concretos:
--   1. `public` es el esquema que Supabase expone por PostgREST. Con las tablas
--      ahí, la clave publicable que viaja al navegador puede leer, entre otras
--      cosas, los hashes de contraseña.
--   2. La clave secreta del backend salta RLS, así que la autorización
--      multiinquilino la hace el código. RLS es la red, no la defensa.
-- El esquema `vistta` NO debe añadirse a los "Exposed schemas" del proyecto.
CREATE SCHEMA IF NOT EXISTS vistta;

-- Cuentas del panel. El hash de Argon2id es una cadena PHC que ya lleva dentro
-- el salt y los parámetros de coste, así que no hacen falta columnas para ellos:
-- verificar una contraseña vieja tras subir el coste sigue funcionando.
CREATE TABLE vistta.users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT   NOT NULL,
  password_hash TEXT   NOT NULL,
  created_at    BIGINT NOT NULL
);

-- Perfil = lo que el cliente enseña. `owner_id` es el eje de toda la
-- autorización: ninguna consulta del panel puede prescindir de él.
CREATE TABLE vistta.profiles (
  id           TEXT PRIMARY KEY,
  display_name TEXT   NOT NULL,
  brand_color  TEXT,
  data         JSONB  NOT NULL DEFAULT '{}'::jsonb,
  created_at   BIGINT NOT NULL,
  owner_id     TEXT REFERENCES vistta.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_profiles_owner ON vistta.profiles (owner_id);

-- El pase: el invariante del producto. Se consume una vez y solo una.
CREATE TABLE vistta.passes (
  id          TEXT PRIMARY KEY,
  -- SHA-256 del token; el token en claro solo existe en la URL, nunca en la BD.
  token_hash  TEXT   NOT NULL UNIQUE,
  profile_id  TEXT   NOT NULL REFERENCES vistta.profiles (id) ON DELETE CASCADE,
  status      TEXT   NOT NULL DEFAULT 'pending',
  created_at  BIGINT NOT NULL,
  expires_at  BIGINT NOT NULL,
  consumed_at BIGINT,
  CONSTRAINT passes_status_valido CHECK (status IN ('pending', 'consumed')),
  -- Un pase consumido tiene fecha de consumo, y uno pendiente no: si el UPDATE
  -- atómico se rompiera alguna vez, la base lo rechaza en vez de disimularlo.
  CONSTRAINT passes_consumo_coherente CHECK (
    (status = 'consumed' AND consumed_at IS NOT NULL) OR
    (status = 'pending'  AND consumed_at IS NULL)
  )
);

CREATE INDEX idx_passes_token_hash ON vistta.passes (token_hash);
CREATE INDEX idx_passes_expires_at ON vistta.passes (expires_at);

-- Sesiones del panel: opacas, con TTL, y solo su hash en la base.
CREATE TABLE vistta.panel_sessions (
  id         TEXT   PRIMARY KEY,
  token_hash TEXT   NOT NULL UNIQUE,
  user_id    TEXT   NOT NULL REFERENCES vistta.users (id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL
);

CREATE INDEX idx_panel_sessions_user ON vistta.panel_sessions (user_id);
CREATE INDEX idx_panel_sessions_expires ON vistta.panel_sessions (expires_at);

-- Rate limit. RGPD: la clave es el SHA-256 de "ámbito:identidad", nunca la IP.
CREATE TABLE vistta.rate_limits (
  key           TEXT    PRIMARY KEY,
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  BIGINT  NOT NULL,
  blocked_until BIGINT  NOT NULL DEFAULT 0
);

CREATE INDEX idx_rate_limits_window ON vistta.rate_limits (window_start);

-- RLS activada y sin políticas: deniega por defecto a cualquier rol que no sea
-- el dueño de la tabla. La API conecta como dueño, así que no le afecta; lo que
-- corta es un acceso inesperado desde otro rol de Supabase.
ALTER TABLE vistta.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vistta.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vistta.passes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE vistta.panel_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vistta.rate_limits    ENABLE ROW LEVEL SECURITY;
