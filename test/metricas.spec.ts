import { describe, it, expect, beforeEach } from "vitest";
import { createPass } from "../src/lib/pass";
import { resumenDeLectura, purgarEventos, MS_VISIBLE_MAXIMO } from "../src/lib/eventos";
import { cambiarPlan } from "../src/lib/congelado";
import { RETENCION_EVENTOS_MS } from "../src/lib/planes";
import { call, crearCuenta, db, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

const JSON_HEADERS = { "content-type": "application/json" };

async function cuentaPro(userId = "marina") {
  await crearCuenta(userId, "Marina");
  await cambiarPlan(db, userId, "pro");
  return { userId, perfilId: `p_${userId}` };
}

/** Abre un pase y devuelve el testigo de telemetría que el servidor emite. */
async function abrirYObtenerTestigo(perfilId: string) {
  const { token, id } = await createPass(db, { profileId: perfilId });
  const res = await call("/api/open/" + token);
  const cuerpo = (await res.json()) as { eventos: string | null };
  return { passId: id, testigo: cuerpo.eventos };
}

async function mandarEventos(testigo: string, eventos: unknown[]) {
  return call("/api/passes/eventos", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ testigo, eventos }),
  });
}

describe("recogida de métricas", () => {
  it("el plan decide: en Prueba no se emite testigo, así que no se puede medir", async () => {
    await crearCuenta("basica", "Básica");
    const { testigo } = await abrirYObtenerTestigo("p_basica");
    expect(testigo).toBeNull();
  });

  it("en Pro sí, y los eventos se guardan", async () => {
    const { perfilId } = await cuentaPro();
    const { passId, testigo } = await abrirYObtenerTestigo(perfilId);
    expect(testigo).not.toBeNull();

    const res = await mandarEventos(testigo!, [
      { tipo: "apertura" },
      { tipo: "seccion", seccionIdx: 0, msVisible: 12_000 },
      { tipo: "seccion", seccionIdx: 1, msVisible: 40_000 },
      { tipo: "medio", mediaId: "m1", msVisible: 9_000 },
      { tipo: "cierre" },
    ]);
    expect(res.status).toBe(204);

    const resumen = await resumenDeLectura(db, passId);
    expect(resumen.hayDatos).toBe(true);
    expect(resumen.msTotales).toBe(61_000);
    expect(resumen.secciones[0]).toEqual({ seccionIdx: 1, msVisible: 40_000 });
    expect(resumen.medios[0]).toEqual({ mediaId: "m1", msVisible: 9_000 });
  });

  /*
   * Lo que manda esto es un navegador, y un navegador se puede manipular. Sin
   * tope, alguien inyecta «cuatro horas en la sección Planos» y el panel se lo
   * enseña a su dueño como si fuera cierto.
   */
  it("una cifra absurda no entra", async () => {
    const { perfilId } = await cuentaPro();
    const { passId, testigo } = await abrirYObtenerTestigo(perfilId);

    const res = await mandarEventos(testigo!, [
      { tipo: "seccion", seccionIdx: 0, msVisible: MS_VISIBLE_MAXIMO * 50 },
    ]);
    // Se rechaza el envío entero: no se recorta en silencio una cifra inventada.
    expect(res.status).toBe(204);
    expect((await resumenDeLectura(db, passId)).hayDatos).toBe(false);
  });

  it("sin testigo válido no se guarda nada", async () => {
    const { perfilId } = await cuentaPro();
    const { passId } = await abrirYObtenerTestigo(perfilId);

    for (const malo of ["", "cualquier-cosa", `${passId}.999999999.deadbeef`]) {
      await mandarEventos(malo, [{ tipo: "seccion", seccionIdx: 0, msVisible: 1000 }]);
    }
    expect((await resumenDeLectura(db, passId)).hayDatos).toBe(false);
  });

  it("el testigo de un pase no sirve para meter eventos en otro", async () => {
    const { perfilId } = await cuentaPro();
    const a = await abrirYObtenerTestigo(perfilId);
    const b = await abrirYObtenerTestigo(perfilId);

    await mandarEventos(a.testigo!, [{ tipo: "seccion", seccionIdx: 0, msVisible: 5_000 }]);
    expect((await resumenDeLectura(db, a.passId)).msTotales).toBe(5_000);
    expect((await resumenDeLectura(db, b.passId)).hayDatos).toBe(false);
  });

  /*
   * Telemetría, no funcionalidad: pase lo que pase con el contenido, el viewer
   * recibe 204 y sigue enseñando el dossier. Un 400 aquí sería una consola roja
   * en la cara de alguien que solo está mirando unas fotos.
   */
  it("un envío basura no rompe nada: siempre 204", async () => {
    const { testigo } = await abrirYObtenerTestigo((await cuentaPro()).perfilId);
    for (const cuerpo of ['{"no":"esto"}', "[]", "no es json", '{"testigo":123}']) {
      const res = await call("/api/passes/eventos", {
        method: "POST",
        headers: JSON_HEADERS,
        body: cuerpo,
      });
      expect(res.status).toBe(204);
    }
    expect(testigo).not.toBeNull();
  });
});

