import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { PanelLoginSchema } from "../schemas";
import {
  LOGIN_RULE,
  bearer,
  cerrarSesion,
  createSession,
  usuarioDeLaSesion,
  verificarCredenciales,
} from "../lib/auth";
import { clearRateLimit, hitRateLimit } from "../lib/ratelimit";

export function panelRoutes({ db }: Deps) {
  const panel = new Hono<AppEnv>();

  // Entrar al panel con id y contraseña. Rate limit por cliente y por cuenta.
  panel.post("/api/panel/session", async (c) => {
    const identity = c.get("ip");
    const porCliente = await hitRateLimit(db, LOGIN_RULE, identity);
    if (!porCliente.allowed) {
      c.header("Retry-After", String(porCliente.retryAfterSeconds));
      return c.json({ error: "demasiados intentos; inténtalo más tarde" }, 429);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = PanelLoginSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "credenciales no válidas" }, 401);

    // Segundo contador por cuenta: frena el ataque repartido entre muchas IP.
    const porCuenta = await hitRateLimit(
      db,
      { ...LOGIN_RULE, scope: "panel-login-cuenta", max: 10 },
      parsed.data.userId
    );
    if (!porCuenta.allowed) {
      c.header("Retry-After", String(porCuenta.retryAfterSeconds));
      return c.json({ error: "demasiados intentos; inténtalo más tarde" }, 429);
    }

    const usuario = await verificarCredenciales(db, parsed.data.userId, parsed.data.password);
    // Mismo error para id inexistente y contraseña incorrecta: no se filtra nada.
    if (!usuario) return c.json({ error: "credenciales no válidas" }, 401);

    await clearRateLimit(db, LOGIN_RULE.scope, identity);
    await clearRateLimit(db, "panel-login-cuenta", usuario.id);
    const { token, expiresAt } = await createSession(db, usuario.id);
    return c.json({ token, expiresAt, user: usuario }, 201);
  });

  // Quién soy: permite al panel recuperar la sesión sin volver a pedir la contraseña.
  panel.get("/api/panel/session", async (c) => {
    const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
    if (!usuario) return c.json({ error: "no autorizado" }, 401);
    return c.json({ user: usuario });
  });

  panel.delete("/api/panel/session", async (c) => {
    await cerrarSesion(db, bearer(c.req.header("Authorization")));
    return c.json({ ok: true });
  });

  return panel;
}
