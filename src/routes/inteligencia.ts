import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { AppEnv, Deps } from "../deps";
import { PreferenciaAvisosSchema } from "../schemas";
import { bearer, usuarioDeLaSesion } from "../lib/auth";
import { termometroDeLaCuenta } from "../lib/termometro";
import { comparativaDeLaCuenta } from "../lib/comparativa";
import { avisosActivos, avisosPendientes, configurarAvisos, marcarVisto } from "../lib/avisos";
import { periodoDeLaConsulta } from "../lib/periodo";
import { hayConexionApagada } from "../lib/webhooks-salida";

/**
 * Lo que el agente sabe de su cartera: a quién llamar hoy y dónde merece la
 * pena el esfuerzo.
 *
 * Todo aquí es de CUENTA, no de un perfil concreto, y por eso cuelga de
 * `/api/panel/*` y no de `/api/profiles/*`. El informe de una propiedad sí es
 * de un perfil y vive en `routes/profiles.ts`, junto al resto de rutas que ya
 * comprueban de quién es cada perfil.
 *
 * EL AISLAMIENTO NO SE COMPRUEBA AQUÍ: se le pasa el `userId` de la sesión a
 * cada consulta, que lo mete en su WHERE. No hay ninguna ruta de este archivo
 * que acepte un identificador de cuenta desde fuera.
 */
export function inteligenciaRoutes({ db }: Deps) {
  const rutas = new Hono<AppEnv>();

  rutas.use("/api/panel/termometro", exigirSesion(db));
  rutas.use("/api/panel/comparativa", exigirSesion(db));
  rutas.use("/api/panel/avisos", exigirSesion(db));
  rutas.use("/api/panel/avisos/*", exigirSesion(db));

  /** A quién llamar hoy: los pases del agente ordenados por temperatura. */
  rutas.get("/api/panel/termometro", async (c) => {
    return c.json({ pases: await termometroDeLaCuenta(db, c.get("usuario").id) });
  });

  /**
   * Una fila por propiedad. Solo las suyas: `comparativaDeLaCuenta` filtra por
   * `owner_id` y no hay forma de pedir las de otro, porque el id no viaja.
   */
  rutas.get("/api/panel/comparativa", async (c) => {
    const periodo = periodoDeLaConsulta(c.req.query("desde"), c.req.query("hasta"));
    if (!periodo.ok) return c.json({ error: periodo.error }, 400);
    return c.json(await comparativaDeLaCuenta(db, c.get("usuario").id, periodo.valor));
  });

  /** Los avisos sin ver, y si la cuenta los quiere. */
  rutas.get("/api/panel/avisos", async (c) => {
    const usuario = c.get("usuario");
    return c.json({
      avisos: await avisosPendientes(db, usuario.id),
      activos: await avisosActivos(db, usuario.id),
      /*
       * Un webhook roto EN SILENCIO es peor que no tenerlo: el agente cree que
       * su CRM le avisa y no le avisa nadie. Por eso el estado viaja con los
       * avisos, que es la pantalla que abre cada mañana, y no solo en la de
       * configuración, que se abre una vez y no se vuelve a mirar.
       */
      conexionApagada: await hayConexionApagada(db, usuario.id),
    });
  });

  rutas.put("/api/panel/avisos", async (c) => {
    const parsed = PreferenciaAvisosSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "entrada no válida" }, 400);
    await configurarAvisos(db, c.get("usuario").id, parsed.data.activos);
    return c.json({ ok: true, activos: parsed.data.activos });
  });

  /**
   * «Ya lo he visto». Cierra el aviso, y a partir de ahí una nueva reapertura
   * abre uno nuevo: que vuelva mañana es una noticia distinta de que volviera
   * ayer.
   */
  rutas.post("/api/panel/avisos/:id/visto", async (c) => {
    const ok = await marcarVisto(db, c.get("usuario").id, c.req.param("id"));
    // Mismo 404 para «no existe» y «no es tuyo»: el error no puede convertirse
    // en un buscador de identificadores ajenos.
    if (!ok) return c.json({ error: "no encontrado" }, 404);
    return c.json({ ok: true });
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
