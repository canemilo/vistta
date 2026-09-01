import { describe, it, expect, beforeEach } from "vitest";
import { encolar, completar, fallar, tomarTrabajo, MAX_INTENTOS } from "../src/lib/jobs";
import { pasarReaper, GRACIA_SIN_REFERENCIAS_MS } from "../src/lib/reaper";
import { TTL_RESERVA_MS, reservarMedio } from "../src/lib/media-store";
import { procesarUno, asegurarPeriodicos, TRABAJO_REAPER } from "../src/worker";
import {
  callAs,
  crearCuenta,
  db,
  galeriaCon,
  panelSession,
  resetDb,
  seedProfile,
  storage,
  subirMedio,
} from "./helpers";

beforeEach(resetDb);

describe("cola de trabajos", () => {
  it("un trabajo se toma una vez y solo una, aunque lleguen a la vez", async () => {
    await encolar(db, TRABAJO_REAPER);

    /*
     * Una RÁFAGA, no dos peticiones.
     *
     * Es la lección de D0: con dos intentos simultáneos, un "leer y luego
     * marcar" mal hecho pasa igual, porque casi nunca llegan a solaparse. Con
     * dieciséis el fallo aparece. Este test se ha comprobado por mutación:
     * sustituyendo el SKIP LOCKED por un SELECT y un UPDATE aparte, se pone
     * rojo.
     */
    const tomados = await Promise.all(Array.from({ length: 16 }, () => tomarTrabajo(db)));
    const conTrabajo = tomados.filter((t) => t !== null);

    expect(conTrabajo).toHaveLength(1);
    const fila = await db.one<{ attempts: number; status: string }>(
      `SELECT attempts, status FROM vistta.jobs`
    );
    // Y el contador de intentos tampoco se ha subido dieciséis veces.
    expect(fila?.attempts).toBe(1);
    expect(fila?.status).toBe("running");
  });

  it("no toma trabajos cuya hora no ha llegado", async () => {
    await encolar(db, TRABAJO_REAPER, {}, Date.now() + 60_000);
    expect(await tomarTrabajo(db)).toBeNull();
  });

  it("un trabajo fallido vuelve a la cola y acaba enterrándose", async () => {
    await encolar(db, TRABAJO_REAPER);
    let trabajo = await tomarTrabajo(db);
    expect(trabajo).not.toBeNull();

    // Los primeros fallos lo devuelven a 'pending', con espera.
    await fallar(db, trabajo!, new Error("Prueba"));
    let fila = await db.one<{ status: string }>(`SELECT status FROM vistta.jobs`);
    expect(fila?.status).toBe("pending");

    // Agotados los intentos, deja de reintentarse en vez de girar para siempre.
    trabajo = { ...trabajo!, attempts: MAX_INTENTOS };
    await fallar(db, trabajo, new Error("Prueba"));
    fila = await db.one<{ status: string }>(`SELECT status FROM vistta.jobs`);
    expect(fila?.status).toBe("failed");
  });

  it("un trabajo de tipo desconocido no tumba al trabajador", async () => {
    await encolar(db, "inventado");
    await expect(procesarUno({ db, storage })).resolves.toBe(true);
    const fila = await db.one<{ status: string; last_error: string }>(
      `SELECT status, last_error FROM vistta.jobs`
    );
    expect(fila?.status).toBe("pending");
    expect(fila?.last_error).toBe("Error");
  });

  it("con la cola vacía no hay nada que hacer", async () => {
    expect(await procesarUno({ db, storage })).toBe(false);
  });

  it("los trabajos periódicos se reencolan solos tras ejecutarse", async () => {
    await asegurarPeriodicos(db);
    // Encolarlos dos veces no duplica: la segunda ve que ya hay uno esperando.
    await asegurarPeriodicos(db);
    expect((await db.query(`SELECT 1 FROM vistta.jobs`)).rowCount).toBe(2);

    // Se vacía la cola: cada trabajo queda hecho y deja su sucesor esperando.
    while (await procesarUno({ db, storage })) {
      /* seguir */
    }
    const { rows } = await db.query<{ kind: string; status: string }>(
      `SELECT kind, status FROM vistta.jobs ORDER BY created_at`
    );
    expect(rows.filter((r) => r.status === "done")).toHaveLength(2);
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(2);
  });
});

