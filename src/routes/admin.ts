import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../deps";
import { bearer, crearUsuario, usuarioDeLaSesion } from "../lib/auth";
import { hitRateLimit } from "../lib/ratelimit";
import { PLANES_VALIDOS } from "../lib/planes";
import { anularPago, confirmarPago, listarPagos } from "../lib/facturacion";
import {
  ACCIONES_ADMIN,
  asignarPlan,
  borrarCuenta,
  diasConAuditoria,
  listarAuditoria,
  listarCuentas,
  reactivar,
  registrar,
  reiniciarPassword,
  suspender,
} from "../lib/admin";
import { cerrarSolicitud } from "../lib/solicitudes";

/**
 * Rutas de administración.
 *
 * Todo lo que hay aquí se salta el aislamiento entre inquilinos, que es la
 * defensa principal del producto. Dos decisiones sostienen que eso sea
 * aceptable:
 *
 *   1. **A quien no es administrador se le responde 404, no 403.** Un 403 dice
 *      «esto existe y no es para ti», y con eso ya se sabe que hay un panel de
 *      administración y dónde. El 404 no dice nada.
 *   2. **No hay ninguna ruta que conceda el rol.** Ni siquiera para un
 *      administrador. Se da con `pnpm admin:create`, desde la máquina que tiene
 *      la base. Cualquier endpoint que otorgue admin es una escalada de
 *      privilegios a una llamada de distancia el día que se cuele un fallo de
 *      autorización en cualquier otro sitio.
 */

/** Límite propio: más estrecho que el del panel, y por cuenta de administrador. */
const ADMIN_RULE = {
  scope: "admin",
  max: 120,
  windowMs: 60_000,
  blockMs: 60_000,
} as const;

const CrearCuentaSchema = z.object({
  id: z
    .string()
    .min(3)
    .max(64)
    // Mismo alfabeto que las claves de medios: el id de la cuenta acaba dentro
    // de rutas de almacenamiento (`u/p_<id>/...`).
    .regex(/^[a-z0-9_-]+$/, "solo minúsculas, dígitos, guion y guion bajo"),
  displayName: z.string().min(1).max(120),
  plan: z.enum(["prueba", "pro", "boveda"]).optional(),
});

const EditarCuentaSchema = z.object({ displayName: z.string().min(1).max(120) });
const PlanSchema = z.object({ plan: z.enum(["prueba", "pro", "boveda"]) });

/** Borrar exige teclear el id de la cuenta: un clic de más no basta. */
const BorrarSchema = z.object({ confirmacion: z.string() });

/*
 * Filtro del registro.
 *
 * Todo es opcional y todo se valida, incluida la zona horaria: es texto que
 * llega del navegador y acaba dentro de una consulta. Va como parámetro, no
 * concatenada, y además `diasConAuditoria` la contrasta con el catálogo de
 * PostgreSQL antes de usarla.
 *
 * `coerce` porque una query string son cadenas: sin él, `desde=1757` sería el
 * texto "1757" y la comparación con un BIGINT fallaría en la base en vez de
 * aquí.
 */
const AuditoriaSchema = z.object({
  desde: z.coerce.number().int().nonnegative().optional(),
  hasta: z.coerce.number().int().nonnegative().optional(),
  antes: z.coerce.number().int().nonnegative().optional(),
  accion: z.enum(ACCIONES_ADMIN).optional(),
  objetivo: z.string().min(1).max(64).optional(),
  // Nombre IANA: `Europe/Madrid`, `UTC`. Lo da el propio navegador.
  zona: z
    .string()
    .max(64)
    .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/)
    .optional(),
  limite: z.coerce.number().int().min(1).max(200).optional(),
});

const ConfirmarPagoSchema = z.object({
  metodo: z.enum(["bizum", "paypal", "transferencia", "otro"]),
  /** Para anotar el número de operación del extracto. No es obligatorio. */
  nota: z.string().max(280).optional(),
});

