// URLs de medios firmadas y efímeras. La firma de lectura ata el medio a UNA
// visita concreta (pass_id) y a una caducidad corta: un enlace filtrado no sirve
// fuera de esa visita.
import { hmacSha256Hex, timingSafeEqual } from "./crypto";

export const MEDIA_TTL_SECONDS = 300; // 5 min para leer
export const SUBIDA_TTL_SECONDS = 900; // 15 min para subir lo reservado

/**
 * Dominios de firma. Que sean dos y no uno es la corrección de un fallo real:
 * con un solo secreto y un solo formato, una firma emitida para leer podía
 * valer para escribir si los campos coincidían en número y forma. El dominio va
 * dentro del mensaje, así que una firma de lectura nunca verifica como una de
 * escritura aunque el resto del payload sea idéntico.
 */
const LECTURA = "vistta/medio/lectura/v1";
const ESCRITURA = "vistta/medio/escritura/v1";

const utf8 = new TextEncoder();

/**
 * Serializa los campos de forma que UNA cadena venga de UNOS campos y no de
 * otros.
 *
 * El formato anterior era `key\npassId\nexp`, y `key` admitía saltos de línea:
 * una clave "a\nb" producía el mismo mensaje que los campos ("a", "b", …)
 * corridos un puesto, así que una firma legítima valía para otra cosa. Con el
 * prefijo de longitud por campo eso deja de ser posible: el separador ya no
 * significa nada, porque para leer el campo siguiente hay que haber contado los
 * bytes del anterior. La longitud es en BYTES UTF-8, que es lo que se firma.
 */
function payload(dominio: string, campos: readonly string[]): string {
  return [dominio, ...campos].map((c) => `${utf8.encode(c).length}:${c}`).join("|");
}

/** Enlace de lectura de un medio dentro de una visita. */
export async function signMediaUrl(
  secret: string,
  mediaId: string,
  passId: string,
  ttlSeconds = MEDIA_TTL_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSha256Hex(secret, payload(LECTURA, [mediaId, passId, String(exp)]));
  const qs = new URLSearchParams({ pid: passId, exp: String(exp), sig });
  return `/m/${encodeURIComponent(mediaId)}?${qs}`;
}

export async function verifyMediaSignature(
  secret: string,
  mediaId: string,
  passId: string,
  exp: number,
  sig: string
): Promise<boolean> {
  return verificar(secret, LECTURA, [mediaId, passId, String(exp)], exp, sig);
}

/**
 * Enlace de subida de una reserva concreta.
 *
 * Va firmado además de exigir sesión: la sesión dice quién eres, y la firma
 * dice que esta subida es la que se autorizó —este medio, de este perfil, antes
 * de esta hora—. Sin ella, una sesión válida podría reutilizar la reserva de
 * otro momento o de otro perfil suyo.
 */
export async function signUploadUrl(
  secret: string,
  mediaId: string,
  profileId: string,
  ttlSeconds = SUBIDA_TTL_SECONDS
): Promise<{ url: string; expiresAt: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSha256Hex(secret, payload(ESCRITURA, [mediaId, profileId, String(exp)]));
  const qs = new URLSearchParams({ mid: mediaId, pf: profileId, exp: String(exp), sig });
  return { url: `/api/media/confirm?${qs}`, expiresAt: exp * 1000 };
}

export async function verifyUploadSignature(
  secret: string,
  mediaId: string,
  profileId: string,
  exp: number,
  sig: string
): Promise<boolean> {
  return verificar(secret, ESCRITURA, [mediaId, profileId, String(exp)], exp, sig);
}

async function verificar(
  secret: string,
  dominio: string,
  campos: readonly string[],
  exp: number,
  sig: string
): Promise<boolean> {
  if (!Number.isFinite(exp) || exp * 1000 <= Date.now()) return false;
  const esperada = await hmacSha256Hex(secret, payload(dominio, campos));
  return timingSafeEqual(sig, esperada);
}

/**
 * Texto de marca de agua por visita: identifica el pase y la hora de apertura.
 * Se deja corto a propósito (tiene que caber incrustado sobre la imagen); la
 * fecha completa queda en passes.consumed_at.
 */
export function watermarkFor(passId: string, openedAt = new Date()): string {
  const hora = openedAt.toISOString().slice(11, 16); // HH:MM en UTC
  return `PASE · ${passId.slice(0, 8)} · ${hora}`;
}
