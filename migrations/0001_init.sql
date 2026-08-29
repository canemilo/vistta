CREATE TABLE IF NOT EXISTS profiles (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  brand_color  TEXT,
  data         TEXT NOT NULL DEFAULT '{}',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS passes (
  id          TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,          -- SHA-256 del token; nunca el token en claro
  profile_id  TEXT NOT NULL REFERENCES profiles(id),
  status      TEXT NOT NULL DEFAULT 'pending', -- pending | consumed
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_passes_token_hash ON passes(token_hash);
CREATE INDEX IF NOT EXISTS idx_passes_expires_at ON passes(expires_at);
