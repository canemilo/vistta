import { describe, it, expect, beforeEach } from "vitest";
import {
  CLAVE,
  callAs,
  crearCuenta,
  db,
  galeriaCon,
  panelSession,
  resetDb,
  storage,
  subirMedio,
} from "./helpers";

beforeEach(resetDb);

/**
 * Borrar un perfil.
 *
 * Existe porque crear sin poder deshacer es un callejón sin salida: el límite
 * del plan cuenta perfiles ACTIVOS, así que uno creado por error ocupaba una
 * plaza para siempre. Congelar no servía de sustituto: la purga se lleva un
 * congelado pasada la gracia, así que habría sido programar su destrucción sin
 * decirlo.
 */

const auth = (s: string) => ({ authorization: `Bearer ${s}` });

async function crearPerfil(sesion: string, nombre: string, ip = "198.51.100.10"): Promise<string> {
  const res = await callAs(ip, "/api/profiles", {
    method: "POST",
    headers: { ...auth(sesion), "content-type": "application/json" },
    body: JSON.stringify({ displayName: nombre }),
  });
  const cuerpo = (await res.json()) as { id: string };
  return cuerpo.id;
}

function borrar(sesion: string, id: string, confirmacion: string, ip = "198.51.100.11") {
  return callAs(ip, `/api/profiles/${id}`, {
    method: "DELETE",
    headers: { ...auth(sesion), "content-type": "application/json" },
    body: JSON.stringify({ confirmacion }),
  });
}

async function ponerPlan(userId: string, plan: string): Promise<void> {
  await db.query(`UPDATE vistta.users SET plan = $1, plan_since = $2 WHERE id = $3`, [
    plan,
    Date.now(),
    userId,
  ]);
}

describe("borrar un perfil", () => {
  it("libera la plaza del plan: se puede volver a crear", async () => {
    await crearCuenta("marina", "Marina");
    await ponerPlan("marina", "pro"); // 3 perfiles
    const sesion = await panelSession("marina");

    const segundo = await crearPerfil(sesion, "Segundo");
    await crearPerfil(sesion, "Tercero");

    // En el tope: el cuarto no entra.
    const cuarto = await callAs("198.51.100.12", "/api/profiles", {
      method: "POST",
      headers: { ...auth(sesion), "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Cuarto" }),
    });
    expect(cuarto.status).toBe(409);

    expect((await borrar(sesion, segundo, "Segundo")).status).toBe(200);

    // Y ahora sí. Sin esto, un perfil creado por error costaba una plaza para
    // siempre; con el plan Prueba, que da uno, encerraba la cuenta entera.
    const otro = await callAs("198.51.100.13", "/api/profiles", {
      method: "POST",
      headers: { ...auth(sesion), "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Otro" }),
    });
    expect(otro.status).toBe(201);
  });

  it("hay que teclear el nombre del perfil", async () => {
    await crearCuenta("marina", "Marina");
    await ponerPlan("marina", "pro");
    const sesion = await panelSession("marina");
    const id = await crearPerfil(sesion, "Litoral");

    expect((await borrar(sesion, id, "litoral")).status).toBe(400); // ni las mayúsculas
    expect((await borrar(sesion, id, "")).status).toBe(400);
    // Y sigue ahí: ninguno de los dos intentos ha tocado nada.
    expect((await borrar(sesion, id, "Litoral")).status).toBe(200);
  });

  it("se lleva los bytes del almacenamiento, no solo las filas", async () => {
    await crearCuenta("marina", "Marina");
    await ponerPlan("marina", "pro");
    const sesion = await panelSession("marina");
    const id = await crearPerfil(sesion, "Con fotos");

    const { mediaId } = await subirMedio(sesion, id);
    await callAs("198.51.100.14", `/api/profiles/${id}`, {
      method: "PUT",
      headers: { ...auth(sesion), "content-type": "application/json" },
      body: JSON.stringify({ data: galeriaCon(mediaId) }),
    });

    const fila = await db.one<{ storage_key: string }>(
      `SELECT storage_key FROM vistta.media WHERE id = $1`,
      [mediaId]
    );
    expect(await storage.get(fila!.storage_key)).not.toBeNull();

    expect((await borrar(sesion, id, "Con fotos")).status).toBe(200);

    // El CASCADE se lleva la fila; si los bytes no se borran ANTES, quedan en el
    // bucket sin nada que los recuerde y ya no hay quien los encuentre.
    expect(await storage.get(fila!.storage_key)).toBeNull();
    expect(await db.one(`SELECT id FROM vistta.media WHERE id = $1`, [mediaId])).toBeNull();
  });

  it("el perfil de otro no se puede borrar, y el error no lo delata", async () => {
    await crearCuenta("marina", "Marina");
    await crearCuenta("otro", "Otro");
    const deMarina = await panelSession("marina");
    const deOtro = await panelSession("otro", "198.51.100.20");

    const ajeno = await db.one<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM vistta.profiles WHERE owner_id = 'otro'`
    );

    // Con el nombre correcto y todo: sigue siendo 404, el mismo que si no
    // existiera. Un 403 confirmaría que ese identificador es de alguien.
    const res = await borrar(deMarina, ajeno!.id, ajeno!.display_name);
    expect(res.status).toBe(404);

    // Y ahí sigue.
    expect(
      await db.one(`SELECT id FROM vistta.profiles WHERE id = $1`, [ajeno!.id])
    ).not.toBeNull();
    expect((await borrar(deOtro, ajeno!.id, ajeno!.display_name, "198.51.100.21")).status).toBe(
      200
    );
  });

  it("sin sesión no se borra nada", async () => {
    await crearCuenta("marina", "Marina");
    const perfil = await db.one<{ id: string }>(
      `SELECT id FROM vistta.profiles WHERE owner_id = 'marina'`
    );
    const res = await callAs("198.51.100.22", `/api/profiles/${perfil!.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmacion: "Estudio Demo" }),
    });
    expect(res.status).toBe(401);
    expect(
      await db.one(`SELECT id FROM vistta.profiles WHERE id = $1`, [perfil!.id])
    ).not.toBeNull();
  });

  it("cierra los pases vivos de ese perfil: el enlace deja de abrirse", async () => {
    await crearCuenta("marina", "Marina");
    await ponerPlan("marina", "pro");
    const sesion = await panelSession("marina");
    const id = await crearPerfil(sesion, "Efímero");

    const pase = await callAs("198.51.100.23", "/api/passes", {
      method: "POST",
      headers: { ...auth(sesion), "content-type": "application/json" },
      body: JSON.stringify({ profileId: id }),
    });
    const { url } = (await pase.json()) as { url: string };
    const token = url.split("/v/")[1];

    expect((await borrar(sesion, id, "Efímero")).status).toBe(200);

    // Es la consecuencia que la pantalla tiene que avisar antes de borrar: un
    // enlace que ya se envió deja de funcionar.
    const abrir = await callAs("198.51.100.24", `/api/open/${token}`);
    expect(abrir.status).toBe(410);
  });

  it("el mismo CLAVE de siempre sigue valiendo para entrar", async () => {
    // Guarda contra un borrado que se lleve por delante la cuenta entera.
    await crearCuenta("marina", "Marina");
    await ponerPlan("marina", "pro");
    const sesion = await panelSession("marina");
    const id = await crearPerfil(sesion, "Sobrante");
    await borrar(sesion, id, "Sobrante");

    const entra = await callAs("198.51.100.25", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "marina", password: CLAVE }),
    });
    expect(entra.status).toBe(201);
  });
});
