import { describe, it, expect, beforeEach } from "vitest";
import { CLAVE, call, callAs, crearCuenta, resetDb } from "./helpers";

beforeEach(resetDb);

describe("cabeceras de seguridad", () => {
  it("aplica CSP estricta, no-store y no-referrer", async () => {
    const res = await call("/health");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'none'");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
  });

  it("también las aplica en las respuestas denegadas", async () => {
    const res = await call("/api/open/inexistente");
    expect(res.status).toBe(410);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("rate limit del login del panel", () => {
  const login = (ip: string, password: string, userId = "marina") =>
    callAs(ip, "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, password }),
    });

  it("bloquea tras varios intentos fallidos", async () => {
    await crearCuenta();
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) expect((await login(ip, "mal-mal-mal")).status).toBe(401);
    const blocked = await login(ip, "mal-mal-mal");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Aunque la contraseña sea correcta, sigue bloqueado.
    expect((await login(ip, CLAVE)).status).toBe(429);
  });

  it("el bloqueo es por cliente, no global", async () => {
    await crearCuenta();
    const ip = "203.0.113.8";
    for (let i = 0; i < 6; i++) await login(ip, "mal-mal-mal");
    expect((await login(ip, CLAVE)).status).toBe(429);
    expect((await login("203.0.113.9", CLAVE)).status).toBe(201);
  });

  it("un id que no existe da el mismo error que una contraseña mala", async () => {
    await crearCuenta();
    const inexistente = await login("203.0.113.30", CLAVE, "no-existe");
    const malaClave = await login("203.0.113.31", "mal-mal-mal");
    expect(inexistente.status).toBe(401);
    expect(malaClave.status).toBe(401);
    expect(await inexistente.text()).toBe(await malaClave.text());
  });
});

describe("sesión del panel", () => {
  it("unas credenciales válidas abren sesión y autorizan el panel", async () => {
    await crearCuenta();
    const res = await callAs("198.51.100.4", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "marina", password: CLAVE }),
    });
    expect(res.status).toBe(201);
    const { token, expiresAt } = await res.json<{ token: string; expiresAt: number }>();
    expect(expiresAt).toBeGreaterThan(Date.now());

    const created = await callAs("198.51.100.4", "/api/passes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ profileId: "no_existe" }),
    });
    // Autorizado (404 por el perfil, no 401).
    expect(created.status).toBe(404);
  });

  it("una sesión caducada deja de autorizar", async () => {
    const { env } = await import("cloudflare:test");
    await crearCuenta();
    const res = await callAs("198.51.100.5", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "marina", password: CLAVE }),
    });
    const { token } = await res.json<{ token: string }>();
    await env.DB.prepare("UPDATE panel_sessions SET expires_at = ?")
      .bind(Date.now() - 1)
      .run();

    const created = await callAs("198.51.100.5", "/api/passes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ profileId: "no_existe" }),
    });
    expect(created.status).toBe(401);
  });
});