describe("reaper de huérfanos", () => {
  async function cuenta(userId = "marina", profileId = "pro_1") {
    await crearCuenta(userId, "Marina");
    await seedProfile(profileId, { sections: [] }, userId);
    return { sesion: await panelSession(userId, "203.0.113.1"), profileId };
  }

  it("se lleva las reservas que nunca recibieron bytes", async () => {
    const { profileId } = await cuenta();
    const { mediaId } = await reservarMedio(db, {
      profileId,
      kind: "image",
      declaredBytes: 1024,
    });

    // Todavía no: la reserva está dentro de su plazo.
    expect((await pasarReaper(db, storage)).reservasCaducadas).toBe(0);

    // Pasado el plazo, sí. Se adelanta el reloj en vez de esperar media hora.
    const luego = Date.now() + TTL_RESERVA_MS + 1;
    expect((await pasarReaper(db, storage, luego)).reservasCaducadas).toBe(1);
    expect(await db.one(`SELECT id FROM vistta.media WHERE id = $1`, [mediaId])).toBeNull();
  });

  it("se lleva los bytes que no pasaron la inspección, y su objeto", async () => {
    const { sesion, profileId } = await cuenta();
    const pdf = new TextEncoder().encode("%PDF-1.4\n%%EOF\n");
    await expect(
      subirMedio(sesion, profileId, { kind: "image", bytes: pdf, ip: "203.0.113.2" })
    ).rejects.toThrow(/415/);

    expect((await pasarReaper(db, storage)).fallidos).toBe(1);
    expect((await db.query(`SELECT 1 FROM vistta.media`)).rowCount).toBe(0);
  });

  it("no toca un medio que el perfil sigue enseñando", async () => {
    const { sesion, profileId } = await cuenta();
    const { mediaId } = await subirMedio(sesion, profileId, { ip: "203.0.113.3" });
    await callAs("203.0.113.4", `/api/profiles/${profileId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: galeriaCon(mediaId) }),
    });

    // Aunque haya pasado de sobra el plazo: está referenciado.
    const luego = Date.now() + GRACIA_SIN_REFERENCIAS_MS + 1;
    expect((await pasarReaper(db, storage, luego)).sinReferencias).toBe(0);
    expect(await storage.get(`u/${profileId}/${mediaId}`)).not.toBeNull();
  });

  it("se lleva el medio que se quitó del perfil, pasada la gracia", async () => {
    const { sesion, profileId } = await cuenta();
    const { mediaId } = await subirMedio(sesion, profileId, { ip: "203.0.113.5" });

    // Nunca llegó a guardarse en el contenido: el usuario lo subió y lo descartó.
    expect((await pasarReaper(db, storage)).sinReferencias).toBe(0); // aún en gracia

    const luego = Date.now() + GRACIA_SIN_REFERENCIAS_MS + 1;
    expect((await pasarReaper(db, storage, luego)).sinReferencias).toBe(1);
    expect(await storage.get(`u/${profileId}/${mediaId}`)).toBeNull();
  });

  it("nunca se lleva lo que hay en la instantánea de un pase", async () => {
    const { sesion, profileId } = await cuenta();
    const { mediaId } = await subirMedio(sesion, profileId, { ip: "203.0.113.6" });
    await callAs("203.0.113.7", `/api/profiles/${profileId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: galeriaCon(mediaId) }),
    });
    const { createPass } = await import("../src/lib/pass");
    await createPass(db, { profileId });

    // El pase ya se envió: aunque ahora se quite del perfil, lo que se prometió
    // al cliente no puede desaparecer por detrás.
    await callAs("203.0.113.8", `/api/profiles/${profileId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: { sections: [] } }),
    });

    const luego = Date.now() + GRACIA_SIN_REFERENCIAS_MS + 1;
    expect((await pasarReaper(db, storage, luego)).sinReferencias).toBe(0);
    expect(await storage.get(`u/${profileId}/${mediaId}`)).not.toBeNull();
  });

  it("borrar un trabajo hecho lo deja fuera de la cola", async () => {
    const id = await encolar(db, TRABAJO_REAPER);
    await completar(db, id);
    expect(await tomarTrabajo(db)).toBeNull();
  });
});
