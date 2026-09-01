import { describe, it, expect, beforeEach } from "vitest";
import { createPass } from "../src/lib/pass";
import { purgar } from "../src/lib/purga";
import { GRACIA_CONGELADO_MS, PLANES } from "../src/lib/planes";
import {
  call,
  callAs,
  crearAdmin,
  crearCuenta,
  CLAVE,
  db,
  galeriaCon,
  panelSession,
  resetDb,
  seedProfile,
  storage,
  subirMedio,
} from "./helpers";

beforeEach(resetDb);

async function sesionAdmin(ip = "198.51.100.200"): Promise<string> {
  await crearAdmin();
  return panelSession("soporte", ip);
}

function auth(sesion: string) {
  return { authorization: `Bearer ${sesion}`, "content-type": "application/json" };
}

const RUTAS = [
  ["GET", "/api/admin/cuentas"],
  ["POST", "/api/admin/cuentas"],
  ["PATCH", "/api/admin/cuentas/marina"],
  ["PUT", "/api/admin/cuentas/marina/plan"],
  ["POST", "/api/admin/cuentas/marina/password"],
  ["POST", "/api/admin/cuentas/marina/suspender"],
  ["POST", "/api/admin/cuentas/marina/reactivar"],
  ["DELETE", "/api/admin/cuentas/marina"],
  ["GET", "/api/admin/auditoria"],
] as const;

describe("quién llega a /api/admin", () => {
  it("sin sesión, ninguna ruta de admin existe", async () => {
    for (const [method, ruta] of RUTAS) {
      const res = await call(ruta, { method, body: method === "GET" ? undefined : "{}" });
      // 404 y no 401: un 401 ya confirma que el panel de administración existe.
      expect(res.status, `${method} ${ruta}`).toBe(404);
    }
  });

  it("con sesión de cliente normal, tampoco", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina", "198.51.100.201");
    for (const [method, ruta] of RUTAS) {
      const res = await callAs("198.51.100.202", ruta, {
        method,
        headers: auth(sesion),
        body: method === "GET" ? undefined : "{}",
      });
      expect(res.status, `${method} ${ruta}`).toBe(404);
    }
  });

  it("un cliente no puede ascenderse a sí mismo por ninguna ruta", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina", "198.51.100.203");

    // No hay endpoint que conceda el rol: se prueban los que podrían tocarlo.
    const intentos = [
      callAs("198.51.100.204", "/api/profiles/p_marina", {
        method: "PUT",
        headers: auth(sesion),
        body: JSON.stringify({ data: { sections: [] }, role: "admin" }),
      }),
      callAs("198.51.100.205", "/api/admin/cuentas/marina", {
        method: "PATCH",
        headers: auth(sesion),
        body: JSON.stringify({ displayName: "x", role: "admin" }),
      }),
    ];
    await Promise.all(intentos);

    const fila = await db.one<{ role: string }>(
      `SELECT role FROM vistta.users WHERE id = 'marina'`
    );
    expect(fila?.role).toBe("cliente");
  });
});

