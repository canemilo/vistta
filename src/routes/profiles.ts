import { Hono } from "hono";
import type { Context } from "hono";
import type { AppEnv, Deps } from "../deps";
import type { Db } from "../db";
import { PresignSchema, UpdateProfileSchema, idsDeMedios } from "../schemas";
import { parseProfileData } from "../lib/pass";
import { bearer, usuarioDeLaSesion } from "../lib/auth";
import { signUploadUrl, verifyUploadSignature } from "../lib/media";
import {
  CUOTA_POR_PERFIL,
  CuotaExcedidaError,
  DemasiadasReservasError,
  ReservaNoValidaError,
  confirmarMedio,
  cuotaUsada,
  mediosDelPerfil,
  reservarMedio,
} from "../lib/media-store";
import { LIMITE_ABSOLUTO, LIMITE_POR_TIPO } from "../lib/sniff";
import { CuerpoDemasiadoGrandeError, leerCuerpoConTope } from "../lib/body";

export function profilesRoutes({ config, db, storage }: Deps) {
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

  // Contenido de un perfil, tal cual está guardado (con ids, no URLs firmadas).
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

    const data = parseProfileData(row.data);
    // El panel necesita las dimensiones para pintar la rejilla igual que el
    // viewer; van aparte del contenido, porque el contenido solo guarda ids.
    const medios = await mediosDelPerfil(db, row.id, idsDeMedios(data));
    return c.json({
      ...row,
      data,
      media: [...medios.values()].map((m) => ({
        id: m.id,
        kind: m.kind,
        width: m.width,
        height: m.height,
        lqip: m.lqip,
      })),
      quota: { usados: await cuotaUsada(db, row.id), total: CUOTA_POR_PERFIL },
    });
  });

  // Guardar el contenido que ha montado el cliente.
  profiles.put("/api/profiles/:id", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = UpdateProfileSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
    }

    const profileId = c.req.param("id");
    if (!(await esSuyo(db, c, profileId))) return c.json({ error: "perfil no encontrado" }, 404);

    /*
     * Aquí se cierra el IDOR entre inquilinos.
     *
     * Cada id que viene en el JSON se contrasta contra `vistta.media`, donde
     * consta de qué perfil es. Un id que no salga de esa consulta se rechaza en
     * vez de guardarse: si se guardase, la apertura del pase acabaría firmando
     * una URL para el medio de otro, que es justo el fallo que había.
     */
    const referenciados = idsDeMedios(parsed.data.data);
    const propios = await mediosDelPerfil(db, profileId, referenciados);
    const ajenos = referenciados.filter((id) => !propios.has(id));
    if (ajenos.length > 0) {
      // Sin decir cuál ni por qué: "no es tuyo" y "no existe" tienen que sonar
      // igual, o el error se convierte en un buscador de ids ajenos.
      return c.json({ error: "hay medios que no existen en este perfil" }, 400);
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
        profileId,
        c.get("usuario").id,
      ]
    );

    if (res.rowCount !== 1) return c.json({ error: "perfil no encontrado" }, 404);
    return c.json({ ok: true });
  });

  /**
   * Paso 1 de la subida: reservar.
   *
   * Se comprueba sesión, propiedad del perfil, tipo, tamaño declarado y cuota
   * ANTES de firmar nada. El orden importa: firmar primero y comprobar después
   * es entregar una autorización que luego hay que retirar.
   */
  profiles.post("/api/media/presign", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = PresignSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "entrada no válida", detail: parsed.error.flatten() }, 400);
    }
    const { profileId, kind, bytes } = parsed.data;

    if (!(await esSuyo(db, c, profileId))) return c.json({ error: "perfil no encontrado" }, 404);
    if (bytes > LIMITE_POR_TIPO[kind]) {
      return c.json({ error: "archivo demasiado grande", limite: LIMITE_POR_TIPO[kind] }, 413);
    }

    try {
      const { mediaId } = await reservarMedio(db, { profileId, kind, declaredBytes: bytes });
      const { url, expiresAt } = await signUploadUrl(config.MEDIA_SIGNING_KEY, mediaId, profileId);
      return c.json({ mediaId, uploadUrl: url, expiresAt }, 201);
    } catch (err) {
      if (err instanceof CuotaExcedidaError) {
        return c.json({ error: "no queda cuota en el perfil" }, 413);
      }
      if (err instanceof DemasiadasReservasError) {
        // 429 y no 413: no es que no quepa, es que hay demasiadas subidas a
        // medias. Se resuelve solo en cuanto terminen o las recoja el reaper.
        return c.json({ error: "demasiadas subidas sin terminar" }, 429);
      }
      if (err instanceof ReservaNoValidaError) {
        return c.json({ error: "reserva no válida" }, 400);
      }
      throw err;
    }
  });

  /**
   * Paso 2: los bytes.
   *
   * La subida y la confirmación son la MISMA petición a propósito. Si fueran
   * dos, entre una y otra habría un objeto en el almacenamiento que nadie ha
   * mirado, y bastaría con no llamar a la segunda para dejarlo ahí. Así el
   * backend ve los bytes, los identifica y los mide antes de que existan como
   * medio servible.
   */
  profiles.put("/api/media/confirm", async (c) => {
    const mediaId = c.req.query("mid") ?? "";
    const profileId = c.req.query("pf") ?? "";
    const exp = Number(c.req.query("exp"));
    const sig = c.req.query("sig") ?? "";

    const firmaOk = await verifyUploadSignature(
      config.MEDIA_SIGNING_KEY,
      mediaId,
      profileId,
      exp,
      sig
    );
    if (!firmaOk) return c.json({ error: "subida no autorizada" }, 403);
    // La firma dice qué se autorizó; la sesión, quién sube. Las dos: una firma
    // filtrada no debe servirle a nadie más.
    if (!(await esSuyo(db, c, profileId))) return c.json({ error: "perfil no encontrado" }, 404);

    // Tope duro antes de nada: el mayor de los límites por tipo. El límite fino
    // del tipo concreto lo aplica `confirmarMedio`, que ya sabe qué se reservó.
    let cuerpo: Uint8Array;
    try {
      cuerpo = await leerCuerpoConTope(c.req.raw, LIMITE_ABSOLUTO);
    } catch (err) {
      if (err instanceof CuerpoDemasiadoGrandeError) {
        return c.json({ error: "archivo demasiado grande" }, 413);
      }
      throw err;
    }

    const resultado = await confirmarMedio(db, storage, { mediaId, profileId, bytes: cuerpo });

    if (!resultado.ok) {
      switch (resultado.motivo) {
        case "tipo":
          return c.json({ error: "el contenido no es del tipo declarado" }, 415);
        case "tamano":
          return c.json({ error: "archivo demasiado grande" }, 413);
        case "cuota":
          return c.json({ error: "no queda cuota en el perfil" }, 413);
        case "reserva":
          return c.json({ error: "reserva no válida" }, 409);
      }
    }

    // Misma forma que los medios del GET del perfil: el panel no tiene que
    // saber de dónde viene cada uno para pintarlo.
    const m = resultado.medio;
    return c.json(
      { id: m.id, kind: m.kind, width: m.width, height: m.height, lqip: m.lqip, bytes: m.bytes },
      201
    );
  });

  /**
   * Vista previa para el panel: los mismos bytes, pero autorizados por sesión en
   * vez de por firma, y buscados por id. La clave de almacenamiento no aparece
   * en ninguna URL, así que no hay ruta que recorrer ni traversal que cortar.
   */
  profiles.get("/api/media/:id", async (c) => {
    const medio = await db.one<{ storage_key: string; mime: string; profile_id: string }>(
      `SELECT m.storage_key, m.mime, m.profile_id
       FROM vistta.media m
       JOIN vistta.profiles p ON p.id = m.profile_id
       WHERE m.id = $1 AND p.owner_id = $2 AND m.status = 'ready'`,
      [c.req.param("id"), c.get("usuario").id]
    );
    if (!medio) return c.json({ error: "no encontrado" }, 404);

    const objeto = await storage.get(medio.storage_key);
    if (!objeto) return c.json({ error: "no encontrado" }, 404);

    return new Response(objeto.bytes, {
      headers: { "Content-Type": medio.mime, "Cache-Control": "no-store" },
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
