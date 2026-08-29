import type { Context } from "hono";
import type { Env } from "../env";
import { timingSafeEqual } from "./crypto";
import { generateToken, hashToken } from "./token";

export const SESSION_TTL_MS = 30 * 60 * 1000; // 30 min

/** Regla de bloqueo del login del panel: 5 intentos / 15 min, luego 15 min bloqueado. */
export const LOGIN_RULE = {
  scope: "panel-login",
  max: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
} as const;

export function verifyPin(env: Env, pin: string): boolean {
  const expected = env.PANEL_PIN;
  if (!expected) return false;
  return timingSafeEqual(pin, expected);
}

/** Crea una sesión de panel y devuelve el token en claro (solo se ve aquí). */
export async function createSession(env: Env): Promise<{ token: string; expiresAt: number }> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO panel_sessions (id, token_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)`
  )
    .bind(crypto.randomUUID(), tokenHash, now, expiresAt)
    .run();
  return { token, expiresAt };
}

function bearer(c: Context<{ Bindings: Env }>): string | null {
  const header = c.req.header("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * Autoriza una petición del panel. Acepta una sesión abierta con PIN o, como vía de
 * servicio (CI / scripts), el secreto PANEL_TOKEN.
 */
export async function isAuthorized(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const presented = bearer(c);
  if (!presented) return false;

  const serviceToken = c.env.PANEL_TOKEN;
  if (serviceToken && timingSafeEqual(presented, serviceToken)) return true;

  const tokenHash = await hashToken(presented);
  const row = await c.env.DB.prepare(
    `SELECT id FROM panel_sessions WHERE token_hash = ?1 AND expires_at > ?2`
  )
    .bind(tokenHash, Date.now())
    .first<{ id: string }>();
  return row !== null;
}
