import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import { z } from "zod";
import type { AppEnv, Deps } from "../deps";
import { bearer, usuarioDeLaSesion } from "../lib/auth";
import { cuentaDelUsuario } from "../lib/cuentas";
import { hitRateLimit } from "../lib/ratelimit";
import {
  CuentaNoEncontradaError,
  PlanNoVendibleError,
  pagoPendiente,
  solicitarPago,
} from "../lib/facturacion";
import {
  AVISO_LIMPIEZA_MS,
  AVISO_VENCIMIENTO_MS,
  PLANES_DE_PAGO,
  PRECIOS,
  PERIODOS,
} from "../lib/planes";
import { proximaLimpieza } from "../lib/purga";

/**
 * Facturación vista por el cliente.
 *
 * Lo único que puede hacer aquí es PEDIR: generar un código y ver en qué estado
 * está. Confirmar un pago no es suyo —es del administrador, cotejando el
 * extracto—, y por eso no hay ninguna ruta en este archivo que active un plan.
 */

/** Pedir código es barato pero no gratis: anula el anterior y escribe en la base. */
const SOLICITUD_RULE = {
  scope: "billing-solicitud",
  max: 10,
  windowMs: 60 * 60 * 1000,
  blockMs: 60 * 60 * 1000,
} as const;

const SolicitudSchema = z.object({
  plan: z.enum(["pro", "boveda"]),
  periodo: z.enum(["mensual", "anual"]),
});

export function billingRoutes({ config, db }: Deps) {
  const billing = new Hono<AppEnv>();

  billing.use("/api/billing", exigirSesion(db));
  billing.use("/api/billing/*", exigirSesion(db));

  /** Estado de la suscripción y catálogo, para que el panel no cablee precios. */
  billing.get("/api/billing", async (c) => {
    const usuario = c.get("usuario");
    const cuenta = await cuentaDelUsuario(db, usuario.id);
    const fila = await db.one<{ plan_until: number | null }>(
      `SELECT plan_until FROM vistta.users WHERE id = $1`,
      [usuario.id]
    );
    const pendiente = await pagoPendiente(db, usuario.id);
    const hasta = fila?.plan_until ?? null;

    return c.json({
      plan: cuenta?.plan ?? null,
      planHasta: hasta,
      // Se avisa con antelación, y el cálculo lo hace el servidor: si lo hiciera
      // el navegador, un reloj mal puesto decidiría cuándo se avisa.
      porVencer: hasta !== null && hasta - Date.now() <= AVISO_VENCIMIENTO_MS,
      pendiente,
      catalogo: {
        planes: PLANES_DE_PAGO,
        periodos: PERIODOS,
        precios: PRECIOS,
        moneda: "EUR",
      },
      // De dónde salen: de la configuración del despliegue, no del código.
      pago: { bizum: config.BIZUM_TELEFONO ?? null, paypal: config.PAYPAL_DESTINO ?? null },
      /*
       * Cuándo se lleva la purga el contenido más antiguo, y cuánto está a
       * punto de irse. Lo calcula `proximaLimpieza`, que vive pegada al SELECT
       * que borra: si el aviso se calculara aquí por su cuenta, acabaría
       * diciendo un día y el borrado ocurriendo otro, y el cliente perdería su
       * trabajo el día en que el panel le decía que estaba a salvo.
       */
      limpieza: await proximaLimpieza(db, usuario.id, AVISO_LIMPIEZA_MS),
    });
  });

  billing.post("/api/billing/solicitar", async (c) => {
    const usuario = c.get("usuario");
    const limite = await hitRateLimit(db, SOLICITUD_RULE, usuario.id);
    if (!limite.allowed) {
      c.header("Retry-After", String(limite.retryAfterSeconds));
      return c.json({ error: "demasiadas solicitudes" }, 429);
    }

    const parsed = SolicitudSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "plan o periodo no válidos" }, 400);

    if (!config.BIZUM_TELEFONO && !config.PAYPAL_DESTINO) {
      // Dar un código sin decir a dónde pagar es mandar al cliente a un callejón.
      return c.json({ error: "el cobro no está configurado todavía" }, 503);
    }

    try {
      const pago = await solicitarPago(db, usuario.id, parsed.data.plan, parsed.data.periodo);
      return c.json(
        {
          pago,
          pago_a: { bizum: config.BIZUM_TELEFONO ?? null, paypal: config.PAYPAL_DESTINO ?? null },
        },
        201
      );
    } catch (err) {
      if (err instanceof PlanNoVendibleError) return c.json({ error: "ese plan no se vende" }, 400);
      if (err instanceof CuentaNoEncontradaError) return c.json({ error: "no autorizado" }, 401);
      throw err;
    }
  });

  return billing;
}

function exigirSesion(db: Deps["db"]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
    if (!usuario) return c.json({ error: "no autorizado" }, 401);
    c.set("usuario", usuario);
    await next();
  };
}
