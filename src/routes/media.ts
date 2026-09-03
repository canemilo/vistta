import { Hono } from "hono";
import type { AppEnv, Deps } from "../deps";
import { verifyMediaSignature, watermarkFor } from "../lib/media";
import { medioDelPase } from "../lib/media-store";
import { marcarImagen } from "../lib/watermark";

export function mediaRoutes({ config, db, storage }: Deps) {
  const media = new Hono<AppEnv>();

  /**
   * Sirve un medio a una visita concreta. Tres puertas, y hacen falta las tres:
   *
   *   1. la firma dice que esta URL la emitimos nosotros y aún no ha caducado;
   *   2. `pass_media` dice que este pase tenía derecho a este medio (la firma
   *      sola no bastaría: es lo que dejaba servir el medio de otro inquilino);
   *   3. `status = 'ready'` dice que el backend llegó a mirar esos bytes.
   *
   * Nunca cacheable: la marca de agua es por visita, así que una respuesta
   * guardada sería la marca de otro.
   */
  media.get("/m/:mediaId", async (c) => {
    const mediaId = c.req.param("mediaId");
    const pid = c.req.query("pid") ?? "";
    const exp = Number(c.req.query("exp"));
    const sig = c.req.query("sig") ?? "";

    if (!mediaId || !pid || !sig) return c.json({ error: "Acceso denegado" }, 403);
    if (!(await verifyMediaSignature(config.MEDIA_SIGNING_KEY, mediaId, pid, exp, sig))) {
      return c.json({ error: "Acceso denegado" }, 403);
    }

    const medio = await medioDelPase(db, pid, mediaId);
    if (!medio) return c.json({ error: "Acceso denegado" }, 403);

    const objeto = await storage.get(medio.storage_key);
    if (!objeto) return c.json({ error: "no encontrado" }, 404);

    /*
     * Se sirve POR TIPO, y no es un detalle de implementación.
     *
     * Las imágenes pasan por Sharp y salen con la marca de la visita metida en
     * los píxeles: son bytes nuevos, calculados para esta apertura. Por eso no
     * se cachean, y por eso pasan por Node en vez de ir por una URL del
     * proveedor: es el precio de que "marca de agua por visita" sea verdad.
     *
     * El vídeo y los documentos salen tal cual. Marcarlos costaría transcodificar
     * en cada visita, y eso no cabe en el MVP; el panel tiene que decirlo con
     * esas palabras, porque la alternativa es que el cliente crea que su vídeo
     * lleva una marca que no lleva.
     */
    if (medio.kind === "image") {
      const marcada = await marcarImagen(
        objeto.bytes,
        watermarkFor(pid, new Date(), medio.destinatario_ref)
      );
      return new Response(marcada.bytes, {
        headers: {
          "Content-Type": marcada.mime,
          "Content-Disposition": "inline",
          "Cache-Control": "no-store",
        },
      });
    }

    return new Response(objeto.bytes, {
      headers: {
        "Content-Type": medio.mime,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store",
      },
    });
  });

  return media;
}