describe("gestión de cuentas", () => {
  it("lista las cuentas con su plan y su consumo, sin contenido", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    const s2 = await panelSession("marina", "198.51.100.210");
    await subirMedio(s2, "p_marina", { ip: "198.51.100.211" });
    await createPass(db, { profileId: "p_marina" });

    const res = await callAs("198.51.100.212", "/api/admin/cuentas", { headers: auth(sesion) });
    const { cuentas } = (await res.json()) as {
      cuentas: {
        id: string;
        plan: string;
        perfilesActivos: number;
        pasesAbiertos: number;
        bytesUsados: number;
      }[];
    };

    const marina = cuentas.find((c) => c.id === "marina")!;
    expect(marina.plan).toBe("prueba");
    expect(marina.perfilesActivos).toBe(1);
    expect(marina.pasesAbiertos).toBe(1);
    expect(marina.bytesUsados).toBeGreaterThan(0);

    // Ni una clave de almacenamiento, ni un id de medio, ni un token de pase.
    const json = JSON.stringify(cuentas);
    expect(json).not.toContain("storage_key");
    expect(json).not.toContain("u/p_marina");
    expect(json).not.toContain("password");
  });

  it("los contadores no se inflan con varias tablas de por medio", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    const s2 = await panelSession("marina", "198.51.100.213");
    // Tres medios y dos pases: con un GROUP BY sobre JOINs, los contadores se
    // multiplicarían entre sí y saldría 6 donde hay 2.
    for (let i = 0; i < 3; i++) await subirMedio(s2, "p_marina", { ip: "198.51.100.214" });
    await createPass(db, { profileId: "p_marina" });
    await createPass(db, { profileId: "p_marina" });

    const res = await callAs("198.51.100.215", "/api/admin/cuentas", { headers: auth(sesion) });
    const { cuentas } = (await res.json()) as { cuentas: { id: string; pasesAbiertos: number }[] };
    expect(cuentas.find((c) => c.id === "marina")!.pasesAbiertos).toBe(2);
  });

  it("crea una cuenta y devuelve su contraseña una sola vez", async () => {
    const sesion = await sesionAdmin();
    const res = await callAs("198.51.100.216", "/api/admin/cuentas", {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ id: "nueva", displayName: "Cuenta Nueva", plan: "pro" }),
    });
    expect(res.status).toBe(201);
    const { password } = (await res.json()) as { password: string };
    // Alfabeto sin caracteres que se confundan al dictarla, en grupos de cuatro.
    expect(password).toMatch(/^[a-hj-km-np-z2-9]{4}(-[a-hj-km-np-z2-9]{4}){3}$/);

    // Y sirve de verdad para entrar.
    const login = await callAs("198.51.100.217", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "nueva", password }),
    });
    expect(login.status).toBe(201);

    const fila = await db.one<{ plan: string }>(`SELECT plan FROM vistta.users WHERE id = 'nueva'`);
    expect(fila?.plan).toBe("pro");
  });

  it("no deja repetir un identificador", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    const res = await callAs("198.51.100.218", "/api/admin/cuentas", {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ id: "marina", displayName: "Otra" }),
    });
    expect(res.status).toBe(409);
  });

  it("cambiar el plan aplica el congelado del bloque E", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    // Con Bóveda caben más perfiles; se le añaden dos.
    await callAs("198.51.100.219", "/api/admin/cuentas/marina/plan", {
      method: "PUT",
      headers: auth(sesion),
      body: JSON.stringify({ plan: "boveda" }),
    });
    await seedProfile("p_marina_2", { sections: [] }, "marina");
    await seedProfile("p_marina_3", { sections: [] }, "marina");

    // Al bajar a prueba (1 perfil), dos quedan congelados y ninguno se borra.
    const res = await callAs("198.51.100.220", "/api/admin/cuentas/marina/plan", {
      method: "PUT",
      headers: auth(sesion),
      body: JSON.stringify({ plan: "prueba" }),
    });
    expect(res.status).toBe(200);

    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM vistta.profiles WHERE owner_id = 'marina'`
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === "congelado")).toHaveLength(3 - PLANES.prueba.perfiles);
  });

  it("reiniciar la contraseña cierra las sesiones abiertas", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    const suya = await panelSession("marina", "198.51.100.221");
    // Antes funcionaba.
    expect(
      (
        await callAs("198.51.100.222", "/api/profiles", {
          headers: { authorization: `Bearer ${suya}` },
        })
      ).status
    ).toBe(200);

    const res = await callAs("198.51.100.223", "/api/admin/cuentas/marina/password", {
      method: "POST",
      headers: auth(sesion),
    });
    const { password } = (await res.json()) as { password: string };
    expect(password).not.toBe(CLAVE);

    // Si se reinicia porque la cuenta está comprometida, dejar viva la sesión
    // del que entró no arregla nada.
    expect(
      (
        await callAs("198.51.100.224", "/api/profiles", {
          headers: { authorization: `Bearer ${suya}` },
        })
      ).status
    ).toBe(401);
  });
});

describe("suspensión de cuentas", () => {
  async function suspendida(sesion: string) {
    await crearCuenta("marina", "Marina");
    const suya = await panelSession("marina", "198.51.100.230");
    const { token } = await createPass(db, { profileId: "p_marina" });
    await callAs("198.51.100.231", "/api/admin/cuentas/marina/suspender", {
      method: "POST",
      headers: auth(sesion),
    });
    return { suya, token };
  }

  it("bloquea el login, tira las sesiones y cierra los pases vivos", async () => {
    const sesion = await sesionAdmin();
    const { suya, token } = await suspendida(sesion);

    // No entra, con el mismo mensaje que una contraseña mal puesta.
    const login = await callAs("198.51.100.232", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "marina", password: CLAVE }),
    });
    expect(login.status).toBe(401);

    // Su sesión abierta deja de valer al momento.
    expect(
      (
        await callAs("198.51.100.233", "/api/profiles", {
          headers: { authorization: `Bearer ${suya}` },
        })
      ).status
    ).toBe(401);

    // Y el enlace que ya había mandado deja de abrirse.
    expect((await callAs("198.51.100.234", "/api/open/" + token)).status).toBe(410);
  });

  it("reactivar la devuelve entera", async () => {
    const sesion = await sesionAdmin();
    await suspendida(sesion);
    await callAs("198.51.100.235", "/api/admin/cuentas/marina/reactivar", {
      method: "POST",
      headers: auth(sesion),
    });

    const login = await callAs("198.51.100.236", "/api/panel/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "marina", password: CLAVE }),
    });
    expect(login.status).toBe(201);
  });

  it("un administrador no puede suspenderse a sí mismo", async () => {
    const sesion = await sesionAdmin();
    const res = await callAs("198.51.100.237", "/api/admin/cuentas/soporte/suspender", {
      method: "POST",
      headers: auth(sesion),
    });
    // Dejaría el sistema sin quien lo administre y sin forma de arreglarlo.
    expect(res.status).toBe(409);
  });

  it("la cuenta suspendida se borra al agotar la gracia, y ni un minuto antes", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    const suya = await panelSession("marina", "198.51.100.238");
    const { mediaId } = await subirMedio(suya, "p_marina", { ip: "198.51.100.239" });
    await callAs("198.51.100.240", "/api/admin/cuentas/marina/suspender", {
      method: "POST",
      headers: auth(sesion),
    });

    const casi = Date.now() + GRACIA_CONGELADO_MS - 1000;
    expect((await purgar(db, storage, casi)).cuentasBorradas).toBe(0);

    const despues = Date.now() + GRACIA_CONGELADO_MS + 1000;
    expect((await purgar(db, storage, despues)).cuentasBorradas).toBe(1);
    expect(await db.one(`SELECT id FROM vistta.users WHERE id = 'marina'`)).toBeNull();
    expect(await storage.get(`u/p_marina/${mediaId}`)).toBeNull();
  });
});

describe("borrado inmediato (supresión del RGPD)", () => {
  it("exige teclear el identificador", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");

    for (const cuerpo of ["{}", JSON.stringify({ confirmacion: "otra-cosa" })]) {
      const res = await callAs("198.51.100.250", "/api/admin/cuentas/marina", {
        method: "DELETE",
        headers: auth(sesion),
        body: cuerpo,
      });
      expect(res.status).toBe(400);
    }
    expect(await db.one(`SELECT id FROM vistta.users WHERE id = 'marina'`)).not.toBeNull();
  });

  it("con la confirmación correcta se lleva la cuenta y sus bytes", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    const suya = await panelSession("marina", "198.51.100.251");
    const { mediaId } = await subirMedio(suya, "p_marina", { ip: "198.51.100.252" });

    const res = await callAs("198.51.100.253", "/api/admin/cuentas/marina", {
      method: "DELETE",
      headers: auth(sesion),
      body: JSON.stringify({ confirmacion: "marina" }),
    });
    expect(res.status).toBe(200);
    expect(await db.one(`SELECT id FROM vistta.users WHERE id = 'marina'`)).toBeNull();
    expect(await db.one(`SELECT id FROM vistta.profiles WHERE id = 'p_marina'`)).toBeNull();
    expect(await storage.get(`u/p_marina/${mediaId}`)).toBeNull();
  });

  it("un administrador no puede borrarse a sí mismo", async () => {
    const sesion = await sesionAdmin();
    const res = await callAs("198.51.100.254", "/api/admin/cuentas/soporte", {
      method: "DELETE",
      headers: auth(sesion),
      body: JSON.stringify({ confirmacion: "soporte" }),
    });
    expect(res.status).toBe(409);
  });
});

describe("auditoría", () => {
  it("cada acción deja rastro, y el borrado sobrevive a la cuenta borrada", async () => {
    const sesion = await sesionAdmin();
    await crearCuenta("marina", "Marina");
    const con = (ruta: string, method: string, body?: string) =>
      callAs("198.51.100.260", ruta, { method, headers: auth(sesion), body });

    await con("/api/admin/cuentas/marina/plan", "PUT", JSON.stringify({ plan: "pro" }));
    await con("/api/admin/cuentas/marina/password", "POST");
    await con("/api/admin/cuentas/marina/suspender", "POST");
    await con("/api/admin/cuentas/marina", "DELETE", JSON.stringify({ confirmacion: "marina" }));

    const res = await con("/api/admin/auditoria", "GET");
    const { registros } = (await res.json()) as {
      registros: { accion: string; objetivo: string; detalle: Record<string, unknown> }[];
    };
    const acciones = registros.map((r) => r.accion);
    expect(acciones).toContain("cambiar_plan");
    expect(acciones).toContain("reiniciar_password");
    expect(acciones).toContain("suspender");
    // El registro del borrado sigue ahí aunque la cuenta ya no exista: por eso
    // `objetivo` no es una clave ajena.
    expect(acciones).toContain("borrar_cuenta");

    const plan = registros.find((r) => r.accion === "cambiar_plan")!;
    expect(plan.detalle).toEqual({ de: "prueba", a: "pro" });

    // El registro dice QUE se reinició la contraseña, nunca cuál: su detalle
    // va vacío a propósito.
    expect(registros.find((r) => r.accion === "reiniciar_password")!.detalle).toEqual({});
  });

  it("el registro no lo ve un cliente", async () => {
    await crearCuenta("marina", "Marina");
    const sesion = await panelSession("marina", "198.51.100.261");
    const res = await callAs("198.51.100.262", "/api/admin/auditoria", {
      headers: auth(sesion),
    });
    expect(res.status).toBe(404);
  });
});

// El congelado de perfiles y la galería no intervienen aquí, pero el helper se
// importa para que un cambio en su firma rompa también estas pruebas.
void galeriaCon;