describe("lo que NO se guarda de quien lee", () => {
  it("no hay columnas para IP, dispositivo ni navegador", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'vistta' AND table_name = 'pass_events'`
    );
    const columnas = rows.map((r) => r.column_name).sort();
    expect(columnas).toEqual([
      "id",
      "media_id",
      "ms_visible",
      "pass_id",
      "seccion_idx",
      "tipo",
      "ts",
    ]);
    // Que no se rellenen no basta: no deben existir.
    for (const prohibida of ["ip", "ip_hash", "user_agent", "dispositivo", "huella"]) {
      expect(columnas).not.toContain(prohibida);
    }
  });

  it("el resumen que sale al panel no lleva instantes, solo sumas", async () => {
    const { perfilId } = await cuentaPro();
    const { passId, testigo } = await abrirYObtenerTestigo(perfilId);
    await mandarEventos(testigo!, [{ tipo: "seccion", seccionIdx: 0, msVisible: 3_000 }]);

    const resumen = await resumenDeLectura(db, passId);
    expect(Object.keys(resumen).sort()).toEqual(["hayDatos", "medios", "msTotales", "secciones"]);
    expect(JSON.stringify(resumen)).not.toContain("ts");
  });
});

describe("retención", () => {
  it("los eventos se van con el pase, sin trabajo de limpieza", async () => {
    const { perfilId } = await cuentaPro();
    const { passId, testigo } = await abrirYObtenerTestigo(perfilId);
    await mandarEventos(testigo!, [{ tipo: "seccion", seccionIdx: 0, msVisible: 1_000 }]);

    await db.query("DELETE FROM vistta.passes WHERE id = $1", [passId]);
    const quedan = await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vistta.pass_events WHERE pass_id = $1`,
      [passId]
    );
    expect(quedan?.n).toBe(0);
  });

  it("y aunque el pase siga, la actividad caduca al plazo declarado", async () => {
    const { perfilId } = await cuentaPro();
    const { passId, testigo } = await abrirYObtenerTestigo(perfilId);
    await mandarEventos(testigo!, [{ tipo: "seccion", seccionIdx: 0, msVisible: 1_000 }]);

    // Un día antes del plazo, siguen ahí.
    await purgarEventos(db, RETENCION_EVENTOS_MS, Date.now() + RETENCION_EVENTOS_MS - 86_400_000);
    expect((await resumenDeLectura(db, passId)).hayDatos).toBe(true);

    // Un día después, no.
    await purgarEventos(db, RETENCION_EVENTOS_MS, Date.now() + RETENCION_EVENTOS_MS + 86_400_000);
    expect((await resumenDeLectura(db, passId)).hayDatos).toBe(false);
  });
});

describe("quién puede ver la lectura", () => {
  it("su dueño sí", async () => {
    const { perfilId } = await cuentaPro();
    const sesion = await panelSession("marina");
    const { passId, testigo } = await abrirYObtenerTestigo(perfilId);
    await mandarEventos(testigo!, [{ tipo: "seccion", seccionIdx: 0, msVisible: 7_000 }]);

    const res = await call(`/api/passes/${passId}/lectura`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { msTotales: number }).msTotales).toBe(7_000);
  });

  it("otro cliente no, y recibe 404", async () => {
    const { perfilId } = await cuentaPro("marina");
    const { passId } = await abrirYObtenerTestigo(perfilId);
    await crearCuenta("otro", "Otro");
    const sesion = await panelSession("otro", "203.0.113.95");

    const res = await call(`/api/passes/${passId}/lectura`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(404);
  });

  it("y sin sesión, tampoco", async () => {
    const { perfilId } = await cuentaPro();
    const { passId } = await abrirYObtenerTestigo(perfilId);
    expect((await call(`/api/passes/${passId}/lectura`)).status).toBe(401);
  });
});
