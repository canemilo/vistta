import { describe, it, expect, beforeEach } from "vitest";
import { consumePass, createPass, ProfileNotFoundError } from "../src/lib/pass";
import { call, callAs, crearCuenta, db, panelSession, resetDb, seedProfile } from "./helpers";

beforeEach(resetDb);

const JSON_HEADERS = { "content-type": "application/json" };

describe("ciclo del pase", () => {
  it("se abre una vez y luego queda denegado", async () => {
    const profileId = await seedProfile();
    const { token } = await createPass(db, { profileId, ttlSeconds: 900 });
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  it("un pase caducado queda denegado", async () => {
    const profileId = await seedProfile();
    const { token } = await createPass(db, { profileId, ttlSeconds: 900 });
    await db.query("UPDATE vistta.passes SET expires_at = $1", [Date.now() - 1000]);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  it("un token inexistente da el mismo 410 que uno usado", async () => {
    expect((await call("/api/open/token-que-no-existe")).status).toBe(410);
  });

  it("dos aperturas concurrentes por HTTP: solo una tiene éxito", async () => {
    const profileId = await seedProfile();
    const { token } = await createPass(db, { profileId, ttlSeconds: 900 });
    const [a, b] = await Promise.all([call("/api/open/" + token), call("/api/open/" + token)]);
    expect([a, b].filter((r) => r.status === 200).length).toBe(1);
    expect([a, b].filter((r) => r.status === 410).length).toBe(1);
  });

  /**
   * El invariante del producto, y el motivo de probar contra Postgres real.
   *
   * Dos peticiones no bastan: se comprobó que un consumo mal hecho (leer y
   * luego escribir, en dos sentencias) las pasaba igual, porque rara vez se
   * solapan. Con una ráfaga las lecturas sí coinciden antes de que escriba
   * nadie, y entonces el fallo aparece. Si este test se vuelve a poner blando,
   * deja de demostrar nada: es el que sostiene "un solo uso".
   */
  it("una ráfaga de aperturas simultáneas: exactamente una consume el pase", async () => {
    const profileId = await seedProfile();
    const { token } = await createPass(db, { profileId, ttlSeconds: 900 });

    const intentos = await Promise.all(Array.from({ length: 16 }, () => consumePass(db, token)));

    expect(intentos.filter((v) => v !== null)).toHaveLength(1);

    // Y la base queda coherente: un consumo, con su fecha.
    const fila = await db.one<{ status: string; consumed_at: number | null }>(
      "SELECT status, consumed_at FROM vistta.passes WHERE profile_id = $1",
      [profileId]
    );
    expect(fila?.status).toBe("consumed");
    expect(fila?.consumed_at).toBeTypeOf("number");
  });

  it("la apertura devuelve marca de agua propia de la visita", async () => {
    const profileId = await seedProfile();
    const { id, token } = await createPass(db, { profileId, ttlSeconds: 900 });
    const body = (await (await call("/api/open/" + token)).json()) as { watermark: string };
    expect(body.watermark).toContain(id.slice(0, 8));
  });

  it("no se puede crear un pase para un perfil inexistente", async () => {
    await expect(createPass(db, { profileId: "no_existe" })).rejects.toBeInstanceOf(
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
    const { url } = (await res.json()) as { url: string };
    // El enlace apunta al viewer (/v/:token); su API equivalente es /api/open/:token.
    const path = "/api/open/" + new URL(url).pathname.split("/").pop();
    expect((await callAs("10.0.0.9", path)).status).toBe(200);
    expect((await callAs("10.0.0.9", path)).status).toBe(410);
  });
});
