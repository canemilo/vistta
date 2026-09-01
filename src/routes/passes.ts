import { Hono } from "hono";
import type { Env } from "../env";
import { CreatePassSchema } from "../schemas";
import type { MediaItemInput, Section } from "../schemas";
import { createPass, consumePass, ProfileNotFoundError } from "../lib/pass";
import { usuarioDeLaSesion } from "../lib/auth";
import { clientId, hitRateLimit } from "../lib/ratelimit";
import { signMediaUrl, watermarkFor } from "../lib/media";

export const passes = new Hono<{ Bindings: Env }>();

/** Apertura de pases: límite amplio, solo para frenar el sondeo automatizado. */
const OPEN_RULE = { scope: "pass-open", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;
const CREATE_RULE = { scope: "pass-create", max: 60, windowMs: 60_000, blockMs: 60_000 } as const;

/** Sección tal y como la recibe el viewer: las claves ya son URLs firmadas. */
interface SectionView {
  type: Section["type"];
  title?: string;
  body?: string;
  items: { url: string; type: MediaItemInput["type"]; caption?: string }[];
}

// Generar un pase (panel).
passes.post("/api/passes", async (c) => {
  const limit = await hitRateLimit(c.env, CREATE_RULE, clientId(c));
  if (!limit.allowed) {
    c.header("Retry-After", String(limit.retryAfterSeconds));
    return c.json({ error: "demasiadas peticiones" }, 429);
  }
  const usuario = await usuarioDeLaSesion(c);
  if (!usuario) return c.json({ error: "no autorizado" }, 401);

  const body = await c.req.json().catch(() => null);
  const parsed = CreatePassSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
  }

  // Solo se generan pases del propio perfil.
  const suyo = await c.env.DB.prepare(`SELECT id FROM profiles WHERE id = ?1 AND owner_id = ?2`)
    .bind(parsed.data.profileId, usuario.id)
    .first<{ id: string }>();
  if (!suyo) return c.json({ error: "perfil no encontrado" }, 404);

  try {
    const { token, expiresAt } = await createPass(c.env, parsed.data);
    const base = c.env.BASE_URL ?? new URL(c.req.url).origin;
    return c.json({ url: `${base}/v/${token}`, expiresAt }, 201);
  } catch (err) {
    if (err instanceof ProfileNotFoundError) return c.json({ error: "perfil no encontrado" }, 404);
    throw err;
  }
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
  const sections: SectionView[] = await Promise.all(
    view.sections.map(async (section) => ({
      type: section.type,
      title: section.title,
      body: "body" in section ? section.body : undefined,
      items:
        secret && "items" in section
          ? await Promise.all(
              section.items.map(async (item) => ({
                type: item.type,
                caption: item.caption,
                url: await signMediaUrl(secret, item, view.passId),
              }))
            )
          : [],
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
    watermark: watermarkFor(view.passId),
  });
});
