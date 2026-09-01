import { describe, it, expect, beforeEach } from "vitest";
import { createPass } from "../src/lib/pass";
import { PLANES } from "../src/lib/planes";
import { LIMITE_POR_TIPO } from "../src/lib/sniff";
import {
  DemasiadasReservasError,
  MAX_RESERVAS_ABIERTAS,
  cuotaUsada,
  reservarMedio,
} from "../src/lib/media-store";
import {
  calentarPool,
  call,
  callAs,
  crearCuenta,
  db,
  documentoPdf,
  imagenJpeg,
  panelSession,
  resetDb,
  seedProfile,
  subirMedio,
} from "./helpers";

beforeEach(resetDb);

/** El contenido de prueba se monta con los ids que devuelve la subida. */
function contenidoCon(ids: string[]) {
  return {
    tagline: "Fotografía de arquitectura",
    intro: "Trabajo reciente para estudios de arquitectura.",
    sections: [
      { type: "texto", title: "Sobre el encargo", body: "Dos semanas de rodaje en Praga." },
      {
        type: "proyecto",
        title: "Casa Vltava",
        body: "Serie completa.",
        items: [{ mediaId: ids[0], caption: "Fachada" }],
      },
      {
        type: "galeria",
        title: "Selección",
        items: [{ mediaId: ids[1] }, { mediaId: ids[2] }],
      },
    ],
  };
}

async function guardar(sesion: string, profileId: string, data: unknown) {
  return callAs("198.51.100.20", `/api/profiles/${profileId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
    body: JSON.stringify({ data }),
  });
}

/** Cuenta + perfil + sesión + tres fotos subidas. El punto de partida habitual. */
async function cuentaConTresFotos(userId = "marina", profileId = "pro_1") {
  await crearCuenta(userId, "Estudio Demo");
  await seedProfile(profileId, { sections: [] }, userId);
  const sesion = await panelSession(userId);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push((await subirMedio(sesion, profileId)).mediaId);
  }
  return { userId, profileId, sesion, ids };
}

describe("contenido del perfil", () => {
  it("el cliente guarda su contenido y el pase lo devuelve en secciones", async () => {
    const { profileId, sesion, ids } = await cuentaConTresFotos();

    expect((await guardar(sesion, profileId, contenidoCon(ids))).status).toBe(200);

    const { token } = await createPass(db, { profileId });
    const res = await callAs("198.51.100.21", "/api/open/" + token);
    const body = (await res.json()) as {
      profile: { tagline: string; intro: string };
      sections: { type: string; title?: string; body?: string; items: { url: string }[] }[];
    };

    expect(body.profile.tagline).toBe("Fotografía de arquitectura");
    expect(body.sections.map((s) => s.type)).toEqual(["texto", "proyecto", "galeria"]);
    expect(body.sections[0].items).toHaveLength(0);
    expect(body.sections[1].body).toBe("Serie completa.");
    expect(body.sections[2].items).toHaveLength(2);
    for (const item of body.sections[2].items) {
      expect(item.url).toMatch(/^\/m\/[0-9a-f-]{36}\?pid=.+&exp=\d+&sig=[0-9a-f]{64}$/);
    }
    // Ni claves de almacenamiento ni ids: el viewer solo recibe URLs firmadas.
    const json = JSON.stringify(body);
    expect(json).not.toContain('"key"');
    expect(json).not.toContain('"mediaId"');
    expect(json).not.toContain("u/pro_1/");
  });

  it("la respuesta del pase trae las dimensiones reales del medio", async () => {
    const { profileId, sesion, ids } = await cuentaConTresFotos();
    await guardar(sesion, profileId, contenidoCon(ids));

    const { token } = await createPass(db, { profileId });
    const body = (await (await callAs("198.51.100.25", "/api/open/" + token)).json()) as {
      sections: { items: { width: number | null; height: number | null }[] }[];
    };
    const item = body.sections[2].items[0];
    // 320×200 es lo que crea el arnés; sale de la base, no del cliente.
    expect(item.width).toBe(320);
    expect(item.height).toBe(200);
  });

  it("guardar y leer contenido exige autenticación", async () => {
    const profileId = await seedProfile("pro_1", { sections: [] }, await crearCuenta());
    const sinAuth = await call(`/api/profiles/${profileId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: { sections: [] } }),
    });
    expect(sinAuth.status).toBe(401);
    expect((await call(`/api/profiles/${profileId}`)).status).toBe(401);
  });

  it("rechaza un contenido con forma no válida", async () => {
    const userId = await crearCuenta();
    const profileId = await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    const res = await guardar(sesion, profileId, { sections: [{ type: "video", body: "x" }] });
    expect(res.status).toBe(400);
  });

  it("una cuenta no ve ni toca el perfil de otra", async () => {
    await crearCuenta("marina", "Marina");
    await crearCuenta("otro", "Otro");
    const ajeno = await seedProfile("pro_ajeno", { sections: [] }, "marina");
    const sesion = await panelSession("otro");
    const auth = { authorization: `Bearer ${sesion}` };

    // No aparece en su listado...
    const lista = await callAs("198.51.100.30", "/api/profiles", { headers: auth });
    const { profiles } = (await lista.json()) as { profiles: { id: string }[] };
    expect(profiles.map((p) => p.id)).not.toContain(ajeno);

    // ...ni se puede leer ni escribir: 404, no 403, para no confirmar que existe.
    expect(
      (await callAs("198.51.100.31", `/api/profiles/${ajeno}`, { headers: auth })).status
    ).toBe(404);
    expect((await guardar(sesion, ajeno, { sections: [] })).status).toBe(404);
  });

  it("el panel recupera lo guardado para seguir editando", async () => {
    const { profileId, sesion, ids } = await cuentaConTresFotos();
    await guardar(sesion, profileId, contenidoCon(ids));

    const res = await callAs("198.51.100.22", `/api/profiles/${profileId}`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    const body = (await res.json()) as {
      data: { sections: { type: string }[] };
      media: { id: string; width: number }[];
      quota: { usados: number; total: number };
    };
    expect(body.data.sections).toHaveLength(3);
    // El panel recibe aparte las dimensiones, para pintar la rejilla igual que el viewer.
    expect(body.media).toHaveLength(3);
    expect(body.media[0].width).toBe(320);
    expect(body.quota.usados).toBeGreaterThan(0);
  });

  it("un perfil con el formato antiguo se sigue viendo, sin las fotos que ya no valen", async () => {
    // Guardado antes del bloque D: los medios eran claves de almacenamiento.
    // Esas entradas se caen —no se pueden servir— pero el texto sobrevive: fallar
    // la validación entera dejaría el perfil en blanco, que es mucho peor.
    const profileId = await seedProfile(
      "pro_legado",
      { bio: "texto antiguo", media: [{ key: "viejo/1.jpg", type: "image" }] },
      await crearCuenta()
    );
    const { token } = await createPass(db, { profileId });
    const body = (await (await callAs("198.51.100.23", "/api/open/" + token)).json()) as {
      profile: { intro: string };
      sections: { type: string; items: unknown[] }[];
    };
    expect(body.profile.intro).toBe("texto antiguo");
    expect(body.sections).toEqual([]);
  });
});

