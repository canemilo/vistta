import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { verifyMediaSignature } from "../lib/media";

export function mediaRoutes({ config, storage }: Deps) {
  const media = new Hono<AppEnv>();

  // Sirve un medio solo con firma válida y no caducada. Nunca cacheable.
  media.get("/m/*", async (c) => {
    const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/m/".length));
    const pid = c.req.query("pid") ?? "";
    const exp = Number(c.req.query("exp"));
    const sig = c.req.query("sig") ?? "";

    if (!key || !pid || !sig) return c.json({ error: "Acceso denegado" }, 403);
    if (!(await verifyMediaSignature(config.MEDIA_SIGNING_KEY, key, pid, exp, sig))) {
      return c.json({ error: "Acceso denegado" }, 403);
    }

    const objeto = await storage.get(key);
    if (!objeto) return c.json({ error: "no encontrado" }, 404);

    return new Response(objeto.bytes, {
      headers: {
        "Content-Type": objeto.contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  });

  return media;
}
