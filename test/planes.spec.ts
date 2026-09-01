import { describe, it, expect, beforeEach } from "vitest";
import { createPass, DemasiadosPasesError } from "../src/lib/pass";
import { activarPerfil, ajustarAlPlan, cambiarPlan } from "../src/lib/congelado";
import { purgar } from "../src/lib/purga";
import { reservarMedio, CuotaExcedidaError } from "../src/lib/media-store";
import { GRACIA_CONGELADO_MS, PLANES } from "../src/lib/planes";
import { LIMITE_POR_TIPO } from "../src/lib/sniff";
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

/** Cuenta con su perfil (el que crea `crearUsuario`) y sesión abierta. */
async function cuenta(userId = "marina", ip = "203.0.113.100") {
  await crearCuenta(userId, "Marina");
  return { userId, perfilId: `p_${userId}`, sesion: await panelSession(userId, ip) };
}

/** Crea perfiles extra saltándose el límite, para preparar el escenario. */
async function perfilesExtra(userId: string, cuantos: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < cuantos; i++) {
    ids.push(await seedProfile(`p_${userId}_x${i}`, { sections: [] }, userId));
  }
  return ids;
}

describe("límites del plan", () => {
  it("el plan decide la cuota del perfil, no una constante del código", async () => {
    const { userId, perfilId } = await cuenta();

    // Se llena la cuota de 'prueba' a base de vídeos del tamaño máximo. No cabe
    // de una sola reserva: el límite POR TIPO es otra cosa y sigue vigente.
    const trozo = LIMITE_POR_TIPO.video;
    for (let queda = PLANES.prueba.cuotaPorPerfil; queda > 0; queda -= trozo) {
      await reservarMedio(db, {
        profileId: perfilId,
        kind: "video",
        declaredBytes: Math.min(trozo, queda),
      });
    }

    // Llena hasta el borde: ni un byte más.
    await expect(
      reservarMedio(db, { profileId: perfilId, kind: "image", declaredBytes: 1 })
    ).rejects.toThrow(CuotaExcedidaError);

    // Subir de plan abre sitio sin tocar nada de lo que ya había.
    await cambiarPlan(db, userId, "boveda");
    await expect(
      reservarMedio(db, { profileId: perfilId, kind: "image", declaredBytes: 1 })
    ).resolves.toBeTruthy();
  });

  it("una ráfaga de pases no se salta el límite de simultáneos", async () => {
    const { perfilId } = await cuenta();
    const limite = PLANES.prueba.pasesSimultaneos;

    /*
     * El tercer invariante de concurrencia. Se prueba igual que los otros dos y
     * por el mismo motivo: con dos peticiones el fallo no aparece. Verificado
     * por mutación quitando el `FOR UPDATE` de la fila de la cuenta.
     */
    const intentos = await Promise.allSettled(
      Array.from({ length: 16 }, () => createPass(db, { profileId: perfilId }))
    );
    expect(intentos.filter((r) => r.status === "fulfilled")).toHaveLength(limite);
    expect(
      intentos.filter((r) => r.status === "rejected" && r.reason instanceof DemasiadosPasesError)
    ).toHaveLength(16 - limite);
  });

  it("un pase consumido deja hueco para el siguiente", async () => {
    const { perfilId } = await cuenta();
    const limite = PLANES.prueba.pasesSimultaneos;

    const pases = [];
    for (let i = 0; i < limite; i++) pases.push(await createPass(db, { profileId: perfilId }));
    await expect(createPass(db, { profileId: perfilId })).rejects.toThrow(DemasiadosPasesError);

    // El límite es de enlaces VIVOS, no de enlaces creados en total.
    await callAs("203.0.113.101", "/api/open/" + pases[0].token);
    await expect(createPass(db, { profileId: perfilId })).resolves.toBeTruthy();
  });

  it("una ráfaga de creaciones de perfil no se salta el límite", async () => {
    const { userId, sesion } = await cuenta();
    await cambiarPlan(db, userId, "pro");
    const limite = PLANES.pro.perfiles;

    const crear = () =>
      callAs("203.0.113.102", "/api/profiles", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
        body: JSON.stringify({ displayName: "Nuevo" }),
      });

    const respuestas = await Promise.all(Array.from({ length: 16 }, crear));
    const creados = respuestas.filter((r) => r.status === 201);
    // Ya tenía uno (el que crea la cuenta), así que solo caben los que faltan.
    expect(creados).toHaveLength(limite - 1);
    expect(respuestas.filter((r) => r.status === 409)).toHaveLength(16 - (limite - 1));
  });
});

