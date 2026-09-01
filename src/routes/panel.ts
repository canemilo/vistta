import { Hono } from "hono";
import type { Env } from "../env";
import { PanelLoginSchema } from "../schemas";
import {
  LOGIN_RULE,
  cerrarSesion,
  createSession,
  usuarioDeLaSesion,
  verificarCredenciales,
} from "../lib/auth";
import { clearRateLimit, clientId, hitRateLimit } from "../lib/ratelimit";

export const panel = new Hono<{ Bindings: Env }>();

// Entrar al panel con id y contraseña. Rate limit por cliente y por cuenta.
panel.post("/api/panel/session", async (c) => {
  const identity = clientId(c);
  const porCliente = await hitRateLimit(c.env, LOGIN_RULE, identity);
  if (!porCliente.allowed) {
    c.header("Retry-After", String(porCliente.retryAfterSeconds));
    return c.json({ error: "demasiados intentos; inténtalo más tarde" }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = PanelLoginSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "credenciales no válidas" }, 401);

  // Segundo contador por cuenta: frena el ataque repartido entre muchas IP.
  const porCuenta = await hitRateLimit(
    c.env,
    { ...LOGIN_RULE, scope: "panel-login-cuenta", max: 10 },
    parsed.data.userId
  );
  if (!porCuenta.allowed) {
    c.header("Retry-After", String(porCuenta.retryAfterSeconds));
    return c.json({ error: "demasiados intentos; inténtalo más tarde" }, 429);
  }

  const usuario = await verificarCredenciales(c.env, parsed.data.userId, parsed.data.password);
  // Mismo error para id inexistente y contraseña incorrecta: no se filtra nada.
  if (!usuario) return c.json({ error: "credenciales no válidas" }, 401);

  await clearRateLimit(c.env, LOGIN_RULE.scope, identity);
  await clearRateLimit(c.env, "panel-login-cuenta", usuario.id);
  const { token, expiresAt } = await createSession(c.env, usuario.id);
  return c.json({ token, expiresAt, user: usuario }, 201);
});

// Quién soy: permite al panel recuperar la sesión sin volver a pedir la contraseña.
panel.get("/api/panel/session", async (c) => {
  const usuario = await usuarioDeLaSesion(c);
  if (!usuario) return c.json({ error: "no autorizado" }, 401);
  return c.json({ user: usuario });
});

panel.delete("/api/panel/session", async (c) => {
  await cerrarSesion(c);
  return c.json({ ok: true });
});
