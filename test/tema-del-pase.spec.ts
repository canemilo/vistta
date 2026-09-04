import { describe, it, expect, beforeEach } from "vitest";
import { createPass, pasesDelPerfil } from "../src/lib/pass";
import { call, crearCuenta, db, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

const JSON_HEADERS = { "content-type": "application/json" };

async function abrir(token: string) {
  const res = await call("/api/open/" + token);
  return (await res.json()) as { tema: string };
}

describe("el aspecto con el que se envía un pase", () => {
  /*
   * Lo primero, porque es lo que no puede cambiar: los pases que ya existían y
   * los que se generen sin pedir nada siguen siendo oscuros. La migración lleva
   * DEFAULT 'oscuro' para que esto sea cierto también para las filas viejas.
   */
  it("por defecto es oscuro, y los pases de antes no cambian", async () => {
    await crearCuenta("marina", "Marina");
    const { token } = await createPass(db, { profileId: "p_marina" });
    expect((await abrir(token)).tema).toBe("oscuro");
  });

  it("si se pide claro, el pase lo lleva y el viewer lo recibe", async () => {
    await crearCuenta("marina", "Marina");
    const { token } = await createPass(db, { profileId: "p_marina", tema: "claro" });
    expect((await abrir(token)).tema).toBe("claro");
  });

  it("viaja por la ruta de creación, no solo por la función", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");
    const res = await call("/api/passes", {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId: "p_marina", tema: "claro" }),
    });
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    expect((await abrir(url.split("/v/")[1])).tema).toBe("claro");
  });

  it("un aspecto inventado se rechaza con 400", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");
    const res = await call("/api/passes", {
      method: "POST",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId: "p_marina", tema: "fucsia" }),
    });
    expect(res.status).toBe(400);
  });

  it("el dueño ve en su lista con qué aspecto salió cada enlace", async () => {
    await crearCuenta("marina", "Marina");
    await createPass(db, { profileId: "p_marina", tema: "claro" });
    await createPass(db, { profileId: "p_marina" });
    const lista = await pasesDelPerfil(db, "p_marina");
    expect(lista.map((p) => p.tema).sort()).toEqual(["claro", "oscuro"]);
  });

  it("y el invariante sigue: se abre una vez y luego 410", async () => {
    await crearCuenta("marina", "Marina");
    const { token } = await createPass(db, { profileId: "p_marina", tema: "claro" });
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });
});
