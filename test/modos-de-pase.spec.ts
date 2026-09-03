import { describe, it, expect, beforeEach } from "vitest";
import {
  createPass,
  ModoNoPermitidoError,
  ParametroDeModoError,
  consumePass,
} from "../src/lib/pass";
import { cambiarPlan } from "../src/lib/congelado";
import { PLANES, VENTANA_MINIMA_MS } from "../src/lib/planes";
import { calentarPool, call, crearCuenta, db, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

const HORA = 60 * 60 * 1000;

/** Cuenta con su perfil y el plan que haga falta para los modos nuevos. */
async function cuenta(plan: "prueba" | "pro" | "boveda" = "pro", userId = "marina") {
  await crearCuenta(userId, "Marina");
  if (plan !== "prueba") await cambiarPlan(db, userId, plan);
  return { userId, perfilId: `p_${userId}` };
}

describe("modos de expiración del pase", () => {
  /*
   * EL INVARIANTE DE SIEMPRE. Va el primero a propósito: es lo único que este
   * producto promete, y todo lo de este archivo se ha construido alrededor de
   * no tocarlo. Si algún día se pone rojo, no se arregla el test.
   */
  it("modo `unico`: se abre una vez y la segunda queda denegado", async () => {
    const { perfilId } = await cuenta();
    const { token, modo } = await createPass(db, { profileId: perfilId });
    expect(modo).toBe("unico");
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  it("modo `accesos` con tres: 200, 200, 200 y luego 410", async () => {
    const { perfilId } = await cuenta();
    const { token } = await createPass(db, {
      profileId: perfilId,
      modo: "accesos",
      maxAccesos: 3,
    });
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  /*
   * LA PRUEBA QUE JUSTIFICA EL DISEÑO.
   *
   * Un `SELECT` del contador y un `UPDATE` después son dos sentencias, y entre
   * las dos caben las otras quince peticiones leyendo el mismo número: se
   * colarían todas. Con el UPDATE único, la que despierta reevalúa su WHERE
   * contra la fila ya cambiada y solo pasan las tres que caben.
   *
   * Dos peticiones NO valen para verlo: casi nunca se solapan. Hacen falta 16 y
   * `calentarPool()` antes, o el pool frío serializa la ráfaga y el test da
   * verde con el código roto.
   *
   * Verificado por mutación el 2026-09-03: partiendo el UPDATE en un SELECT del
   * contador y un UPDATE después, pasan 15 de 16 en vez de 3. No es un fallo
   * sutil: es el pase entero abriéndose cinco veces de más.
   */
  it("modo `accesos`: una ráfaga no abre más veces de las permitidas", async () => {
    const { perfilId } = await cuenta();
    const { token } = await createPass(db, {
      profileId: perfilId,
      modo: "accesos",
      maxAccesos: 3,
    });

    await calentarPool();
    const respuestas = await Promise.all(
      Array.from({ length: 16 }, () => call("/api/open/" + token))
    );
    expect(respuestas.filter((r) => r.status === 200)).toHaveLength(3);
    expect(respuestas.filter((r) => r.status === 410)).toHaveLength(13);

    // Y el contador de la base cuadra con lo servido: ni una apertura fantasma.
    const fila = await db.one<{ accesos_usados: number; status: string }>(
      "SELECT accesos_usados, status FROM vistta.passes"
    );
    expect(fila?.accesos_usados).toBe(3);
    expect(fila?.status).toBe("consumed");
  });

  it("modo `ventana`: abre varias veces dentro y queda denegado al pasarse", async () => {
    const { perfilId } = await cuenta();
    const { token } = await createPass(db, {
      profileId: perfilId,
      modo: "ventana",
      ventanaMs: 2 * HORA,
    });
    expect((await call("/api/open/" + token)).status).toBe(200);
    expect((await call("/api/open/" + token)).status).toBe(200);

    // Se envejece la ventana, que es lo que no se puede esperar en un test.
    await db.query("UPDATE vistta.passes SET valido_hasta = $1", [Date.now() - 1000]);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  it("modo `ventana`: la ventana se cuenta desde la PRIMERA apertura, no desde que se creó", async () => {
    const { perfilId } = await cuenta();
    const antes = Date.now();
    const { token } = await createPass(db, {
      profileId: perfilId,
      modo: "ventana",
      ventanaMs: 2 * HORA,
    });

    const sinAbrir = await db.one<{
      primera_apertura_at: number | null;
      valido_hasta: number | null;
    }>("SELECT primera_apertura_at, valido_hasta FROM vistta.passes");
    expect(sinAbrir?.primera_apertura_at).toBeNull();
    expect(sinAbrir?.valido_hasta).toBeNull();

    await call("/api/open/" + token);
    const abierto = await db.one<{ primera_apertura_at: number; valido_hasta: number }>(
      "SELECT primera_apertura_at, valido_hasta FROM vistta.passes"
    );
    expect(abierto!.primera_apertura_at).toBeGreaterThanOrEqual(antes);
    expect(abierto!.valido_hasta).toBe(abierto!.primera_apertura_at + 2 * HORA);
  });

  /*
   * El plazo de primera apertura sigue vivo y significa lo de siempre: si nadie
   * abre el enlace a tiempo, el pase muere sin usarse. La ventana no lo tapa,
   * porque la ventana no existe hasta que alguien entra.
   */
  it("modo `ventana`: si nunca se abre y vence el plazo, queda denegado", async () => {
    const { perfilId } = await cuenta();
    const { token } = await createPass(db, {
      profileId: perfilId,
      modo: "ventana",
      ventanaMs: 2 * HORA,
    });
    await db.query("UPDATE vistta.passes SET expires_at = $1", [Date.now() - 1000]);
    expect((await call("/api/open/" + token)).status).toBe(410);
  });

  it("un pase de accesos lleva ventana aunque no se pida: ninguno es inmortal", async () => {
    const { perfilId } = await cuenta();
    await createPass(db, { profileId: perfilId, modo: "accesos", maxAccesos: 3 });
    const fila = await db.one<{ ventana_ms: string | number }>(
      "SELECT ventana_ms FROM vistta.passes"
    );
    expect(Number(fila?.ventana_ms)).toBeGreaterThan(0);
  });

  it("denegar no dice por qué: agotado, fuera de ventana o inexistente dan lo mismo", async () => {
    const { perfilId } = await cuenta();
    const agotado = await createPass(db, { profileId: perfilId, modo: "accesos", maxAccesos: 2 });
    await call("/api/open/" + agotado.token);
    await call("/api/open/" + agotado.token);

    const fuera = await createPass(db, {
      profileId: perfilId,
      modo: "ventana",
      ventanaMs: 2 * HORA,
    });
    await call("/api/open/" + fuera.token);
    await db.query("UPDATE vistta.passes SET valido_hasta = $1 WHERE modo = 'ventana'", [
      Date.now() - 1000,
    ]);

    const cuerpos = await Promise.all(
      [agotado.token, fuera.token, "token-que-no-existe"].map(async (t) => {
        const res = await call("/api/open/" + t);
        return { status: res.status, cuerpo: await res.text() };
      })
    );
    expect(cuerpos.map((c) => c.status)).toEqual([410, 410, 410]);
    expect(new Set(cuerpos.map((c) => c.cuerpo)).size).toBe(1);
  });
});

describe("los modos, contra el plan", () => {
  it("el plan Prueba solo da para un solo uso", async () => {
    const { perfilId } = await cuenta("prueba");
    await expect(
      createPass(db, { profileId: perfilId, modo: "accesos", maxAccesos: 3 })
    ).rejects.toBeInstanceOf(ModoNoPermitidoError);
    await expect(createPass(db, { profileId: perfilId })).resolves.toBeTruthy();
  });

  it("y la ruta responde 403, no un pase de otro modo en silencio", async () => {
    await cuenta("prueba");
    const sesion = await panelSession("marina");
    const res = await call("/api/passes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ profileId: "p_marina", modo: "ventana", ventanaMs: 2 * HORA }),
    });
    expect(res.status).toBe(403);
  });

  it("pasarse del tope del plan es 400, y el tope sale de planes.ts", async () => {
    const { perfilId } = await cuenta("pro");
    const tope = PLANES.pro.maxAccesos!;
    await expect(
      createPass(db, { profileId: perfilId, modo: "accesos", maxAccesos: tope + 1 })
    ).rejects.toBeInstanceOf(ParametroDeModoError);
    await expect(
      createPass(db, { profileId: perfilId, modo: "accesos", maxAccesos: tope })
    ).resolves.toBeTruthy();
  });

  it("la ventana máxima también sale del plan", async () => {
    const { perfilId } = await cuenta("pro");
    const tope = PLANES.pro.ventanaMaxMs!;
    await expect(
      createPass(db, { profileId: perfilId, modo: "ventana", ventanaMs: tope + 1 })
    ).rejects.toBeInstanceOf(ParametroDeModoError);
    await expect(
      createPass(db, { profileId: perfilId, modo: "ventana", ventanaMs: VENTANA_MINIMA_MS })
    ).resolves.toBeTruthy();
  });

  it("Bóveda llega más lejos que Pro, y ninguno pasa de siete días", async () => {
    expect(PLANES.boveda.maxAccesos!).toBeGreaterThan(PLANES.pro.maxAccesos!);
    expect(PLANES.boveda.ventanaMaxMs!).toBeGreaterThan(PLANES.pro.ventanaMaxMs!);
    // Siete días es el techo duro: la retención del plan más corto.
    expect(PLANES.boveda.ventanaMaxMs!).toBeLessThanOrEqual(7 * 24 * HORA);
  });
});

describe("un pase abrible sigue contando y sigue protegiendo", () => {
  /*
   * Las dos consultas que comparten predicado con el consumo. Si divergen, la
   * que se equivoca es la purga, y equivocarse ahí borra una foto que un pase
   * vivo todavía puede pedir.
   */
  it("un pase de ventana ya abierto sigue contando para el límite del plan", async () => {
    const { userId, perfilId } = await cuenta("pro");
    const { token } = await createPass(db, {
      profileId: perfilId,
      modo: "ventana",
      ventanaMs: 2 * HORA,
    });
    await consumePass(db, token);

    // Su plazo de primera apertura ya no pinta nada: el pase sigue abriéndose.
    await db.query("UPDATE vistta.passes SET expires_at = $1", [Date.now() - 1000]);
    expect((await call("/api/open/" + token)).status).toBe(200);

    const { pasesAbiertos } = await import("../src/lib/cuentas");
    expect(await pasesAbiertos(db, userId)).toBe(1);
  });
});

describe("el listado de pases del panel", () => {
  it("dice el estado real de cada pase, y nunca el token", async () => {
    const { perfilId } = await cuenta("pro");
    const sesion = await panelSession("marina");

    const tresAccesos = await createPass(db, {
      profileId: perfilId,
      modo: "accesos",
      maxAccesos: 3,
    });
    await call("/api/open/" + tresAccesos.token);
    const gastado = await createPass(db, { profileId: perfilId });
    await call("/api/open/" + gastado.token);

    const res = await call(`/api/passes?profileId=${perfilId}`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(200);
    const cuerpo = await res.text();
    const { passes } = JSON.parse(cuerpo) as {
      passes: {
        modo: string;
        estado: string;
        accesosUsados: number;
        maxAccesos: number | null;
      }[];
    };

    const accesos = passes.find((p) => p.modo === "accesos")!;
    expect(accesos.estado).toBe("abrible");
    expect(accesos.accesosUsados).toBe(1);
    expect(accesos.maxAccesos).toBe(3);

    expect(passes.find((p) => p.modo === "unico")!.estado).toBe("agotado");

    // El token solo existe en la URL que se mandó; en la base vive su hash.
    expect(cuerpo).not.toContain(tresAccesos.token);
    expect(cuerpo).not.toContain(gastado.token);
  });

  it("no enseña los pases de otro", async () => {
    await cuenta("pro", "marina");
    await crearCuenta("otro", "Otro");
    const sesion = await panelSession("otro", "203.0.113.77");
    const res = await call("/api/passes?profileId=p_marina", {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(404);
  });
});
