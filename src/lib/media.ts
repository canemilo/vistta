// URLs de medios firmadas y efímeras. La firma de lectura ata el medio a UNA
// visita concreta (pass_id) y a una caducidad corta: un enlace filtrado no sirve
// fuera de esa visita.
import { hmacSha256Hex, timingSafeEqual } from "./crypto";

export const MEDIA_TTL_SECONDS = 300; // 5 min para leer
export const SUBIDA_TTL_SECONDS = 900; // 15 min para subir lo reservado
/** Lo que dura una lectura larga. Pasado esto, la telemetría deja de admitirse. */
export const EVENTOS_TTL_SECONDS = 2 * 60 * 60;

/**
 * Dominios de firma. Que sean dos y no uno es la corrección de un fallo real:
 * con un solo secreto y un solo formato, una firma emitida para leer podía
 * valer para escribir si los campos coincidían en número y forma. El dominio va
 * dentro del mensaje, así que una firma de lectura nunca verifica como una de
 * escritura aunque el resto del payload sea idéntico.
 */
const LECTURA = "vistta/medio/lectura/v1";
const ESCRITURA = "vistta/medio/escritura/v1";
/**
 * Tercer dominio: los eventos de lectura.
 *
 * Hace falta uno propio por lo de siempre —una firma de eventos no puede valer
 * como una de lectura de medios— y existe por un motivo que no es de estilo: el
 * pase de un solo uso SE CONSUME al abrirlo, así que exigir «un pase todavía
 * abrible» para aceptar sus eventos dejaría fuera precisamente al modo más
 * común. Este testigo lo emite el servidor AL ABRIR y demuestra justo eso: que
 * este navegador abrió este pase hace poco.
 *
 * Y evita lo otro: reenviar el testigo del pase —que es una credencial— en cada
 * latido de telemetría.
 */
const EVENTOS = "vistta/lectura/eventos/v1";

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

/** Testigo para mandar eventos de ESTA lectura, y de ninguna otra. */
export async function signEventsToken(
  secret: string,
  passId: string,
  ttlSeconds = EVENTOS_TTL_SECONDS
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = await hmacSha256Hex(secret, payload(EVENTOS, [passId, String(exp)]));
  return `${passId}.${exp}.${sig}`;
}

/** Devuelve el pase al que pertenece el testigo, o null si no vale. */
export async function verifyEventsToken(secret: string, testigo: string): Promise<string | null> {
  const partes = testigo.split(".");
  if (partes.length !== 3) return null;
  const [passId, expTexto, sig] = partes;
  const exp = Number(expTexto);
  if (!(await verificar(secret, EVENTOS, [passId, String(exp)], exp, sig))) return null;
  return passId;
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
 * Cuánto de la referencia del destinatario cabe en la marca.
 *
 * No es un tope de validación: es cuánto se puede DIBUJAR. El texto se compone
 * en diagonal por toda la imagen y en una banda abajo; una referencia larga se
 * sale de la banda o se solapa consigo misma, y entonces no se lee ni la
 * referencia ni el pase. Se trunca con puntos suspensivos para que se note que
 * está cortada, en vez de dejar una dirección de correo a medias que parezca
 * entera.
 */
export const REFERENCIA_MAXIMA = 28;

/**
 * Texto de marca de agua por visita: identifica el pase y la hora de apertura,
 * y —si el cliente la escribió— a quién se le enseñó.
 *
 * Se deja corto a propósito (tiene que caber incrustado sobre la imagen); la
 * fecha completa queda en passes.consumed_at.
 *
 * Sin destinatario, el texto es EXACTAMENTE el de siempre. Esa
 * retrocompatibilidad no es cortesía con las llamadas viejas: es que la mayoría
 * de los pases no llevan destinatario y su marca no tiene por qué cambiar.
 *
 * Lo que esto hace y lo que no: NO impide una captura ni una filtración. Hace
 * que una copia que salga de aquí lleve escrito a quién se le enseñó. Es
 * trazabilidad, y disuade; no es un candado.
 */
export function watermarkFor(
  passId: string,
  openedAt = new Date(),
  destinatario?: string | null
): string {
  const hora = openedAt.toISOString().slice(11, 16); // HH:MM en UTC
  const base = `PASE · ${passId.slice(0, 8)} · ${hora}`;

  const ref = destinatario?.trim();
  if (!ref) return base;
  const corta = ref.length > REFERENCIA_MAXIMA ? `${ref.slice(0, REFERENCIA_MAXIMA - 1)}…` : ref;
  return `${corta} · ${base}`;
}
