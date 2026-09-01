import { describe, it, expect, beforeEach } from "vitest";
import { CLAVE, callAs, crearCuenta, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

const NUEVA = "una-contrasena-nueva-larga";

async function cambiar(sesion: string, cuerpo: Record<string, unknown>, ip = "198.51.100.90") {
  return callAs(ip, "/api/panel/password", {
    method: "PUT",
    headers: { authorization: `Bearer ${sesion}`, "content-type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
}

async function entra(password: string, ip = "198.51.100.91"): Promise<number> {
  const res = await callAs(ip, "/api/panel/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "marina", password }),
  });
  return res.status;
}

describe("el cliente cambia su propia contraseña", () => {
  it("la cambia y a partir de ahí solo vale la nueva", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");

    const res = await cambiar(sesion, { actual: CLAVE, nueva: NUEVA });
    expect(res.status).toBe(200);

    expect(await entra(NUEVA)).toBe(201);
    expect(await entra(CLAVE, "198.51.100.92")).toBe(401);
  });

  it("exige la actual: tener la sesión abierta no basta", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");

    // Un ordenador sin bloquear no puede convertirse en un cambio de credenciales.
    const res = await cambiar(sesion, { actual: "lo-que-sea", nueva: NUEVA });
    expect(res.status).toBe(401);
    expect(await entra(CLAVE)).toBe(201);
  });

  it("cierra las demás sesiones y conserva la de quien la cambia", async () => {
    await crearCuenta("marina", "Marina");
    const otra = await panelSession("marina", "198.51.100.93");
    const mia = await panelSession("marina", "198.51.100.94");

    const res = await cambiar(mia, { actual: CLAVE, nueva: NUEVA }, "198.51.100.95");
    const body = (await res.json()) as { sesionesCerradas: number };
    expect(body.sesionesCerradas).toBe(1);

    // La otra se cae: si se cambia porque hay alguien dentro, tiene que salir.
    const conLaOtra = await callAs("198.51.100.96", "/api/profiles", {
      headers: { authorization: `Bearer ${otra}` },
    });
    expect(conLaOtra.status).toBe(401);

    // Y la propia sigue viva: echar al legítimo sería castigarle por protegerse.
    const conLaMia = await callAs("198.51.100.97", "/api/profiles", {
      headers: { authorization: `Bearer ${mia}` },
    });
    expect(conLaMia.status).toBe(200);
  });

  it("rechaza una contraseña nueva corta o igual a la actual", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");

    expect((await cambiar(sesion, { actual: CLAVE, nueva: "corta" })).status).toBe(400);
    expect((await cambiar(sesion, { actual: CLAVE, nueva: CLAVE })).status).toBe(400);
    // Ninguno de los dos ha tocado nada.
    expect(await entra(CLAVE)).toBe(201);
  });

  it("sin sesión no se cambia nada", async () => {
    await crearCuenta("marina", "Marina");
    const res = await callAs("198.51.100.98", "/api/panel/password", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actual: CLAVE, nueva: NUEVA }),
    });
    expect(res.status).toBe(401);
  });

  it("no se puede probar la contraseña actual a base de intentos", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");

    // El límite va por CUENTA y no por IP: quien lo intente tendrá la misma IP
    // toda la tarde, y ya está dentro, así que la IP no distingue a nadie.
    const codigos: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await cambiar(
        sesion,
        { actual: `mal-${i}`, nueva: NUEVA },
        `198.51.100.${100 + i}`
      );
      codigos.push(res.status);
    }
    expect(codigos).toContain(429);
  });
});
