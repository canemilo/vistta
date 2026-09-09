import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, Deps } from "../deps";
import { ConexionDeEntradaSchema, DestinoDeSalidaSchema } from "../schemas";
import { bearer, usuarioDeLaSesion } from "../lib/auth";
import { hitRateLimit } from "../lib/ratelimit";
import {
  conexionesDeEntrada,
  crearConexionDeEntrada,
  revocarConexionDeEntrada,
} from "../lib/webhooks";
import {
  borrarDestino,
  destinosDe,
  enviarPrueba,
  guardarDestino,
  reactivarDestino,
} from "../lib/webhooks-salida";
import { UrlNoPermitidaError } from "../lib/url-segura";

/**
 * Las conexiones con el CRM del agente, desde su panel.
 *
 * Todo por sesión y todo filtrado por el usuario de esa sesión: ninguna ruta de
 * aquí acepta un identificador de cuenta desde fuera.
 */

/**
 * «Enviar prueba» hace que NUESTRO servidor llame a una dirección de fuera. La
 * dirección ya está validada, pero el botón sigue siendo un disparador remoto,
 * así que va con su propio límite: sin él, alguien con una cuenta podría
 * convertir esto en un pequeño generador de tráfico contra un tercero.
 */
const PRUEBA_RULE = {
  scope: "webhook-prueba",
  max: 10,
  windowMs: 60_000,
  blockMs: 5 * 60_000,
} as const;

export function integracionRoutes({ config, db }: Deps) {
  const rutas = new Hono<AppEnv>();

  rutas.use("/api/panel/integracion", exigirSesion(db));
  rutas.use("/api/panel/integracion/*", exigirSesion(db));

  /** Todo lo que hay configurado. Sin tokens ni secretos: no vuelven a salir. */
  rutas.get("/api/panel/integracion", async (c) => {
    const usuario = c.get("usuario");
    return c.json({
      entrada: await conexionesDeEntrada(db, usuario.id),
      salida: await destinosDe(db, usuario.id),
    });
  });

  /**
   * Crear una conexión de entrada. Devuelve la URL COMPLETA y con el token, que
   * es la única vez que se puede ver: en la base solo queda su hash.
   */
  rutas.post("/api/panel/integracion/entrada", async (c) => {
    const parsed = ConexionDeEntradaSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "entrada no válida" }, 400);

    const usuario = c.get("usuario");
    // Si fija un dosier, tiene que ser suyo. Mismo 404 de siempre.
    if (parsed.data.profileId) {
      const suyo = await db.one<{ id: string }>(
        `SELECT id FROM vistta.profiles WHERE id = $1 AND owner_id = $2`,
        [parsed.data.profileId, usuario.id]
      );
      if (!suyo) return c.json({ error: "perfil no encontrado" }, 404);
    }

    const { conexion, token } = await crearConexionDeEntrada(db, usuario.id, {
      nombre: parsed.data.nombre,
      profileId: parsed.data.profileId ?? null,
    });
    return c.json(
      { conexion, url: `${config.BASE_URL}/api/webhooks/entrada/${token}`, seVeUnaVez: true },
      201
    );
  });

  rutas.delete("/api/panel/integracion/entrada/:id", async (c) => {
    const ok = await revocarConexionDeEntrada(db, c.get("usuario").id, c.req.param("id"));
    if (!ok) return c.json({ error: "no encontrado" }, 404);
    return c.json({ ok: true });
  });

  /**
   * Guardar el destino de los avisos.
   *
   * La dirección se comprueba ANTES de escribirla, y la comprobación toca la
   * red: hay que resolver el nombre para saber a qué apunta. Un 400 aquí lleva
   * el motivo, porque quien lo lee es el agente arreglando su propia
   * configuración; lo que el motivo NO dice nunca es a qué dirección resolvió.
   */
  rutas.post("/api/panel/integracion/salida", async (c) => {
    const parsed = DestinoDeSalidaSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "entrada no válida" }, 400);

    try {
      const { destino, secreto } = await guardarDestino(db, c.get("usuario").id, parsed.data);
      // El secreto, una vez. Después no vuelve a salir de la base.
      return c.json({ destino, secreto, seVeUnaVez: true }, 201);
    } catch (err) {
      if (err instanceof UrlNoPermitidaError) return c.json({ error: err.motivo }, 400);
      throw err;
    }
  });

  rutas.delete("/api/panel/integracion/salida/:id", async (c) => {
    const ok = await borrarDestino(db, c.get("usuario").id, c.req.param("id"));
    if (!ok) return c.json({ error: "no encontrado" }, 404);
    return c.json({ ok: true });
  });

  rutas.post("/api/panel/integracion/salida/:id/reactivar", async (c) => {
    const ok = await reactivarDestino(db, c.get("usuario").id, c.req.param("id"));
    if (!ok) return c.json({ error: "no encontrado" }, 404);
    return c.json({ ok: true });
  });

  /**
   * El botón que hace que esto sea configurable por un comercial. Sin él, la
   * única forma de saber si funciona es esperar a que un cliente de verdad abra
   * un dosier de verdad.
   */
  rutas.post("/api/panel/integracion/salida/:id/prueba", async (c) => {
    const usuario = c.get("usuario");
    const limite = await hitRateLimit(db, PRUEBA_RULE, usuario.id);
    if (!limite.allowed) {
      c.header("Retry-After", String(limite.retryAfterSeconds));
      return c.json({ error: "demasiadas pruebas seguidas" }, 429);
    }

    const resultado = await enviarPrueba(db, usuario.id, c.req.param("id"), config.BASE_URL);
    if (!resultado) return c.json({ error: "no encontrado" }, 404);
    // 200 aunque el envío haya fallado: la petición al panel ha ido bien, y lo
    // que pasó con el CRM es el CONTENIDO de la respuesta, no su estado.
    return c.json(resultado);
  });

  return rutas;
}

function exigirSesion(db: Deps["db"]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
    if (!usuario) return c.json({ error: "no autorizado" }, 401);
    c.set("usuario", usuario);
    await next();
  };
}
