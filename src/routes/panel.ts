import { Hono } from "hono";
import type { Env } from "../env";
import { PanelLoginSchema } from "../schemas";
import { LOGIN_RULE, createSession, verifyPin } from "../lib/auth";
import { clearRateLimit, clientId, hitRateLimit } from "../lib/ratelimit";

export const panel = new Hono<{ Bindings: Env }>();

// Login del panel con PIN. Rate limit + bloqueo por cliente.
panel.post("/api/panel/session", async (c) => {
  const identity = clientId(c);
  const limit = await hitRateLimit(c.env, LOGIN_RULE, identity);
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfterSeconds));
    return c.json({ error: "demasiados intentos; inténtalo más tarde" }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = PanelLoginSchema.safeParse(body);
  // Mismo error para PIN mal formado y PIN incorrecto: no se filtra nada.
  if (!parsed.success || !verifyPin(c.env, parsed.data.pin)) {
    return c.json({ error: "credenciales no válidas" }, 401);
  }

  await clearRateLimit(c.env, LOGIN_RULE.scope, identity);
  const { token, expiresAt } = await createSession(c.env);
  return c.json({ token, expiresAt }, 201);
});
