import { describe, it, expect, beforeEach } from "vitest";
import {
  anularPago,
  aplicarVencimientos,
  caducarCodigos,
  confirmarPago,
  pagoPendiente,
  solicitarPago,
  PlanNoVendibleError,
} from "../src/lib/facturacion";
import {
  CADUCIDAD_CODIGO_MS,
  DURACION_PERIODO_MS,
  PLANES,
  PRECIOS,
  precioDe,
} from "../src/lib/planes";
import { cambiarPlan } from "../src/lib/congelado";
import {
  calentarPool,
  callAs,
  crearAdmin,
  crearCuenta,
  db,
  panelSession,
  resetDb,
  seedProfile,
} from "./helpers";

beforeEach(resetDb);

const DIA = 24 * 60 * 60 * 1000;

async function cliente(id = "marina", ip = "203.0.113.10") {
  await crearCuenta(id, "Marina");
  return { id, sesion: await panelSession(id, ip) };
}

async function admin(ip = "203.0.113.11") {
  await crearAdmin();
  return panelSession("soporte", ip);
}

function auth(sesion: string) {
  return { authorization: `Bearer ${sesion}`, "content-type": "application/json" };
}

async function planDe(userId: string) {
  return db.one<{ plan: string; plan_until: number | null }>(
    `SELECT plan, plan_until FROM vistta.users WHERE id = $1`,
    [userId]
  );
}

