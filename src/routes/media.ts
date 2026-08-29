import { Hono } from "hono";
import type { Env } from "../env";
import { verifyMediaSignature } from "../lib/media";

export const media = new Hono<{ Bindings: Env }>();

// Sirve un medio solo con firma válida y no caducada. Nunca cacheable.
media.get("/m/*", async (c) => {
  const secret = c.env.MEDIA_SIGNING_KEY;
  const bucket = c.env.MEDIA;
  if (!secret || !bucket) return c.json({ error: "medios no disponibles" }, 503);

  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/m/".length));
  const pid = c.req.query("pid") ?? "";
  const exp = Number(c.req.query("exp"));
  const sig = c.req.query("sig") ?? "";

  if (!key || !pid || !sig) return c.json({ error: "Acceso denegado" }, 403);
  if (!(await verifyMediaSignature(secret, key, pid, exp, sig))) {
    return c.json({ error: "Acceso denegado" }, 403);
  }

  const object = await bucket.get(key);
  if (!object) return c.json({ error: "no encontrado" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Disposition", "inline");
  return new Response(object.body, { headers });
});
