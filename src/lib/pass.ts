import type { Db } from "../db";
import { generateToken, hashToken } from "./token";
import { ProfileDataSchema, type ProfileData, type Section } from "../schemas";

export interface PassView {
  passId: string;
  profileId: string;
  displayName: string;
  brandColor: string | null;
  tagline?: string;
  intro?: string;
  sections: Section[];
}

export class ProfileNotFoundError extends Error {}

/** Crea un pase pendiente y devuelve el token en claro (solo se ve aquí). */
export async function createPass(
  db: Db,
  opts: { profileId: string; ttlSeconds?: number }
): Promise<{ id: string; token: string; expiresAt: number }> {
  const profile = await db.one<{ id: string }>(`SELECT id FROM vistta.profiles WHERE id = $1`, [
    opts.profileId,
  ]);
  if (!profile) throw new ProfileNotFoundError(opts.profileId);

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + (opts.ttlSeconds ?? 900) * 1000; // 15 min por defecto para abrir
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO vistta.passes (id, token_hash, profile_id, status, created_at, expires_at)
     VALUES ($1, $2, $3, 'pending', $4, $5)`,
    [id, tokenHash, opts.profileId, now, expiresAt]
  );
  return { id, token, expiresAt };
}

/**
 * Consumo ATÓMICO de un solo uso: el UPDATE condicional es la única puerta.
 *
 * Solo la primera petición válida encuentra la fila en 'pending' y sin caducar,
 * así que solo ella obtiene rowCount = 1. Las demás reciben null, sea porque el
 * pase ya estaba usado, porque caducó o porque no existe: el mismo resultado
 * para los tres casos, para no filtrar cuál era.
 *
 * En PostgreSQL el UPDATE toma un bloqueo de fila y las peticiones simultáneas
 * se serializan sobre ella; la segunda reevalúa el WHERE con la fila ya
 * cambiada y no encuentra nada que actualizar.
 */
export async function consumePass(db: Db, token: string): Promise<PassView | null> {
  const tokenHash = await hashToken(token);
  const now = Date.now();

  const claimed = await db.one<{ id: string; profile_id: string }>(
    `UPDATE vistta.passes SET status = 'consumed', consumed_at = $1
     WHERE token_hash = $2 AND status = 'pending' AND expires_at > $1
     RETURNING id, profile_id`,
    [now, tokenHash]
  );

  if (!claimed) return null; // denegado

  const profile = await db.one<{
    id: string;
    display_name: string;
    brand_color: string | null;
    data: unknown;
  }>(`SELECT id, display_name, brand_color, data FROM vistta.profiles WHERE id = $1`, [
    claimed.profile_id,
  ]);
  if (!profile) return null;

  const data = parseProfileData(profile.data);
  return {
    passId: claimed.id,
    profileId: profile.id,
    displayName: profile.display_name,
    brandColor: profile.brand_color,
    tagline: data.tagline,
    intro: data.intro ?? data.bio,
    sections: normalizeSections(data),
  };
}

/**
 * La columna es JSONB, así que `pg` ya devuelve un objeto. Aun así se valida:
 * lo que hay en la base lo escribió un cliente, y un perfil corrupto no puede
 * tumbar la apertura de un pase (que además ya se ha consumido).
 */
export function parseProfileData(raw: unknown): ProfileData {
  const parsed = ProfileDataSchema.safeParse(raw);
  return parsed.success ? parsed.data : { sections: [] };
}

/** Un perfil guardado con el formato antiguo (bio + media) se ve como uno nuevo. */
function normalizeSections(data: ProfileData): Section[] {
  if (data.sections.length) return data.sections;
  const heredadas: Section[] = [];
  if (data.media?.length) heredadas.push({ type: "galeria", items: data.media });
  return heredadas;
}
