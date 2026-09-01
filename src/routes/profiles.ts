import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Deps } from "../deps";
import type { Db } from "../db";
import { UpdateProfileSchema } from "../schemas";
import { parseProfileData } from "../lib/pass";
import { bearer, usuarioDeLaSesion } from "../lib/auth";

/** Tipos de imagen admitidos al subir. Nada de SVG: puede llevar script dentro. */
const TIPOS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/gif", "gif"],
]);
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Forma exacta de una clave de medio: u/<perfil>/<archivo>.
 *
 * Es lo que corta el traversal, y se comprueba aquí y no en el proveedor a
 * propósito: con R2 una clave con ".." daba 404 por accidente, pero Supabase
 * Storage normaliza la ruta y ahí sí serviría el objeto de otro. La defensa no
 * puede depender de cómo trate las rutas el almacenamiento de turno.
 */
const CLAVE_DE_MEDIO = /^u\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,128}$/;

export function profilesRoutes({ db, storage }: Deps) {
  const profiles = new Hono<AppEnv>();

  // Todo lo que hay aquí es del panel: exige sesión y deja el usuario en el contexto.
  for (const ruta of ["/api/profiles", "/api/profiles/*", "/api/media", "/api/media/*"]) {
    profiles.use(ruta, async (c, next) => {
      const usuario = await usuarioDeLaSesion(db, bearer(c.req.header("Authorization")));
      if (!usuario) return c.json({ error: "no autorizado" }, 401);
      c.set("usuario", usuario);
      await next();
    });
  }

  /** Perfiles del usuario que pide. Nadie ve los de otro. */
  profiles.get("/api/profiles", async (c) => {
    const { rows } = await db.query<{ id: string; displayName: string }>(
      `SELECT id, display_name AS "displayName" FROM vistta.profiles
       WHERE owner_id = $1 ORDER BY display_name`,
      [c.get("usuario").id]
    );
    return c.json({ profiles: rows });
  });

  // Contenido de un perfil, tal cual está guardado (con claves, no URLs firmadas).
  profiles.get("/api/profiles/:id", async (c) => {
    const row = await db.one<{
      id: string;
      displayName: string;
      brandColor: string | null;
      data: unknown;
    }>(
      `SELECT id, display_name AS "displayName", brand_color AS "brandColor", data
       FROM vistta.profiles WHERE id = $1 AND owner_id = $2`,
      [c.req.param("id"), c.get("usuario").id]
    );
    if (!row) return c.json({ error: "perfil no encontrado" }, 404);
    return c.json({ ...row, data: parseProfileData(row.data) });
  });

  // Guardar el contenido que ha montado el cliente.
  profiles.put("/api/profiles/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
    }

    const res = await db.query(
      `UPDATE vistta.profiles
       SET data = $1::jsonb,
           display_name = COALESCE($2, display_name),
           brand_color = COALESCE($3, brand_color)
       WHERE id = $4 AND owner_id = $5`,
      [
        JSON.stringify(parsed.data.data),
        parsed.data.displayName ?? null,
        parsed.data.brandColor ?? null,
        c.req.param("id"),
        c.get("usuario").id,
      ]
    );

    if (res.rowCount !== 1) return c.json({ error: "perfil no encontrado" }, 404);
    return c.json({ ok: true });
  });

  // Subir una foto. Devuelve la clave; el contenido nunca se sirve sin firma.
  profiles.post("/api/media", async (c) => {
    const form = await c.req.parseBody().catch(() => null);
    const file = form?.["file"];
    const profileId = String(form?.["profileId"] ?? "");
    // En FormData el valor es File o string: descartamos el string y el vacío.
    if (!file || typeof file === "string" || !profileId) {
      return c.json({ error: "falta el archivo o el perfil" }, 400);
    }

    if (!(await esSuyo(db, c, profileId))) return c.json({ error: "perfil no encontrado" }, 404);

    const ext = TIPOS.get(file.type);
    if (!ext) return c.json({ error: "formato no admitido" }, 415);
    if (file.size > MAX_BYTES) return c.json({ error: "archivo demasiado grande" }, 413);

    const bytes = new Uint8Array(await file.arrayBuffer());
    // El tamaño declarado no vale nada: se comprueba contra los bytes reales.
    if (bytes.byteLength > MAX_BYTES) return c.json({ error: "archivo demasiado grande" }, 413);

    const key = `u/${profileId}/${crypto.randomUUID()}.${ext}`;
    await storage.put(key, bytes, file.type);
    return c.json({ key, type: "image" as const }, 201);
  });

  // Vista previa para el panel: mismo objeto, pero autorizado por sesión en vez de firma.
  profiles.get("/api/media/*", async (c) => {
    const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/media/".length));
    if (!CLAVE_DE_MEDIO.test(key)) return c.json({ error: "no encontrado" }, 404);

    // Las claves son u/<perfil>/<archivo>: solo se sirve lo que es del usuario.
    const perfilDeLaClave = key.split("/")[1] ?? "";
    if (!(await esSuyo(db, c, perfilDeLaClave))) return c.json({ error: "no encontrado" }, 404);

    const objeto = await storage.get(key);
    if (!objeto) return c.json({ error: "no encontrado" }, 404);

    return new Response(objeto.bytes, {
      headers: { "Content-Type": objeto.contentType, "Cache-Control": "no-store" },
    });
  });

  return profiles;
}

/** ¿Ese perfil es del usuario de la sesión? */
async function esSuyo(db: Db, c: Context<AppEnv>, profileId: string): Promise<boolean> {
  if (!profileId) return false;
  const fila = await db.one<{ id: string }>(
    `SELECT id FROM vistta.profiles WHERE id = $1 AND owner_id = $2`,
    [profileId, c.get("usuario").id]
  );
  return fila !== null;
}
