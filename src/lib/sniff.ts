/**
 * Qué son los bytes DE VERDAD.
 *
 * El `Content-Type` que manda el cliente y la extensión del archivo son texto
 * que escribe quien sube: no dicen nada. Lo único que dice algo son los
 * primeros bytes del fichero, y son los que se miran aquí. Un fichero cuyo
 * contenido no se reconoce no se guarda: servir bytes sin identificar es servir
 * lo que el atacante quiera que el navegador interprete.
 *
 * Nada de SVG a propósito: es XML, admite <script> dentro, y servirlo desde
 * nuestro origen sería un XSS con nuestra CSP.
 */

export type MediaKind = "image" | "video" | "doc";

export interface TipoDetectado {
  kind: MediaKind;
  mime: string;
  /** Extensión que se usa en la clave de almacenamiento. */
  ext: string;
}

/** Tope de bytes REALES por tipo. La cifra declarada no interviene. */
export const LIMITE_POR_TIPO: Readonly<Record<MediaKind, number>> = Object.freeze({
  image: 10 * 1024 * 1024,
  doc: 15 * 1024 * 1024,
  // El plan gratuito de Supabase topa el tamaño de fichero: verificar la cifra
  // exacta del proyecto antes de subirla.
  video: 50 * 1024 * 1024,
});

/** El mayor de los topes: lo que hace falta leer como máximo de una petición. */
export const LIMITE_ABSOLUTO = Math.max(...Object.values(LIMITE_POR_TIPO));

type Firma = { offset: number; bytes: number[]; tipo: TipoDetectado };

const b = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/**
 * Firmas ordenadas de más específica a menos. `null` en un byte es comodín:
 * los contenedores ISO-BMFF (MP4, AVIF) llevan el tamaño de la caja en los
 * cuatro primeros bytes, que varía.
 */
const FIRMAS: Firma[] = [
  {
    offset: 0,
    bytes: [0xff, 0xd8, 0xff],
    tipo: { kind: "image", mime: "image/jpeg", ext: "jpg" },
  },
  {
    offset: 0,
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    tipo: { kind: "image", mime: "image/png", ext: "png" },
  },
  {
    offset: 0,
    bytes: b("GIF87a"),
    tipo: { kind: "image", mime: "image/gif", ext: "gif" },
  },
  {
    offset: 0,
    bytes: b("GIF89a"),
    tipo: { kind: "image", mime: "image/gif", ext: "gif" },
  },
  {
    offset: 4,
    bytes: b("ftypavif"),
    tipo: { kind: "image", mime: "image/avif", ext: "avif" },
  },
  {
    offset: 4,
    bytes: b("ftypmif1"),
    tipo: { kind: "image", mime: "image/avif", ext: "avif" },
  },
  {
    offset: 0,
    bytes: b("%PDF-"),
    tipo: { kind: "doc", mime: "application/pdf", ext: "pdf" },
  },
  {
    offset: 0,
    bytes: [0x1a, 0x45, 0xdf, 0xa3],
    tipo: { kind: "video", mime: "video/webm", ext: "webm" },
  },
];

/** Marcas de MP4/QuickTime: todas empiezan por "ftyp" en el byte 4. */
const MARCAS_MP4 = new Set(["isom", "iso2", "mp41", "mp42", "avc1", "mmp4", "M4V ", "qt  "]);

function empiezaPor(bytes: Uint8Array, firma: Firma): boolean {
  if (bytes.length < firma.offset + firma.bytes.length) return false;
  return firma.bytes.every((v, i) => bytes[firma.offset + i] === v);
}

function texto(bytes: Uint8Array, desde: number, hasta: number): string {
  return String.fromCharCode(...bytes.subarray(desde, hasta));
}

/**
 * Identifica los bytes, o devuelve null si no son nada reconocible.
 *
 * Le bastan los primeros ~32 bytes, así que se puede llamar con la cabecera de
 * un stream antes de haber leído el fichero entero.
 */
export function detectarTipo(bytes: Uint8Array): TipoDetectado | null {
  for (const firma of FIRMAS) {
    if (empiezaPor(bytes, firma)) return firma.tipo;
  }

  // RIFF....WEBP: el tamaño va entre medias, así que no cabe en una firma plana.
  if (bytes.length >= 12 && texto(bytes, 0, 4) === "RIFF" && texto(bytes, 8, 12) === "WEBP") {
    return { kind: "image", mime: "image/webp", ext: "webp" };
  }

  if (bytes.length >= 12 && texto(bytes, 4, 8) === "ftyp" && MARCAS_MP4.has(texto(bytes, 8, 12))) {
    return { kind: "video", mime: "video/mp4", ext: "mp4" };
  }

  return null;
}
