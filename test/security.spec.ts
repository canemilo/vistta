import { describe, it, expect, beforeEach } from "vitest";
import { call, callAs, resetDb } from "./helpers";

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
  const login = (ip: string, pin: string) =>
    callAs(ip, "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });

  it("bloquea tras varios intentos fallidos", async () => {
    const ip = "203.0.113.7";
    for (let i = 0; i < 5; i++) expect((await login(ip, "000000")).status).toBe(401);
    const blocked = await login(ip, "000000");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Aunque el PIN sea correcto, sigue bloqueado.
    expect((await login(ip, "123456")).status).toBe(429);
  });

  it("el bloqueo es por cliente, no global", async () => {
    const ip = "203.0.113.8";
    for (let i = 0; i < 6; i++) await login(ip, "000000");
    expect((await login(ip, "123456")).status).toBe(429);
    expect((await login("203.0.113.9", "123456")).status).toBe(201);
  });
});

describe("sesión del panel con PIN", () => {
  it("un PIN válido abre sesión y autoriza la creación de pases", async () => {
    const res = await callAs("198.51.100.4", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
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
    const res = await callAs("198.51.100.5", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: "123456" }),
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
