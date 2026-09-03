import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { CreatePassSchema } from "../schemas";
import {
  createPass,
  consumePass,
  DemasiadosPasesError,
  ModoNoPermitidoError,
  ParametroDeModoError,
  ProfileNotFoundError,
  pasesDelPerfil,
} from "../lib/pass";
import type { SeccionDePase } from "../lib/pass";
import { bearer, usuarioDeLaSesion } from "../lib/auth";
import { hitRateLimit } from "../lib/ratelimit";
import { signMediaUrl, watermarkFor } from "../lib/media";

/** Apertura de pases: límite amplio, solo para frenar el sondeo automatizado. */
const OPEN_RULE = { scope: "pass-open", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;
const CREATE_RULE = { scope: "pass-create", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;

/**
 * Sección tal y como la recibe el viewer: ya no hay ids ni claves, solo URLs
 * firmadas para esta visita. Las dimensiones van con cada medio para que el
 * viewer reserve el hueco antes de que llegue un solo byte de imagen.
 */
interface SectionView {
  type: SeccionDePase["type"];
  title?: string;
  body?: string;
  display?: SeccionDePase["display"];
  items: {
    url: string;
    type: string;
    caption?: string;
    width: number | null;
    height: number | null;
    lqip: string | null;
  }[];
}

export function passesRoutes({ config, db }: Deps) {
  const passes = new Hono<AppEnv>();

  // Generar un pase (panel).
  passes.post("/api/passes", async (c) => {
    const limit = await hitRateLimit(db, CREATE_RULE, c.get("ip"));
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSeconds));
      return c.json({ error: "demasiadas peticiones" }, 429);
    }
    const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
    if (!usuario) return c.json({ error: "no autorizado" }, 401);

    const body = await c.req.json().catch(() => null);
    const parsed = CreatePassSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
    }

    // Solo se generan pases del propio perfil, y solo de uno activo.
    const suyo = await db.one<{ id: string }>(
      `SELECT id FROM vistta.profiles
       WHERE id = $1 AND owner_id = $2 AND status = 'activo'`,
      [parsed.data.profileId, usuario.id]
    );
    if (!suyo) return c.json({ error: "perfil no encontrado" }, 404);

    try {
      const { token, expiresAt, modo } = await createPass(db, parsed.data);
      return c.json({ url: `${config.BASE_URL}/v/${token}`, expiresAt, modo }, 201);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        return c.json({ error: "perfil no encontrado" }, 404);
      }
      if (err instanceof ModoNoPermitidoError) {
        // 403 y no 400: la petición está bien formada, lo que no da es el plan.
        // Y NUNCA un pase silencioso de otro modo: quien pide tres accesos y
        // recibe uno de un solo uso se entera cuando el cliente ya no puede
        // abrir el enlace.
        return c.json({ error: "el plan no admite ese modo de pase", modo: err.modo }, 403);
      }
      if (err instanceof ParametroDeModoError) {
        return c.json(
          { error: "valor fuera del tope del plan", campo: err.campo, maximo: err.maximo },
          400
        );
      }
      if (err instanceof DemasiadosPasesError) {
        // 409 y no 402: el problema no es que no haya pagado, es que ya tiene
        // demasiados enlaces vivos. Se arregla esperando a que caduquen o a que
        // los abran, sin tocar la cartera.
        return c.json({ error: "demasiados pases abiertos a la vez", limite: err.limite }, 409);
      }
      throw err;
    }
  });

  /*
   * Los pases de un perfil, para el panel.
   *
   * Hace falta desde que un pase puede abrirse más de una vez: sin esto, quien
   * manda un enlace de tres accesos no tiene forma de saber si quedan tres, uno
   * o ninguno. Devuelve el estado ya calculado por el servidor y JAMÁS el
   * token, que en la base solo existe como hash.
   */
  passes.get("/api/passes", async (c) => {
    const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
    if (!usuario) return c.json({ error: "no autorizado" }, 401);

    const profileId = c.req.query("profileId") ?? "";
    const suyo = await db.one<{ id: string }>(
      `SELECT id FROM vistta.profiles WHERE id = $1 AND owner_id = $2`,
      [profileId, usuario.id]
    );
    if (!suyo) return c.json({ error: "perfil no encontrado" }, 404);

    return c.json({ passes: await pasesDelPerfil(db, profileId) });
  });

  // Abrir un pase (cliente). Se consume en el primer acceso.
  // La ruta pública /v/:token la sirve el viewer; esta es su API.
  passes.get("/api/open/:token", async (c) => {
    const limit = await hitRateLimit(db, OPEN_RULE, c.get("ip"));
    if (!limit.allowed) {
      c.header("Retry-After", String(limit.retryAfterSeconds));
      return c.json({ error: "demasiadas peticiones" }, 429);
    }

    const view = await consumePass(db, c.req.param("token"));
    if (!view) return c.json({ error: "Acceso denegado" }, 410);

    const secret = config.MEDIA_SIGNING_KEY;
    const sections: SectionView[] = await Promise.all(
      view.sections.map(async (section) => ({
        type: section.type,
        title: section.title,
        body: section.body,
        // Cómo se presentan las fotos. Se olvidó al añadirlo y el viewer
        // enseñaba siempre la cuadrícula: esta lista se escribe campo a campo,
        // así que lo que no se nombra aquí no llega, aunque esté en la base y
        // el esquema lo valide.
        display: section.display,
        items: await Promise.all(
          section.items.map(async (item) => ({
            type: item.kind,
            caption: item.caption,
            width: item.width,
            height: item.height,
            lqip: item.lqip,
            url: await signMediaUrl(secret, item.mediaId, view.passId),
          }))
        ),
      }))
    );

    return c.json({
      profile: {
        id: view.profileId,
        displayName: view.displayName,
        brandColor: view.brandColor,
        tagline: view.tagline,
        intro: view.intro,
      },
      sections,
      watermark: watermarkFor(view.passId, new Date(), view.destinatarioRef),
    });
  });

  return passes;
}
