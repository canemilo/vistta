import type { Context } from "hono";
import type { Env } from "../env";
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

/** Identificador del cliente. Nunca se guarda en claro: se persiste su SHA-256. */
export function clientId(c: Context<{ Bindings: Env }>): string {
  return (
    c.req.header("CF-Connecting-IP") ??
    c.req.header("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "desconocido"
  );
}

/**
 * Cuenta un intento y decide si se permite. El contador vive en D1 (consistencia fuerte);
 * el UPSERT con RETURNING deja el incremento y la lectura en una sola sentencia.
 */
export async function hitRateLimit(
  env: Env,
  rule: RateLimitRule,
  identity: string
): Promise<RateLimitResult> {
  const key = await sha256Hex(`${rule.scope}:${identity}`);
  const now = Date.now();
  const windowFloor = now - rule.windowMs;

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start, blocked_until)
     VALUES (?1, 1, ?2, 0)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= ?3 AND rate_limits.blocked_until <= ?2
                    THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= ?3 AND rate_limits.blocked_until <= ?2
                    THEN ?2 ELSE rate_limits.window_start END,
       blocked_until = CASE WHEN rate_limits.window_start <= ?3 AND rate_limits.blocked_until <= ?2
                    THEN 0 ELSE rate_limits.blocked_until END
     RETURNING count, blocked_until`
  )
    .bind(key, now, windowFloor)
    .first<{ count: number; blocked_until: number }>();

  const count = row?.count ?? 1;
  const blockedUntil = row?.blocked_until ?? 0;

  if (blockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((blockedUntil - now) / 1000) };
  }

  if (count > rule.max) {
    const until = now + rule.blockMs;
    await env.DB.prepare(`UPDATE rate_limits SET blocked_until = ?1 WHERE key = ?2`)
      .bind(until, key)
      .run();
    return { allowed: false, retryAfterSeconds: Math.ceil(rule.blockMs / 1000) };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Limpia el contador tras un intento correcto (p. ej. login válido). */
export async function clearRateLimit(env: Env, scope: string, identity: string): Promise<void> {
  const key = await sha256Hex(`${scope}:${identity}`);
  await env.DB.prepare(`DELETE FROM rate_limits WHERE key = ?1`).bind(key).run();
}
