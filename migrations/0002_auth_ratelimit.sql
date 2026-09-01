-- Rate limit + bloqueo (RGPD: solo se guarda un hash de la IP, nunca la IP en claro).
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,   -- SHA-256 de "scope:ip"
  count         INTEGER NOT NULL DEFAULT 0,
  window_start  INTEGER NOT NULL,
  blocked_until INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

-- Sesiones del panel: se guarda el hash del token, nunca el token en claro.
CREATE TABLE IF NOT EXISTS panel_sessions (
  id         TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_panel_sessions_expires ON panel_sessions(expires_at);
