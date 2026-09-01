-- Cuentas del panel y su vínculo con perfiles y sesiones.
-- Reconstruida a partir del esquema real de la D1 local (P0.1): el código de
-- src/lib/auth.ts y src/routes/profiles.ts ya usa estas columnas.

-- Una cuenta por cliente. Solo se guarda el hash de la contraseña, nunca la
-- contraseña. El coste (iterations) se guarda por usuario para poder subirlo
-- sin invalidar las contraseñas antiguas. Ver src/lib/password.ts.
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,   -- identificador de acceso, elegido por el cliente
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,      -- PBKDF2-HMAC-SHA256, 256 bits, en hex
  salt          TEXT NOT NULL,
  iterations    INTEGER NOT NULL,   -- coste con el que se derivó ESTE hash
  created_at    INTEGER NOT NULL
);

-- Dueño del perfil: toda la autorización multiinquilino se apoya en esta columna.
ALTER TABLE profiles ADD COLUMN owner_id TEXT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_profiles_owner ON profiles(owner_id);

-- La sesión pertenece a una cuenta. DEFAULT '' porque SQLite exige un valor
-- para una columna NOT NULL añadida a una tabla que ya existe; las sesiones
-- anteriores a esta migración quedan huérfanas y no autorizan a nadie, que es
-- justo lo que se quiere (el JOIN contra users no las encuentra).
ALTER TABLE panel_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_panel_sessions_user ON panel_sessions(user_id);
