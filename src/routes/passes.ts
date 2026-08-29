import { Hono } from "hono";
import type { Env } from "../env";
import { CreatePassSchema } from "../schemas";
import { createPass, consumePass, ProfileNotFoundError } from "../lib/pass";
import { isAuthorized } from "../lib/auth";
import { clientId, hitRateLimit } from "../lib/ratelimit";
import { MediaItemSchema } from "../schemas";
import { signMediaUrl, watermarkFor } from "../lib/media";
import { z } from "zod";

export const passes = new Hono<{ Bindings: Env }>();

/** Apertura de pases: límite amplio, solo para frenar el sondeo automatizado. */
const OPEN_RULE = { scope: "pass-open", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;
const CREATE_RULE = { scope: "pass-create", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;

// Generar un pase (panel).
passes.post("/api/passes", async (c) => {
  const limit = await hitRateLimit(c.env, CREATE_RULE, clientId(c));
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfterSeconds));
    return c.json({ error: "demasiadas peticiones" }, 429);
  }
  if (!(await isAuthorized(c))) return c.json({ error: "no autorizado" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CreatePassSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
  }

  try {
    const { token, expiresAt } = await createPass(c.env, parsed.data);
    const base = c.env.BASE_URL ?? new URL(c.req.url).origin;
    return c.json({ url: `${base}/v/${token}`, expiresAt }, 201);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) return c.json({ error: "perfil no encontrado" }, 404);
    throw err;
  }
});

// Listado de perfiles (panel) para elegir a quién presentar.
passes.get("/api/profiles", async (c) => {
  if (!(await isAuthorized(c))) return c.json({ error: "no autorizado" }, 401);
  const { results } = await c.env.DB.prepare(
    `SELECT id, display_name AS displayName FROM profiles ORDER BY display_name`
  ).all<{ id: string; displayName: string }>();
  return c.json({ profiles: results });
});

// Abrir un pase (cliente). Se consume en el primer acceso.
// La ruta pública /v/:token la sirve el viewer; esta es su API.
passes.get("/api/open/:token", async (c) => {
  const limit = await hitRateLimit(c.env, OPEN_RULE, clientId(c));
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfterSeconds));
    return c.json({ error: "demasiadas peticiones" }, 429);
  }

  const view = await consumePass(c.env, c.req.param("token"));
  if (!view) return c.json({ error: "Acceso denegado" }, 410);

  const secret = c.env.MEDIA_SIGNING_KEY;
  const items = z.array(MediaItemSchema).safeParse(view.data.media ?? []);
  const media =
    secret && items.success
      ? await Promise.all(
          items.data.map(async (item) => ({
            type: item.type,
            caption: item.caption,
            url: await signMediaUrl(secret, item, view.passId),
          }))
        )
      : [];

  return c.json({
    profile: {
      id: view.profileId,
      displayName: view.displayName,
      brandColor: view.brandColor,
      data: view.data,
    },
    media,
    watermark: watermarkFor(view.passId),
  });
});