describe("congelado al bajar de plan", () => {
  it("bajar de plan congela lo que sobra y NO borra nada", async () => {
    const { userId, perfilId } = await cuenta();
    await cambiarPlan(db, userId, "boveda");
    const extra = await perfilesExtra(userId, 2);

    const resultado = await cambiarPlan(db, userId, "prueba");
    expect(resultado.activos).toBe(PLANES.prueba.perfiles);
    expect(resultado.congelados).toEqual(extra);

    // Lo importante: siguen existiendo, enteros.
    const { rows } = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM vistta.profiles WHERE owner_id = $1 ORDER BY created_at, id`.replace(
        "$1",
        `'${userId}'`
      )
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.id === perfilId)?.status).toBe("activo");
  });

  it("el cliente elige cuál queda activo, y se intercambian", async () => {
    const { userId, perfilId } = await cuenta();
    await cambiarPlan(db, userId, "boveda");
    const [otro] = await perfilesExtra(userId, 1);
    await cambiarPlan(db, userId, "prueba");

    // Con un solo perfil de plan, activar el otro tiene que sacar al primero.
    expect(await activarPerfil(db, userId, otro)).toBe(true);
    const estados = await estadoDe(userId);
    expect(estados[otro]).toBe("activo");
    expect(estados[perfilId]).toBe("congelado");

    // Y se puede volver: la elección no es de un solo sentido.
    await activarPerfil(db, userId, perfilId);
    expect((await estadoDe(userId))[perfilId]).toBe("activo");
  });

  it("subir de plan descongela solo, sin que el cliente rescate nada a mano", async () => {
    const { userId } = await cuenta();
    await cambiarPlan(db, userId, "boveda");
    await perfilesExtra(userId, 2);
    await cambiarPlan(db, userId, "prueba");
    expect(Object.values(await estadoDe(userId)).filter((s) => s === "congelado")).toHaveLength(2);

    await cambiarPlan(db, userId, "pro");
    expect(Object.values(await estadoDe(userId)).filter((s) => s === "activo")).toHaveLength(3);
  });

  it("activar un perfil ajeno no hace nada", async () => {
    const { userId } = await cuenta("marina");
    await crearCuenta("otro", "Otro");
    expect(await activarPerfil(db, "otro", `p_${userId}`)).toBe(false);
  });

  it("descongelar cancela la cuenta atrás en vez de pausarla", async () => {
    const { userId, perfilId } = await cuenta();
    await cambiarPlan(db, userId, "boveda");
    const [otro] = await perfilesExtra(userId, 1);
    await cambiarPlan(db, userId, "prueba");

    await activarPerfil(db, userId, otro); // congela perfilId
    await activarPerfil(db, userId, perfilId); // lo rescata
    const fila = await db.one<{ frozen_at: number | null }>(
      `SELECT frozen_at FROM vistta.profiles WHERE id = $1`,
      [perfilId]
    );
    expect(fila?.frozen_at).toBeNull();
  });
});

describe("un perfil congelado no trabaja, pero se puede ver", () => {
  async function conCongelado() {
    const { userId, perfilId, sesion } = await cuenta();
    await cambiarPlan(db, userId, "boveda");
    const [otro] = await perfilesExtra(userId, 1);
    await cambiarPlan(db, userId, "prueba");
    await activarPerfil(db, userId, otro); // deja perfilId congelado
    return { userId, congelado: perfilId, activo: otro, sesion };
  }

  it("no admite guardar contenido ni subir medios", async () => {
    const { congelado, sesion } = await conCongelado();
    const auth = { authorization: `Bearer ${sesion}` };

    const guardar = await callAs("203.0.113.110", `/api/profiles/${congelado}`, {
      method: "PUT",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ data: { sections: [] } }),
    });
    expect(guardar.status).toBe(404);

    const reservar = await callAs("203.0.113.111", "/api/media/presign", {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ profileId: congelado, kind: "image", bytes: 1024 }),
    });
    expect(reservar.status).toBe(404);
  });

  it("pero el cliente sí puede leerlo: tiene que ver qué va a perder", async () => {
    const { congelado, sesion } = await conCongelado();
    const res = await callAs("203.0.113.112", `/api/profiles/${congelado}`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(200);
  });

  it("un pase generado antes deja de abrirse cuando el perfil se congela", async () => {
    const { userId, perfilId } = await cuenta();
    await cambiarPlan(db, userId, "boveda");
    const [otro] = await perfilesExtra(userId, 1);
    const { token } = await createPass(db, { profileId: perfilId });

    await cambiarPlan(db, userId, "prueba");
    await activarPerfil(db, userId, otro); // congela perfilId

    // Para el cliente es lo mismo que un enlace ya usado: no se le cuenta la
    // situación comercial de quien se lo mandó.
    const res = await callAs("203.0.113.113", "/api/open/" + token);
    expect(res.status).toBe(410);
  });

  it("no genera pases nuevos", async () => {
    const { congelado } = await conCongelado();
    await expect(createPass(db, { profileId: congelado })).rejects.toThrow();
  });
});

describe("purga — la parte que sí borra", () => {
  const DIA = 24 * 60 * 60 * 1000;

  async function perfilConFoto(userId = "marina", ip = "203.0.113.120") {
    const { perfilId, sesion } = await cuenta(userId, ip);
    const { mediaId } = await subirMedio(sesion, perfilId, { ip });
    await callAs(ip, `/api/profiles/${perfilId}`, {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: galeriaCon(mediaId) }),
    });
    return { userId, perfilId, mediaId, sesion };
  }

  it("un medio se borra cuando pasa la retención del plan", async () => {
    const { perfilId, mediaId } = await perfilConFoto();

    // Dentro de plazo no se toca.
    expect((await purgar(db, storage, Date.now() + 6 * DIA)).mediosCaducados).toBe(0);

    // Pasados los 7 días de 'prueba', sí.
    expect((await purgar(db, storage, Date.now() + 8 * DIA)).mediosCaducados).toBe(1);
    expect(await db.one(`SELECT id FROM vistta.media WHERE id = $1`, [mediaId])).toBeNull();
    expect(await storage.get(`u/${perfilId}/${mediaId}`)).toBeNull();
  });

  it("en Bóveda no caduca NUNCA: `null` no es cero", async () => {
    const { userId, mediaId } = await perfilConFoto();
    await cambiarPlan(db, userId, "boveda");

    // Diez años después sigue ahí. Es lo que se paga en ese plan.
    expect((await purgar(db, storage, Date.now() + 3650 * DIA)).mediosCaducados).toBe(0);
    expect(await db.one(`SELECT id FROM vistta.media WHERE id = $1`, [mediaId])).not.toBeNull();
  });

  it("no se lleva un medio que un pase sin abrir todavía promete", async () => {
    const { perfilId, mediaId } = await perfilConFoto();

    // El caso real: la foto se subió hace ocho días —ya vencida para 'prueba'—
    // y el cliente acaba de mandar un pase que la enseña. Ese enlace ya salió;
    // tiene que seguir enseñando lo que prometía.
    await db.query(`UPDATE vistta.media SET confirmed_at = $1 WHERE id = $2`, [
      Date.now() - 8 * DIA,
      mediaId,
    ]);
    await db.query(`UPDATE vistta.users SET plan_since = $1 WHERE id = 'marina'`, [
      Date.now() - 30 * DIA,
    ]);
    await createPass(db, { profileId: perfilId });

    expect((await purgar(db, storage)).mediosCaducados).toBe(0);
    expect(await db.one(`SELECT id FROM vistta.media WHERE id = $1`, [mediaId])).not.toBeNull();

    // Y en cuanto el pase se abre o caduca, deja de protegerlo.
    await db.query(`UPDATE vistta.passes SET expires_at = $1`, [Date.now() - 1000]);
    expect((await purgar(db, storage)).mediosCaducados).toBe(1);
  });

  it("bajar de Bóveda no evapora el archivo esa misma noche", async () => {
    const { userId, mediaId } = await perfilConFoto();
    // El medio se subió hace mucho, pero la cuenta acaba de cambiar de plan.
    await db.query(`UPDATE vistta.media SET confirmed_at = $1 WHERE id = $2`, [
      Date.now() - 60 * DIA,
      mediaId,
    ]);
    await cambiarPlan(db, userId, "pro");

    // `plan_since` es de hoy, así que la purga aún no le aplica el plazo nuevo.
    expect((await purgar(db, storage)).mediosCaducados).toBe(0);
  });

  it("un perfil congelado se borra al agotar la gracia, y ni un minuto antes", async () => {
    const { userId, perfilId, mediaId } = await perfilConFoto();
    await cambiarPlan(db, userId, "boveda");
    const [otro] = await perfilesExtra(userId, 1);
    await cambiarPlan(db, userId, "prueba");
    await activarPerfil(db, userId, otro); // congela perfilId, con su foto dentro

    // Dentro de la gracia no se toca: es todo el sentido de que haya gracia.
    const casi = Date.now() + GRACIA_CONGELADO_MS - 1000;
    expect((await purgar(db, storage, casi)).perfilesBorrados).toBe(0);
    expect(await db.one(`SELECT id FROM vistta.profiles WHERE id = $1`, [perfilId])).not.toBeNull();

    const despues = Date.now() + GRACIA_CONGELADO_MS + 1000;
    expect((await purgar(db, storage, despues)).perfilesBorrados).toBe(1);
    expect(await db.one(`SELECT id FROM vistta.profiles WHERE id = $1`, [perfilId])).toBeNull();
    // Y sus bytes también, no solo la fila.
    expect(await storage.get(`u/${perfilId}/${mediaId}`)).toBeNull();
  });

  it("no toca los perfiles activos por muy viejos que sean", async () => {
    const { perfilId } = await perfilConFoto();
    expect((await purgar(db, storage, Date.now() + 3650 * DIA)).perfilesBorrados).toBe(0);
    expect(await db.one(`SELECT id FROM vistta.profiles WHERE id = $1`, [perfilId])).not.toBeNull();
  });
});

async function estadoDe(userId: string): Promise<Record<string, string>> {
  const { rows } = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM vistta.profiles WHERE owner_id = $1`,
    [userId]
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

// Sin usar, pero deja claro que `ajustarAlPlan` es la puerta de todo lo anterior.
void ajustarAlPlan;