export function adminRoutes({ db, storage }: Deps) {
  const admin = new Hono<AppEnv>();

  admin.use("/api/admin/*", async (c, next) => {
    const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
    // El mismo 404 para «no hay sesión» y para «no eres administrador»: desde
    // fuera, estas rutas no existen.
    if (!usuario || usuario.role !== "admin") return c.json({ error: "no encontrado" }, 404);

    const limite = await hitRateLimit(db, ADMIN_RULE, usuario.id);
    if (!limite.allowed) {
      c.header("Retry-After", String(limite.retryAfterSeconds));
      return c.json({ error: "demasiadas peticiones" }, 429);
    }

    c.set("usuario", usuario);
    await next();
  });

  admin.get("/api/admin/cuentas", async (c) => {
    return c.json({ cuentas: await listarCuentas(db), planes: PLANES_VALIDOS });
  });

  admin.post("/api/admin/cuentas", async (c) => {
    const parsed = CrearCuentaSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
    }

    // La contraseña la pone el administrador tecleándola nunca: se genera y se
    // enseña una vez. Así no acaba siendo «vistta2026» en las veinte cuentas.
    const { passwordTemporal } = await import("../lib/admin");
    const temporal = passwordTemporal();
    const creado = await crearUsuario(db, {
      id: parsed.data.id,
      displayName: parsed.data.displayName,
      password: temporal,
    });
    if (!creado) return c.json({ error: "ese identificador ya está cogido" }, 409);

    if (parsed.data.plan) await asignarPlan(db, parsed.data.id, parsed.data.plan);
    await registrar(db, c.get("usuario").id, "crear_cuenta", parsed.data.id, {
      plan: parsed.data.plan ?? "prueba",
    });

    // La contraseña viaja UNA vez, en esta respuesta, y no se guarda en claro
    // en ningún sitio. Si se pierde, se genera otra.
    return c.json({ id: creado.id, displayName: creado.displayName, password: temporal }, 201);
  });

  admin.patch("/api/admin/cuentas/:id", async (c) => {
    const parsed = EditarCuentaSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "entrada no válida" }, 400);

    const res = await db.query(`UPDATE vistta.users SET display_name = $1 WHERE id = $2`, [
      parsed.data.displayName,
      c.req.param("id"),
    ]);
    if (res.rowCount !== 1) return c.json({ error: "cuenta no encontrada" }, 404);

    await registrar(db, c.get("usuario").id, "editar_cuenta", c.req.param("id"), {
      displayName: parsed.data.displayName,
    });
    return c.json({ ok: true });
  });

  admin.put("/api/admin/cuentas/:id/plan", async (c) => {
    const parsed = PlanSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "plan no válido" }, 400);

    const objetivo = c.req.param("id");
    const antes = await db.one<{ plan: string }>(`SELECT plan FROM vistta.users WHERE id = $1`, [
      objetivo,
    ]);
    if (!(await asignarPlan(db, objetivo, parsed.data.plan))) {
      return c.json({ error: "cuenta no encontrada" }, 404);
    }

    await registrar(db, c.get("usuario").id, "cambiar_plan", objetivo, {
      de: antes?.plan ?? null,
      a: parsed.data.plan,
    });
    return c.json({ ok: true });
  });

  admin.post("/api/admin/cuentas/:id/password", async (c) => {
    const temporal = await reiniciarPassword(db, c.req.param("id"));
    if (!temporal) return c.json({ error: "cuenta no encontrada" }, 404);

    // En el registro va que se reinició, nunca la contraseña.
    // Atender la petición ES cerrarla: un segundo clic que hay que recordar es
    // un clic que se olvida, y la marca se quedaría puesta para siempre.
    await cerrarSolicitud(db, c.req.param("id"), c.get("usuario").id, "resuelta");
    await registrar(db, c.get("usuario").id, "reiniciar_password", c.req.param("id"));
    return c.json({ password: temporal });
  });

  /**
   * Descartar una solicitud sin tocar la contraseña.
   *
   * Hace falta porque no toda petición se atiende: alguien puede pedirla por
   * error, o por la cuenta de otro. Sin esto, la única forma de quitar la marca
   * sería reiniciar una contraseña que nadie ha pedido de verdad.
   */
  admin.delete("/api/admin/cuentas/:id/solicitud", async (c) => {
    const objetivo = c.req.param("id");
    const cerrada = await cerrarSolicitud(db, objetivo, c.get("usuario").id, "descartada");
    if (!cerrada) return c.json({ error: "no encontrado" }, 404);
    await registrar(db, c.get("usuario").id, "descartar_solicitud", objetivo);
    return c.json({ ok: true });
  });

  admin.post("/api/admin/cuentas/:id/suspender", async (c) => {
    const objetivo = c.req.param("id");
    if (objetivo === c.get("usuario").id) {
      // Suspenderse a uno mismo deja el sistema sin quien lo administre y sin
      // forma de arreglarlo desde el panel.
      return c.json({ error: "no puedes suspender tu propia cuenta" }, 409);
    }
    if (!(await suspender(db, objetivo))) {
      return c.json({ error: "cuenta no encontrada o ya suspendida" }, 404);
    }
    await registrar(db, c.get("usuario").id, "suspender", objetivo);
    return c.json({ ok: true });
  });

  admin.post("/api/admin/cuentas/:id/reactivar", async (c) => {
    if (!(await reactivar(db, c.req.param("id")))) {
      return c.json({ error: "cuenta no encontrada o ya activa" }, 404);
    }
    await registrar(db, c.get("usuario").id, "reactivar", c.req.param("id"));
    return c.json({ ok: true });
  });

  /**
   * Borrado inmediato e irreversible. Es para la supresión del art. 17 del
   * RGPD; para un impago está `suspender`, que es reversible.
   */
  admin.delete("/api/admin/cuentas/:id", async (c) => {
    const objetivo = c.req.param("id");
    const parsed = BorrarSchema.safeParse(await c.req.json().catch(() => null));
    // Hay que teclear el id de la cuenta. No es burocracia: esto borra el
    // trabajo entero de un cliente y no hay deshacer.
    if (!parsed.success || parsed.data.confirmacion !== objetivo) {
      return c.json({ error: "confirmación incorrecta: escribe el identificador" }, 400);
    }
    if (objetivo === c.get("usuario").id) {
      return c.json({ error: "no puedes borrar tu propia cuenta" }, 409);
    }

    // El registro se escribe ANTES de borrar: si se escribiera después y algo
    // fallara entre medias, quedaría una cuenta borrada sin constancia de quién
    // la borró. Al revés, lo peor que queda es constancia de un intento.
    await registrar(db, c.get("usuario").id, "borrar_cuenta", objetivo);
    if (!(await borrarCuenta(db, storage, objetivo))) {
      return c.json({ error: "cuenta no encontrada" }, 404);
    }
    return c.json({ ok: true });
  });

  /*
   * Conciliación de pagos.
   *
   * Esto es lo que convierte "el plan cambió" en "el plan cambió porque entró
   * este dinero". Confirmar es una acción de administrador y NO de quien conoce
   * el código: el código viaja en el concepto de un Bizum y no es un secreto.
   */
  admin.get("/api/admin/pagos", async (c) => {
    return c.json({ pagos: await listarPagos(db) });
  });

  admin.post("/api/admin/pagos/:code/confirmar", async (c) => {
    const parsed = ConfirmarPagoSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "falta el método de pago" }, 400);

    const code = c.req.param("code");
    const resultado = await confirmarPago(db, code, c.get("usuario").id, {
      metodo: parsed.data.metodo,
      nota: parsed.data.nota,
    });
    if (!resultado) return c.json({ error: "código no encontrado o ya resuelto" }, 404);

    await registrar(db, c.get("usuario").id, "cobrar_pago", resultado.pago.userId, {
      code,
      plan: resultado.pago.plan,
      periodo: resultado.pago.periodo,
      importe: resultado.pago.importe,
      metodo: parsed.data.metodo,
    });
    return c.json({ pago: resultado.pago, planHasta: resultado.planHasta });
  });

  admin.post("/api/admin/pagos/:code/anular", async (c) => {
    const code = c.req.param("code");
    if (!(await anularPago(db, code))) {
      return c.json({ error: "código no encontrado o ya resuelto" }, 404);
    }
    await registrar(db, c.get("usuario").id, "anular_pago", null, { code });
    return c.json({ ok: true });
  });

  /*
   * El registro, filtrado y por páginas.
   *
   * La franja llega YA RESUELTA en milisegundos, calculada por el navegador a
   * partir del día que se ha elegido. Es a propósito: el día de quien mira
   * empieza y acaba en SU reloj, y el servidor no tiene por qué adivinar en qué
   * huso está. Lo único que se le manda es el nombre de la zona, y solo para
   * agrupar el índice de días.
   */
  admin.get("/api/admin/auditoria", async (c) => {
    const parsed = AuditoriaSchema.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "filtro no válido" }, 400);
    const f = parsed.data;

    const [pagina, dias] = await Promise.all([
      listarAuditoria(db, {
        desde: f.desde ?? null,
        hasta: f.hasta ?? null,
        accion: f.accion ?? null,
        objetivo: f.objetivo ?? null,
        antes: f.antes ?? null,
        limite: f.limite,
      }),
      // El índice de días NO se filtra por la franja elegida: es el mapa desde
      // el que se navega, y un mapa que solo enseña dónde ya estás no sirve.
      diasConAuditoria(db, f.zona ?? "UTC"),
    ]);

    return c.json({
      registros: pagina.registros,
      hayMas: pagina.hayMas,
      dias,
      acciones: ACCIONES_ADMIN,
    });
  });

  return admin;
}