describe("el cliente pide su plan", () => {
  it("genera un código con el precio del catálogo y las instrucciones de pago", async () => {
    const { sesion } = await cliente();
    const res = await callAs("203.0.113.12", "/api/billing/solicitar", {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ plan: "pro", periodo: "anual" }),
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      pago: { code: string; importe: number; plan: string; status: string };
      pago_a: { bizum: string | null; paypal: string | null };
    };
    expect(body.pago.code).toMatch(/^VISTTA-[A-HJ-KM-NP-Z2-9]{6}$/);
    expect(body.pago.importe).toBe(precioDe("pro", "anual"));
    expect(body.pago.status).toBe("pendiente");
    // A dónde pagar sale de la configuración del despliegue, no del código.
    expect(body.pago_a.bizum).toBe("600000000");
  });

  it("pedir otra vez sustituye la solicitud anterior en vez de acumularla", async () => {
    const { id, sesion } = await cliente();
    const pedir = (periodo: string) =>
      callAs("203.0.113.13", "/api/billing/solicitar", {
        method: "POST",
        headers: auth(sesion),
        body: JSON.stringify({ plan: "pro", periodo }),
      });

    const primera = (await (await pedir("mensual")).json()) as { pago: { code: string } };
    const segunda = (await (await pedir("anual")).json()) as { pago: { code: string } };
    expect(segunda.pago.code).not.toBe(primera.pago.code);

    // Solo una viva: si no, el cliente podría pagar el código de hace tres
    // semanas mientras hay otro en pie.
    const viva = await pagoPendiente(db, id);
    expect(viva?.code).toBe(segunda.pago.code);
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM vistta.payments ORDER BY created_at`
    );
    expect(rows.map((r) => r.status)).toEqual(["anulado", "pendiente"]);
  });

  it("el plan de prueba no se vende", async () => {
    const { id } = await cliente();
    await expect(solicitarPago(db, id, "prueba", "mensual")).rejects.toThrow(PlanNoVendibleError);
  });

  it("el estado de la suscripción avisa cuando queda poco", async () => {
    const { id, sesion } = await cliente();
    await cambiarPlan(db, id, "pro");
    await db.query(`UPDATE vistta.users SET plan_until = $1 WHERE id = $2`, [
      Date.now() + 3 * DIA,
      id,
    ]);

    const res = await callAs("203.0.113.14", "/api/billing", { headers: auth(sesion) });
    const body = (await res.json()) as { plan: string; porVencer: boolean; catalogo: unknown };
    expect(body.plan).toBe("pro");
    expect(body.porVencer).toBe(true);
    // El catálogo viaja al panel: los precios no se cablean en el frontend.
    expect(body.catalogo).toMatchObject({ precios: PRECIOS });
  });

  it("pedir un plan exige sesión", async () => {
    const res = await callAs("203.0.113.15", "/api/billing/solicitar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan: "pro", periodo: "mensual" }),
    });
    expect(res.status).toBe(401);
  });

  it("un cliente no puede dar por cobrado su propio pago", async () => {
    const { id, sesion } = await cliente();
    const pago = await solicitarPago(db, id, "pro", "mensual");

    // El código no es un secreto —va en el concepto de un Bizum— así que
    // conocerlo no puede autorizar nada.
    const res = await callAs("203.0.113.16", `/api/admin/pagos/${pago.code}/confirmar`, {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ metodo: "bizum" }),
    });
    expect(res.status).toBe(404);
    expect((await planDe(id))?.plan).toBe("prueba");
  });
});

describe("el administrador concilia", () => {
  it("confirmar activa el plan y pone la fecha de vencimiento", async () => {
    const sesion = await admin();
    const { id } = await cliente();
    const pago = await solicitarPago(db, id, "pro", "mensual");

    const res = await callAs("203.0.113.20", `/api/admin/pagos/${pago.code}/confirmar`, {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ metodo: "bizum", nota: "op. 4471" }),
    });
    expect(res.status).toBe(200);

    const cuenta = await planDe(id);
    expect(cuenta?.plan).toBe("pro");
    expect(cuenta?.plan_until).toBeGreaterThan(Date.now() + DURACION_PERIODO_MS.mensual - 5000);

    const fila = await db.one<{ status: string; confirmed_by: string; metodo: string }>(
      `SELECT status, confirmed_by, metodo FROM vistta.payments WHERE code = $1`,
      [pago.code]
    );
    // Queda quién lo dio por cobrado y por qué vía: eso es la conciliación.
    expect(fila?.status).toBe("cobrado");
    expect(fila?.confirmed_by).toBe("soporte");
    expect(fila?.metodo).toBe("bizum");
  });

  it("pagar antes de tiempo encadena el periodo, no lo reinicia", async () => {
    const sesion = await admin();
    const { id } = await cliente();
    await callAs(
      "203.0.113.21",
      `/api/admin/pagos/${(await solicitarPago(db, id, "pro", "mensual")).code}/confirmar`,
      {
        method: "POST",
        headers: auth(sesion),
        body: JSON.stringify({ metodo: "bizum" }),
      }
    );
    const primera = (await planDe(id))!.plan_until!;

    // Renueva sin esperar a que se le acabe.
    const segundo = await solicitarPago(db, id, "pro", "mensual");
    await callAs("203.0.113.22", `/api/admin/pagos/${segundo.code}/confirmar`, {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ metodo: "bizum" }),
    });

    // Los dos meses se suman: adelantarse no puede costarle días al que paga.
    const segunda = (await planDe(id))!.plan_until!;
    expect(segunda - primera).toBeGreaterThan(DURACION_PERIODO_MS.mensual - 5000);
  });

  it("cambiar de plan no arrastra los días del anterior", async () => {
    const sesion = await admin();
    const { id } = await cliente();
    await confirmarPago(db, (await solicitarPago(db, id, "pro", "anual")).code, "soporte");
    const conPro = (await planDe(id))!.plan_until!;

    // Bóveda es otro producto: el periodo empieza de cero.
    await confirmarPago(db, (await solicitarPago(db, id, "boveda", "mensual")).code, "soporte");
    const conBoveda = (await planDe(id))!;
    expect(conBoveda.plan).toBe("boveda");
    expect(conBoveda.plan_until).toBeLessThan(conPro);
    void sesion;
  });

  it("el mismo código no se cobra dos veces, ni en una ráfaga", async () => {
    const { id } = await cliente();
    const pago = await solicitarPago(db, id, "pro", "anual");

    /*
     * Otro invariante de concurrencia, y este es dinero: dos confirmaciones
     * simultáneas del mismo código sumarían el periodo dos veces.
     *
     * `calentarPool` no es adorno. Sin él este test pasaba incluso quitándole
     * las DOS protecciones que lo impiden, porque las dieciséis llamadas no
     * llegaban a solaparse: la primera corría con la conexión ya abierta y
     * terminaba mientras las demás se conectaban. Con el pool caliente, sin
     * protecciones cobran diez de dieciséis.
     */
    await calentarPool();
    const intentos = await Promise.all(
      Array.from({ length: 16 }, () => confirmarPago(db, pago.code, "soporte"))
    );
    expect(intentos.filter((r) => r !== null)).toHaveLength(1);

    const cuenta = await planDe(id);
    // Un año, no dieciséis.
    expect(cuenta!.plan_until!).toBeLessThan(Date.now() + DURACION_PERIODO_MS.anual + 60_000);
  });

  it("anular deja el código inservible", async () => {
    const sesion = await admin();
    const { id } = await cliente();
    const pago = await solicitarPago(db, id, "pro", "mensual");

    expect(await anularPago(db, pago.code)).toBe(true);
    const res = await callAs("203.0.113.23", `/api/admin/pagos/${pago.code}/confirmar`, {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ metodo: "bizum" }),
    });
    expect(res.status).toBe(404);
    expect((await planDe(id))?.plan).toBe("prueba");
  });

  it("el cobro queda en la auditoría con su código e importe", async () => {
    const sesion = await admin();
    const { id } = await cliente();
    const pago = await solicitarPago(db, id, "boveda", "anual");
    await callAs("203.0.113.24", `/api/admin/pagos/${pago.code}/confirmar`, {
      method: "POST",
      headers: auth(sesion),
      body: JSON.stringify({ metodo: "paypal" }),
    });

    const res = await callAs("203.0.113.25", "/api/admin/auditoria", { headers: auth(sesion) });
    const { registros } = (await res.json()) as {
      registros: { accion: string; detalle: Record<string, unknown> }[];
    };
    const cobro = registros.find((r) => r.accion === "cobrar_pago")!;
    expect(cobro.detalle).toMatchObject({
      code: pago.code,
      plan: "boveda",
      importe: precioDe("boveda", "anual"),
      metodo: "paypal",
    });
  });

  it("los pagos no los ve un cliente", async () => {
    const { sesion } = await cliente();
    const res = await callAs("203.0.113.26", "/api/admin/pagos", { headers: auth(sesion) });
    expect(res.status).toBe(404);
  });
});

describe("vencimientos", () => {
  it("al vencer baja a prueba y congela lo que sobra, sin borrar nada", async () => {
    const { id } = await cliente();
    await confirmarPago(db, (await solicitarPago(db, id, "boveda", "mensual")).code, "soporte");
    // Con Bóveda caben más perfiles: se le añaden dos.
    await seedProfile("p_marina_2", { sections: [] }, id);
    await seedProfile("p_marina_3", { sections: [] }, id);

    // Todavía no vence.
    expect(await aplicarVencimientos(db)).toEqual([]);

    const despues = Date.now() + DURACION_PERIODO_MS.mensual + 1000;
    expect(await aplicarVencimientos(db, despues)).toEqual([id]);

    const cuenta = await planDe(id);
    expect(cuenta?.plan).toBe("prueba");
    // La fecha se limpia: si no, volvería a vencer en cada pasada.
    expect(cuenta?.plan_until).toBeNull();

    // Los perfiles siguen ahí, congelados. Vencer no destruye trabajo.
    const { rows } = await db.query<{ status: string }>(
      `SELECT status FROM vistta.profiles WHERE owner_id = $1`,
      [id]
    );
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.status === "congelado")).toHaveLength(3 - PLANES.prueba.perfiles);
  });

  it("una cuenta sin fecha de vencimiento no vence nunca", async () => {
    const { id } = await cliente();
    // Plan asignado a mano por un administrador, sin periodo: una cortesía.
    await cambiarPlan(db, id, "boveda");
    expect(await aplicarVencimientos(db, Date.now() + 3650 * DIA)).toEqual([]);
    expect((await planDe(id))?.plan).toBe("boveda");
  });

  it("un código sin pagar caduca solo", async () => {
    const { id } = await cliente();
    const pago = await solicitarPago(db, id, "pro", "mensual");

    expect(await caducarCodigos(db)).toBe(0);
    expect(await caducarCodigos(db, Date.now() + CADUCIDAD_CODIGO_MS + 1000)).toBe(1);

    const fila = await db.one<{ status: string }>(
      `SELECT status FROM vistta.payments WHERE code = $1`,
      [pago.code]
    );
    // Si no caducara, alguien podría pagar dentro de un año a precio de hoy.
    expect(fila?.status).toBe("anulado");
  });

  it("un código caducado ya no aparece como pendiente para el cliente", async () => {
    const { id } = await cliente();
    await solicitarPago(db, id, "pro", "mensual");
    expect(await pagoPendiente(db, id, Date.now() + CADUCIDAD_CODIGO_MS + 1000)).toBeNull();
  });
});
