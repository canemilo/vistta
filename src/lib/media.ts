// URLs de medios firmadas y efímeras. La firma ata el medio a UNA visita concreta
// (pass_id) y a una caducidad corta: un enlace filtrado no sirve fuera de esa visita.
import { hmacSha256Hex, timingSafeEqual } from "./crypto";

export const MEDIA_TTL_SECONDS = 300; // 5 min

export interface MediaItem {
  key: string;
  type: "image" | "video" | "doc";
  caption?: string;
}

function payload(key: string, passId: string, exp: number): string {
  return `${key}\n${passId}\n${exp}`;
}

export async function signMediaUrl(
  secret: string,
  item: MediaItem,
  passId: string,
  ttlSeconds = MEDIA_TTL_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSha256Hex(secret, payload(item.key, passId, exp));
  const qs = new URLSearchParams({ pid: passId, exp: String(exp), sig });
  return `/m/${item.key.split("/").map(encodeURIComponent).join("/")}?${qs}`;
}

export async function verifyMediaSignature(
  secret: string,
  key: string,
  passId: string,
  exp: number,
  sig: string
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return false;
  const expected = await hmacSha256Hex(secret, payload(key, passId, exp));
  return timingSafeEqual(sig, expected);
}

/**
 * Texto de marca de agua por visita: identifica el pase y la hora de apertura.
 * Se deja corto a propósito (cabe superpuesto); la fecha completa queda en passes.consumed_at.
 */
export function watermarkFor(passId: string, openedAt = new Date()): string {
  const hora = openedAt.toISOString().slice(11, 16); // HH:MM en UTC
  return `PASE · ${passId.slice(0, 8)} · ${hora}`;
}
