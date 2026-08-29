import type { Env } from "../env";
import { generateToken, hashToken } from "./token";
import { ProfileDataSchema, type ProfileData } from "../schemas";

export interface PassView {
  passId: string;
  profileId: string;
  displayName: string;
  brandColor: string | null;
  data: ProfileData;
}

export class ProfileNotFoundError extends Error {}

/** Crea un pase pendiente y devuelve el token en claro (solo se ve aquí). */
export async function createPass(
  env: Env,
  opts: { profileId: string; ttlSeconds?: number }
): Promise<{ id: string; token: string; expiresAt: number }> {
  const profile = await env.DB.prepare(`SELECT id FROM profiles WHERE id = ?1`)
    .bind(opts.profileId)
    .first<{ id: string }>();
  if (!profile) throw new ProfileNotFoundError(opts.profileId);

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + (opts.ttlSeconds ?? 900) * 1000; // 15 min por defecto para abrir
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO passes (id, token_hash, profile_id, status, created_at, expires_at)
     VALUES (?1, ?2, ?3, 'pending', ?4, ?5)`
  )
    .bind(id, tokenHash, opts.profileId, now, expiresAt)
    .run();
  return { id, token, expiresAt };
}

/**
 * Consumo ATÓMICO de un solo uso: el UPDATE condicional es la única puerta.
 * Solo el primer acceso válido pasa 'pending' -> 'consumed'; el resto recibe null
 * (usado, caducado o inexistente: mismo resultado, para no filtrar cuál).
 */
export async function consumePass(env: Env, token: string): Promise<PassView | null> {
  const tokenHash = await hashToken(token);
  const now = Date.now();

  const claimed = await env.DB.prepare(
    `UPDATE passes SET status='consumed', consumed_at=?1
     WHERE token_hash=?2 AND status='pending' AND expires_at > ?1
     RETURNING id, profile_id`
  )
    .bind(now, tokenHash)
    .first<{ id: string; profile_id: string }>();

  if (!claimed) return null; // denegado

  const profile = await env.DB.prepare(
    `SELECT id, display_name, brand_color, data FROM profiles WHERE id = ?1`
  )
    .bind(claimed.profile_id)
    .first<{ id: string; display_name: string; brand_color: string | null; data: string }>();
  if (!profile) return null;

  return {
    passId: claimed.id,
    profileId: profile.id,
    displayName: profile.display_name,
    brandColor: profile.brand_color,
    data: parseProfileData(profile.data),
  };
}

function parseProfileData(raw: string): ProfileData {
  try {
    const parsed = ProfileDataSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
