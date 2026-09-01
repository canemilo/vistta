import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import { UpdateProfileSchema } from "../schemas";
import { parseProfileData } from "../lib/pass";
import { usuarioDeLaSesion, type Usuario } from "../lib/auth";

type Ctx = { Bindings: Env; Variables: { usuario: Usuario } };

export const profiles = new Hono<Ctx>();

/** Tipos de imagen admitidos al subir. Nada de SVG: puede llevar script dentro. */
const TIPOS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/avif", "avif"],
  ["image/gif", "gif"],
]);
const MAX_BYTES = 15 * 1024 * 1024;

// Todo lo que hay aquí es del panel: exige sesión y deja el usuario en el contexto.
for (const ruta of ["/api/profiles", "/api/profiles/*", "/api/media", "/api/media/*"]) {
  profiles.use(ruta, async (c, next) => {
    const usuario = await usuarioDeLaSesion(c);
    if (!usuario) return c.json({ error: "no autorizado" }, 401);
    c.set("usuario", usuario);
    await next();
  });
}

/** Perfiles del usuario que pide. Nadie ve los de otro. */
profiles.get("/api/profiles", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, display_name AS displayName FROM profiles
     WHERE owner_id = ?1 ORDER BY display_name`
  )
    .bind(c.get("usuario").id)
    .all<{ id: string; displayName: string }>();
  return c.json({ profiles: results });
});

// Contenido de un perfil, tal cual está guardado (con claves, no URLs firmadas).
profiles.get("/api/profiles/:id", async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT id, display_name AS displayName, brand_color AS brandColor, data
     FROM profiles WHERE id = ?1 AND owner_id = ?2`
  )
    .bind(c.req.param("id"), c.get("usuario").id)
    .first<{ id: string; displayName: string; brandColor: string | null; data: string }>();
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

  const id = c.req.param("id");
  const res = await c.env.DB.prepare(
    `UPDATE profiles
     SET data = ?1,
         display_name = COALESCE(?2, display_name),
         brand_color = COALESCE(?3, brand_color)
     WHERE id = ?4 AND owner_id = ?5`
  )
    .bind(
      JSON.stringify(parsed.data.data),
      parsed.data.displayName ?? null,
      parsed.data.brandColor ?? null,
      id,
      c.get("usuario").id
    )
    .run();

  if (res.meta.changes !== 1) return c.json({ error: "perfil no encontrado" }, 404);
  return c.json({ ok: true });
});

// Subir una foto. Devuelve la clave en R2; el contenido nunca se sirve sin firma.
profiles.post("/api/media", async (c) => {
  const bucket = c.env.MEDIA;
  if (!bucket) return c.json({ error: "almacenamiento no disponible" }, 503);

  const form = await c.req.parseBody().catch(() => null);
  const file = form?.["file"];
  const profileId = String(form?.["profileId"] ?? "");
  // En FormData el valor es File o string: descartamos el string y el vacío.
  if (!file || typeof file === "string" || !profileId) {
    return c.json({ error: "falta el archivo o el perfil" }, 400);
  }

  if (!(await esSuyo(c, profileId))) return c.json({ error: "perfil no encontrado" }, 404);

  const ext = TIPOS.get(file.type);
  if (!ext) return c.json({ error: "formato no admitido" }, 415);
  if (file.size > MAX_BYTES) return c.json({ error: "archivo demasiado grande" }, 413);

  const key = `u/${profileId}/${crypto.randomUUID()}.${ext}`;
  await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return c.json({ key, type: "image" as const }, 201);
});

// Vista previa para el panel: mismo objeto, pero autorizado por sesión en vez de firma.
profiles.get("/api/media/*", async (c) => {
  const bucket = c.env.MEDIA;
  if (!bucket) return c.json({ error: "almacenamiento no disponible" }, 503);

  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/api/media/".length));
  // Las claves son u/<perfil>/<archivo>: solo se sirve lo que es del usuario.
  const perfilDeLaClave = key.split("/")[1] ?? "";
  if (!key.startsWith("u/") || !(await esSuyo(c, perfilDeLaClave))) {
    return c.json({ error: "no encontrado" }, 404);
  }

  const object = await bucket.get(key);
  if (!object) return c.json({ error: "no encontrado" }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "no-store");
  return new Response(object.body, { headers });
});

/** ¿Ese perfil es del usuario de la sesión? */
async function esSuyo(c: Context<Ctx>, profileId: string): Promise<boolean> {
  if (!profileId) return false;
  const fila = await c.env.DB.prepare(
    `SELECT id FROM profiles WHERE id = ?1 AND owner_id = ?2`
  )
    .bind(profileId, c.get("usuario").id)
    .first<{ id: string }>();
  return fila !== null;
}
