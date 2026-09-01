import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createPass, ProfileNotFoundError } from "../src/lib/pass";
import { call, callAs, crearCuenta, panelSession, resetDb, seedProfile } from "./helpers";

beforeEach(resetDb);

const JSON_HEADERS = { "content-type": "application/json" };

describe("ciclo del pase", () => {
  it("se abre una vez y luego queda denegado", async () => {
    const profileId = await seedProfile();
    const { token } = await createPass(env, { profileId, ttlSeconds: 900 });
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  it("un pase caducado queda denegado", async () => {
    const profileId = await seedProfile();
    const { token } = await createPass(env, { profileId, ttlSeconds: 900 });
    await env.DB.prepare("UPDATE passes SET expires_at = ?")
      .bind(Date.now() - 1000)
      .run();
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  it("un token inexistente da el mismo 410 que uno usado", async () => {
    expect((await call("/api/open/token-que-no-existe")).status).toBe(410);
  });

  it("dos aperturas concurrentes: solo una tiene éxito", async () => {
    const profileId = await seedProfile();
    const { token } = await createPass(env, { profileId, ttlSeconds: 900 });
    const [a, b] = await Promise.all([call("/api/open/" + token), call("/api/open/" + token)]);
    expect([a, b].filter((r) => r.status === 200).length).toBe(1);
    expect([a, b].filter((r) => r.status === 410).length).toBe(1);
  });

  it("la apertura devuelve marca de agua propia de la visita", async () => {
    const profileId = await seedProfile();
    const { id, token } = await createPass(env, { profileId, ttlSeconds: 900 });
    const body = await (await call("/api/open/" + token)).json<{ watermark: string }>();
    expect(body.watermark).toContain(id.slice(0, 8));
  });

  it("no se puede crear un pase para un perfil inexistente", async () => {
    await expect(createPass(env, { profileId: "no_existe" })).rejects.toBeInstanceOf(
      ProfileNotFoundError
    );
  });
});

describe("creación de pases (panel)", () => {
  it("requiere autenticación", async () => {
    const userId = await crearCuenta();
    const profileId = await seedProfile("pro_1", { sections: [] }, userId);
    const noAuth = await call("/api/passes", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ profileId }),
    });
    expect(noAuth.status).toBe(401);

    const sesion = await panelSession(userId);
    const ok = await call("/api/passes", {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId }),
    });
    expect(ok.status).toBe(201);
  });

  it("no se pueden generar pases del perfil de otra cuenta", async () => {
    await crearCuenta("marina", "Marina");
    await crearCuenta("otro", "Otro");
    const ajeno = await seedProfile("pro_ajeno", { sections: [] }, "marina");
    const sesion = await panelSession("otro");
    const res = await call("/api/passes", {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId: ajeno }),
    });
    expect(res.status).toBe(404);
  });

  it("rechaza una entrada no válida", async () => {
    const userId = await crearCuenta();
    const sesion = await panelSession(userId);
    const res = await call("/api/passes", {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId: "", ttlSeconds: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("devuelve 404 si el perfil no existe", async () => {
    const userId = await crearCuenta();
    const sesion = await panelSession(userId);
    const res = await call("/api/passes", {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId: "no_existe" }),
    });
    expect(res.status).toBe(404);
  });

  it("el enlace devuelto se puede abrir una sola vez", async () => {
    const userId = await crearCuenta();
    const profileId = await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    const res = await call("/api/passes", {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId }),
    });
    const { url } = await res.json<{ url: string }>();
    // El enlace apunta al viewer (/v/:token); su API equivalente es /api/open/:token.
    const path = "/api/open/" + new URL(url).pathname.split("/").pop();
    expect((await callAs("10.0.0.9", path)).status).toBe(200);
    expect((await callAs("10.0.0.9", path)).status).toBe(410);
  });
});
