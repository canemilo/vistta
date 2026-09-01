import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { CambiarPasswordSchema, PanelLoginSchema } from "../schemas";
import {
  LOGIN_RULE,
  bearer,
  cambiarPasswordPropia,
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

  /**
   * Cambiar la propia contraseña.
   *
   * Con límite y por CUENTA, no por IP: aquí no se está adivinando quién es
   * nadie —ya hay sesión— sino la contraseña actual de esta cuenta concreta, y
   * quien lo intente tendrá la misma IP toda la tarde.
   */
  panel.put("/api/panel/password", async (c) => {
    const token = bearer(c.req.header("Authorization"));
    const usuario = await usuarioDeLaSesion(db, token);
    if (!usuario) return c.json({ error: "no autorizado" }, 401);

    const limite = await hitRateLimit(db, { ...LOGIN_RULE, scope: "panel-password" }, usuario.id);
    if (!limite.allowed) {
      c.header("Retry-After", String(limite.retryAfterSeconds));
      return c.json({ error: "demasiados intentos; inténtalo más tarde" }, 429);
    }

    const parsed = CambiarPasswordSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "la contraseña nueva necesita 10 caracteres o más" }, 400);
    }
    if (parsed.data.actual === parsed.data.nueva) {
      return c.json({ error: "la contraseña nueva tiene que ser distinta" }, 400);
    }

    const cerradas = await cambiarPasswordPropia(
      db,
      usuario.id,
      parsed.data.actual,
      parsed.data.nueva,
      token
    );
    if (cerradas === null) {
      return c.json({ error: "la contraseña actual no es correcta" }, 401);
    }

    await clearRateLimit(db, "panel-password", usuario.id);
    // Cuántas sesiones se han cerrado: enterarse de que había tres abiertas es
    // justo lo que quiere saber quien cambia la contraseña porque sospecha algo.
    return c.json({ ok: true, sesionesCerradas: cerradas });
  });

  return panel;
}