describe("subida de medios", () => {
  async function presign(sesion: string, cuerpo: unknown, ip = "198.51.100.24") {
    return callAs(ip, "/api/media/presign", {
      method: "POST",
      headers: { authorization: `Bearer ${sesion}`, "content-type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
  }

  it("reserva y confirma, y el medio queda servible", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);

    const { mediaId } = await subirMedio(sesion, "pro_1");
    const fila = await db.one<{ status: string; mime: string; bytes: number; storage_key: string }>(
      `SELECT status, mime, bytes, storage_key FROM vistta.media WHERE id = $1`,
      [mediaId]
    );
    expect(fila?.status).toBe("ready");
    // El mime sale de los bytes, no de lo que dijera el cliente.
    expect(fila?.mime).toBe("image/jpeg");
    expect(fila?.bytes).toBeGreaterThan(0);
    // La clave la genera el servidor a partir del id: nada que venga del cliente.
    expect(fila?.storage_key).toBe(`u/pro_1/${mediaId}`);
  });

  it("los bytes que no son del tipo declarado no llegan a servirse", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);

    // Se reserva una imagen y se suben los bytes de un PDF.
    await expect(
      subirMedio(sesion, "pro_1", { kind: "image", bytes: documentoPdf() })
    ).rejects.toThrow(/415/);

    const fila = await db.one<{ status: string }>(
      `SELECT status FROM vistta.media WHERE profile_id = 'pro_1'`
    );
    expect(fila?.status).toBe("failed");
  });

  // Ojo al leer esto: lo que rechaza este caso NO es el detector de firmas sino
  // Sharp, que no puede decodificarlo. Son dos defensas distintas y se quedan
  // las dos; quien pine el detector es el caso de arriba (PDF por imagen).
  it("un contenido irreconocible se rechaza aunque diga ser una imagen", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);

    const basura = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    await expect(subirMedio(sesion, "pro_1", { kind: "image", bytes: basura })).rejects.toThrow(
      /415/
    );
  });

  it("el tamaño declarado no vale nada: manda el real", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);

    // Se declara 1 byte y se suben los de una foto entera.
    const reserva = await presign(sesion, { profileId: "pro_1", kind: "image", bytes: 1 });
    expect(reserva.status).toBe(201);
    const { mediaId, uploadUrl } = (await reserva.json()) as {
      mediaId: string;
      uploadUrl: string;
    };

    const foto = await imagenJpeg();
    const res = await callAs("198.51.100.24", uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${sesion}` },
      body: foto,
    });
    // Cabe en la cuota, así que se acepta, pero la fila guarda los bytes reales.
    expect(res.status).toBe(201);
    const fila = await db.one<{ bytes: number }>(`SELECT bytes FROM vistta.media WHERE id = $1`, [
      mediaId,
    ]);
    expect(fila?.bytes).toBe(foto.byteLength);
  });

  it("una reserva por encima del límite del tipo se rechaza antes de firmar", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);

    const res = await presign(sesion, {
      profileId: "pro_1",
      kind: "image",
      bytes: 11 * 1024 * 1024,
    });
    expect(res.status).toBe(413);
    // Y no se ha creado reserva alguna: nada que reaprovechar después.
    const { rowCount } = await db.query(`SELECT 1 FROM vistta.media`);
    expect(rowCount).toBe(0);
  });

  it("no se puede reservar en el perfil de otra cuenta", async () => {
    await crearCuenta("marina", "Marina");
    await crearCuenta("otro", "Otro");
    await seedProfile("pro_1", { sections: [] }, "marina");
    const res = await presign(
      await panelSession("otro", "198.51.100.41"),
      { profileId: "pro_1", kind: "image", bytes: 1024 },
      "198.51.100.40"
    );
    expect(res.status).toBe(404);
  });

  it("una ráfaga de reservas no se salta la cuota del perfil", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);

    /*
     * El segundo invariante de concurrencia del proyecto, y se prueba igual que
     * el primero: con una RÁFAGA. Dieciséis reservas del tamaño máximo de vídeo
     * piden muchísimo más de lo que cabe; solo pueden entrar las que quepan.
     *
     * El número de aceptadas se calcula, no se escribe: las cifras de los planes
     * las decide el cliente en `planes.ts` y este test no puede romperse cada
     * vez que las cambie.
     *
     * Comprobado por mutación: quitando el `FOR UPDATE` de la fila del perfil,
     * las dieciséis ven la misma suma y pasan casi todas.
     */
    await calentarPool();
    const trozo = LIMITE_POR_TIPO.video;
    const caben = Math.floor(PLANES.prueba.cuotaPorPerfil / trozo);
    const intentos = await Promise.allSettled(
      Array.from({ length: 16 }, () =>
        reservarMedio(db, { profileId: "pro_1", kind: "video", declaredBytes: trozo })
      )
    );
    expect(intentos.filter((r) => r.status === "fulfilled")).toHaveLength(caben);

    // Y lo comprometido más otro trozo ya no cabría: el corte está donde toca.
    const usada = await cuotaUsada(db, "pro_1");
    expect(usada).toBe(caben * trozo);
    expect(usada + trozo).toBeGreaterThan(PLANES.prueba.cuotaPorPerfil);
  });

  it("no se pueden acumular reservas sin confirmar", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);

    // Reservar un byte cada vez no toca la cuota en bytes, así que sin un tope
    // aparte una sesión válida podría crear filas sin fin.
    for (let i = 0; i < MAX_RESERVAS_ABIERTAS; i++) {
      await reservarMedio(db, { profileId: "pro_1", kind: "image", declaredBytes: 1 });
    }
    await expect(
      reservarMedio(db, { profileId: "pro_1", kind: "image", declaredBytes: 1 })
    ).rejects.toThrow(DemasiadasReservasError);

    expect(await cuotaUsada(db, "pro_1")).toBe(MAX_RESERVAS_ABIERTAS);
  });

  it("reservar exige autenticación", async () => {
    const res = await call("/api/media/presign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: "pro_1", kind: "image", bytes: 10 }),
    });
    expect(res.status).toBe(401);
  });

  it("una subida sin firma válida no se acepta aunque haya sesión", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    const reserva = await presign(sesion, { profileId: "pro_1", kind: "image", bytes: 1024 });
    const { uploadUrl } = (await reserva.json()) as { uploadUrl: string };

    const url = new URL(uploadUrl, "https://vistta.test");
    url.searchParams.set("sig", "0".repeat(64));
    const res = await callAs("198.51.100.26", url.pathname + url.search, {
      method: "PUT",
      headers: { authorization: `Bearer ${sesion}` },
      body: await imagenJpeg(),
    });
    expect(res.status).toBe(403);
  });

  it("la misma reserva no se puede confirmar dos veces", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    const reserva = await presign(sesion, { profileId: "pro_1", kind: "image", bytes: 4096 });
    const { uploadUrl } = (await reserva.json()) as { uploadUrl: string };
    const auth = { authorization: `Bearer ${sesion}` };

    const foto = await imagenJpeg();
    const primera = await callAs("198.51.100.27", uploadUrl, {
      method: "PUT",
      headers: auth,
      body: foto,
    });
    expect(primera.status).toBe(201);

    const segunda = await callAs("198.51.100.28", uploadUrl, {
      method: "PUT",
      headers: auth,
      body: foto,
    });
    // Ya no está 'pending': la reserva se gastó.
    expect(segunda.status).toBe(409);
  });
});
