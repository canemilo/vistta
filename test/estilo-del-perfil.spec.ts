import { describe, it, expect, beforeEach } from "vitest";
import { createPass } from "../src/lib/pass";
import { ProfileDataSchema } from "../src/schemas";
import { call, crearCuenta, db, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

const JSON_HEADERS = { "content-type": "application/json" };

async function abrir(token: string) {
  const res = await call("/api/open/" + token);
  return (await res.json()) as { estilo: string; tema: string };
}

/**
 * El ESTILO del dosier: con cuánto aire se lee.
 *
 * Tres valores resueltos —`sobrio`, `editorial`, `compacto`— y ni uno más. Lo
 * que se busca es quitarle decisiones a quien monta el perfil, no darle un
 * editor de temas.
 *
 * Lo que estas pruebas defienden, por orden de importancia:
 *
 *   1. Que el contenido ANTERIOR a este campo siga siendo válido. Es la misma
 *      regla que `display` en las galerías, y por el mismo motivo: si fuera
 *      obligatorio, guardar un perfil de antes empezaría a fallar.
 *   2. Que NO decida claro u oscuro. Eso es `passes.tema`, lo elige quien manda
 *      el enlace y viaja con él. Con dos dueños para la misma decisión, la
 *      respuesta a «¿por qué se ve oscuro si lo puse claro?» dependería de cuál
 *      gana.
 */
describe("el estilo del perfil, en el esquema", () => {
  it("es opcional: un perfil sin él sigue siendo válido", () => {
    const r = ProfileDataSchema.safeParse({ intro: "Hola", sections: [] });
    expect(r.success).toBe(true);
    expect(r.success && r.data.estilo).toBeUndefined();
  });

  it("admite los tres, y solo los tres", () => {
    for (const estilo of ["sobrio", "editorial", "compacto"]) {
      expect(ProfileDataSchema.safeParse({ estilo, sections: [] }).success, estilo).toBe(true);
    }
    for (const estilo of ["claro", "oscuro", "", "SOBRIO", "editorial ", 1, null]) {
      expect(ProfileDataSchema.safeParse({ estilo, sections: [] }).success, String(estilo)).toBe(
        false
      );
    }
  });

  /*
   * `claro` y `oscuro` NO son estilos, y esto es lo que lo deja escrito en una
   * prueba y no solo en un comentario. Es lo primero que alguien intentaría
   * añadir aquí.
   */
  it("no admite claro ni oscuro: ese es el tema del PASE", () => {
    expect(ProfileDataSchema.safeParse({ estilo: "claro", sections: [] }).success).toBe(false);
    expect(ProfileDataSchema.safeParse({ estilo: "oscuro", sections: [] }).success).toBe(false);
  });
});

describe("el estilo llega hasta quien abre el pase", () => {
  it("sin elegir nada, el pase se abre en sobrio", async () => {
    await crearCuenta("marina", "Marina");
    const { token } = await createPass(db, { profileId: "p_marina" });
    expect((await abrir(token)).estilo).toBe("sobrio");
  });

  it("lo que se guarda en el perfil es lo que recibe el viewer", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");

    const guardado = await call("/api/profiles/p_marina", {
      method: "PUT",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: { estilo: "editorial", sections: [] } }),
    });
    expect(guardado.status).toBe(200);

    const { token } = await createPass(db, { profileId: "p_marina" });
    expect((await abrir(token)).estilo).toBe("editorial");
  });

  /*
   * Los dos a la vez, que es donde se vería la confusión si la hubiera: el
   * estilo sale del PERFIL y el tema del PASE, y ninguno pisa al otro.
   */
  it("el estilo del perfil y el tema del pase no se pisan", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");
    await call("/api/profiles/p_marina", {
      method: "PUT",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: { estilo: "compacto", sections: [] } }),
    });

    const { token } = await createPass(db, { profileId: "p_marina", tema: "claro" });
    const vista = await abrir(token);
    expect(vista.estilo).toBe("compacto");
    expect(vista.tema).toBe("claro");
  });

  it("un estilo inventado no se guarda: el servidor manda", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina");
    const res = await call("/api/profiles/p_marina", {
      method: "PUT",
      headers: { ...JSON_HEADERS, authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: { estilo: "neón", sections: [] } }),
    });
    expect(res.status).toBe(400);
  });
});
