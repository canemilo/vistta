import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { CreatePassSchema, EventosSchema } from "../schemas";
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
import { signEventsToken, signMediaUrl, verifyEventsToken, watermarkFor } from "../lib/media";
import { registrarEventos, resumenDeLectura } from "../lib/eventos";

/** Apertura de pases: límite amplio, solo para frenar el sondeo automatizado. */
const OPEN_RULE = { scope: "pass-open", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;
const CREATE_RULE = { scope: "pass-create", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;
/**
 * Telemetría: límite propio y generoso.
 *
 * Propio porque compartirlo con la apertura significaría que mirar mucho un
 * dossier acaba impidiendo abrirlo, y eso convertiría una función accesoria en
 * un fallo del producto.
 */
const EVENTOS_RULE = {
  scope: "pass-eventos",
  max: 120,
  windowMs: 60_000,
  blockMs: 60_000,
} as const;

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
        logo: view.logo,
        tagline: view.tagline,
        intro: view.intro,
      },
      sections,
      tema: view.tema,
      watermark: watermarkFor(view.passId, new Date(), view.destinatarioRef),
      /*
       * Testigo para la telemetría de ESTA lectura. Se emite solo si el plan de
       * quien generó el pase registra actividad; si no, el viewer no recibe
       * nada y no mide nada. Es la puerta: sin testigo no hay eventos posibles,
       * porque el endpoint no acepta ninguna otra credencial.
       */
      eventos: view.mideLectura
        ? await signEventsToken(config.MEDIA_SIGNING_KEY, view.passId)
        : null,
    });
  });

  /*
   * Telemetría de una lectura.
   *
   * NO lleva el testigo del pase en la ruta, y es una desviación consciente de
   * lo que pedía el plan. Dos razones: ese testigo es una credencial y no tiene
   * por qué viajar en cada latido; y el pase de un solo uso SE CONSUME al
   * abrirlo, así que exigir «un pase todavía abrible» habría dejado sin
   * métricas precisamente al modo más común. Lo que se exige es el testigo
   * firmado que el servidor emitió al abrir: demuestra que este navegador abrió
   * este pase hace menos de dos horas.
   *
   * Y responde 204 pase lo que pase con el contenido: esto es telemetría, no
   * funcionalidad. Un fallo aquí no puede estropearle la visita a nadie.
   */
  passes.post("/api/passes/eventos", async (c) => {
    const limit = await hitRateLimit(db, EVENTOS_RULE, c.get("ip"));
    if (!limit.allowed) return c.body(null, 204);

    const body = await c.req.json().catch(() => null);
    const parsed = EventosSchema.safeParse(body);
    if (!parsed.success) return c.body(null, 204);

    const passId = await verifyEventsToken(config.MEDIA_SIGNING_KEY, parsed.data.testigo);
    if (!passId) return c.body(null, 204);

    await registrarEventos(db, passId, parsed.data.eventos);
    return c.body(null, 204);
  });

  /*
   * Lo que el dueño del pase ve de esa lectura. Ya agregado: el panel no recibe
   * los eventos crudos, porque la lista de instantes en que otra persona miró
   * cada foto no tiene por qué salir de la base.
   */
  passes.get("/api/passes/:id/lectura", async (c) => {
    const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
    if (!usuario) return c.json({ error: "no autorizado" }, 401);

    const suyo = await db.one<{ id: string }>(
      `SELECT ps.id FROM vistta.passes ps
       JOIN vistta.profiles p ON p.id = ps.profile_id
       WHERE ps.id = $1 AND p.owner_id = $2`,
      [c.req.param("id"), usuario.id]
    );
    if (!suyo) return c.json({ error: "no encontrado" }, 404);

    return c.json(await resumenDeLectura(db, suyo.id));
  });

  return passes;
}
