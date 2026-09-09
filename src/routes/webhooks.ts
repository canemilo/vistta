import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { WebhookPaseSchema } from "../schemas";
import { resolverConexionDeEntrada } from "../lib/webhooks";
import {
  createPass,
  DemasiadosPasesError,
  ModoNoPermitidoError,
  ParametroDeModoError,
  ProfileNotFoundError,
} from "../lib/pass";
import { hitRateLimit } from "../lib/ratelimit";

/**
 * La puerta que el CRM del agente empuja: crea pases SIN sesión.
 *
 * Es la única superficie del proyecto que crea recursos sin haber demostrado
 * quién eres con una contraseña, y hay que tratarla como lo que es.
 *
 * Lo que la sostiene:
 *
 *   - **Dos límites, no uno.** Por IP, que es lo que frena el que va probando
 *     tokens; y por token, que es lo que frena al CRM mal configurado que
 *     dispara en bucle. Con solo el segundo, cada token probado estrenaría su
 *     propio contador y adivinar saldría gratis.
 *   - **404 SIEMPRE**: para un token que no existe, para uno revocado y para un
 *     perfil que no es de esa cuenta. Distinguirlos convertiría esta ruta en un
 *     comprobador de credenciales caducadas y de identificadores ajenos.
 *   - **Los límites del plan valen aquí igual que en el panel.** No hay atajo:
 *     `createPass` es la misma función, con las mismas comprobaciones. Un
 *     webhook no puede ser la puerta de atrás de una cuota.
 *   - **El token va en la URL** —un CRM no sabe iniciar sesión—, así que puede
 *     acabar en el registro de un tercero. Por eso en la base solo vive su hash
 *     y por eso `last_used_at` existe: para poder darse cuenta y revocar.
 *
 * Sobre los logs de ESTE proyecto: `app.ts` registra el PATRÓN de la ruta
 * (`/api/webhooks/entrada/:token`), nunca la real. La misma norma que ya
 * protegía el token del pase cubre este.
 */

/** Por IP: frena a quien prueba tokens. Amplio, pero no infinito. */
const IP_RULE = {
  scope: "webhook-entrada-ip",
  max: 60,
  windowMs: 60_000,
  blockMs: 5 * 60_000,
} as const;

/** Por token: frena al CRM que se ha quedado en bucle. */
const TOKEN_RULE = {
  scope: "webhook-entrada-token",
  max: 30,
  windowMs: 60_000,
  blockMs: 60_000,
} as const;

export function webhooksRoutes({ config, db }: Deps) {
  const webhooks = new Hono<AppEnv>();

  webhooks.post("/api/webhooks/entrada/:token", async (c) => {
    const porIp = await hitRateLimit(db, IP_RULE, c.get("ip"));
    if (!porIp.allowed) {
      c.header("Retry-After", String(porIp.retryAfterSeconds));
      return c.json({ error: "demasiadas peticiones" }, 429);
    }

    const token = c.req.param("token");
    const porToken = await hitRateLimit(db, TOKEN_RULE, token);
    if (!porToken.allowed) {
      c.header("Retry-After", String(porToken.retryAfterSeconds));
      return c.json({ error: "demasiadas peticiones" }, 429);
    }

    const conexion = await resolverConexionDeEntrada(db, token);
    if (!conexion) return c.json({ error: "no encontrado" }, 404);

    const parsed = WebhookPaseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
    }

    // El de la conexión manda sobre el de la petición: si el agente ató esta
    // credencial a un dosier, quien la tenga no puede usarla para otro.
    const profileId = conexion.profileId ?? parsed.data.profileId;
    if (!profileId) {
      return c.json({ error: "falta el dosier: dilo en la petición o fíjalo en la conexión" }, 400);
    }

    /*
     * Aquí se cierra el paso entre inquilinos. El perfil tiene que ser de la
     * cuenta DUEÑA DE LA CONEXIÓN, no de quien pida: si esto no estuviera, un
     * token válido crearía pases sobre el dosier de cualquiera con solo
     * escribir su identificador.
     */
    const suyo = await db.one<{ id: string }>(
      `SELECT id FROM vistta.profiles
       WHERE id = $1 AND owner_id = $2 AND status = 'activo'`,
      [profileId, conexion.ownerId]
    );
    if (!suyo) return c.json({ error: "no encontrado" }, 404);

    try {
      const {
        token: nuevo,
        expiresAt,
        modo,
      } = await createPass(db, {
        ...parsed.data,
        profileId,
      });
      // La URL, que es lo que el CRM guarda en la ficha del contacto.
      return c.json({ url: `${config.BASE_URL}/v/${nuevo}`, expiresAt, modo }, 201);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) return c.json({ error: "no encontrado" }, 404);
      if (err instanceof ModoNoPermitidoError) {
        return c.json({ error: "el plan no admite ese modo de pase", modo: err.modo }, 403);
      }
      if (err instanceof ParametroDeModoError) {
        return c.json(
          { error: "valor fuera del tope del plan", campo: err.campo, maximo: err.maximo },
          400
        );
      }
      if (err instanceof DemasiadosPasesError) {
        return c.json({ error: "demasiados pases abiertos a la vez", limite: err.limite }, 409);
      }
      throw err;
    }
  });

  return webhooks;
}
