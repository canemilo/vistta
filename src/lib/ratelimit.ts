import type { Db } from "../db";
import { sha256Hex } from "./crypto";

export interface RateLimitRule {
  /** Etiqueta del ámbito, p. ej. "panel-login". */
  scope: string;
  /** Intentos permitidos dentro de la ventana. */
  max: number;
  /** Duración de la ventana en ms. */
  windowMs: number;
  /** Tiempo de bloqueo tras agotar los intentos, en ms. */
  blockMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Segundos que faltan para poder reintentar (solo si allowed === false). */
  retryAfterSeconds: number;
}

/**
 * Cuenta un intento y decide si se permite. El contador vive en Postgres; el
 * UPSERT con RETURNING deja el incremento y la lectura en una sola sentencia,
 * así que dos peticiones simultáneas no pueden leer el mismo valor.
 *
 * La identidad nunca se guarda en claro: la clave es el SHA-256 de "ámbito:id",
 * que para una IP es un dato personal que no hace falta conservar.
 */
export async function hitRateLimit(
  db: Db,
  rule: RateLimitRule,
  identity: string
): Promise<RateLimitResult> {
  const key = await sha256Hex(`${rule.scope}:${identity}`);
  const now = Date.now();
  const windowFloor = now - rule.windowMs;

  // `rate_limits.x` dentro del DO UPDATE es la fila que ya existía; los $ son
  // los valores nuevos. La ventana se reinicia si expiró Y no hay bloqueo vivo.
  const row = await db.one<{ count: number; blocked_until: number }>(
    `INSERT INTO vistta.rate_limits (key, count, window_start, blocked_until)
     VALUES ($1, 1, $2, 0)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= $3 AND rate_limits.blocked_until <= $2
                    THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= $3 AND rate_limits.blocked_until <= $2
                    THEN $2 ELSE rate_limits.window_start END,
       blocked_until = CASE WHEN rate_limits.window_start <= $3 AND rate_limits.blocked_until <= $2
                    THEN 0 ELSE rate_limits.blocked_until END
     RETURNING count, blocked_until`,
    [key, now, windowFloor]
  );

  const count = row?.count ?? 1;
  const blockedUntil = row?.blocked_until ?? 0;

  if (blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) };
  }

  if (count > rule.max) {
    const until = now + rule.blockMs;
    await db.query(`UPDATE vistta.rate_limits SET blocked_until = $1 WHERE key = $2`, [until, key]);
    return { allowed: false, retryAfterSeconds: Math.ceil(rule.blockMs / 1000) };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Limpia el contador tras un intento correcto (p. ej. login válido). */
export async function clearRateLimit(db: Db, scope: string, identity: string): Promise<void> {
  const key = await sha256Hex(`${scope}:${identity}`);
  await db.query(`DELETE FROM vistta.rate_limits WHERE key = $1`, [key]);
}
