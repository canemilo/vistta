import sharp from "sharp";

/**
 * El logotipo de un cliente, reducido a lo mínimo que se ve bien.
 *
 * Lo que se busca aquí no es «una imagen más pequeña», es que quepa DENTRO de
 * la respuesta del pase sin que se note. Por eso sale como data URI: viaja con
 * el JSON que ya se pide al abrir y no cuesta una petición extra al abrir un
 * enlace desde el móvil, que es el caso que importa.
 *
 * Y por eso NO pasa por `vistta.media`: ahí todo lo que sale lleva la marca de
 * agua de la visita incrustada, y un logotipo marcado no tiene sentido.
 */

/**
 * Lo que se guarda, y está atado a lo que se ENSEÑA.
 *
 * El documento lo pinta hasta 88 px de alto, así que 180 da el doble de
 * resolución: en una pantalla de retina se ve nítido y no pixelado.
 *
 * Medido antes de elegirlo, con un logotipo real: 320x120 pesaba 13,7 kB de
 * data URI; 480x180, 21,6 kB; y 640x240 se iba a 29,6 kB, pegado al tope de
 * 30 kB de salida y al CHECK de 32 kB de la base. 480x180 es el punto donde
 * gana nitidez sin acercarse al techo, y esto viaja DENTRO de la respuesta de
 * cada apertura de pase.
 */
export const LOGO_ANCHO = 480;
export const LOGO_ALTO = 180;

/** Tope de lo que ENTRA. Un logotipo no es una fotografía. */
export const LOGO_ENTRADA_MAXIMA = 4 * 1024 * 1024;

/**
 * Tope de lo que SALE, en caracteres del data URI. Debe caber en el CHECK de la
 * base (32 KB); se deja margen para el prefijo `data:image/webp;base64,`.
 */
export const LOGO_SALIDA_MAXIMA = 30 * 1024;

/** Tope de píxeles de entrada, igual que la marca de agua: un archivo de 40 kB
 * puede declarar 60.000 × 60.000 y al descomprimirlo son gigabytes. */
const MAX_PIXELES_ENTRADA = 50_000_000;

export class LogoNoValidoError extends Error {}

/**
 * Convierte los bytes que sube el cliente en un data URI pequeño.
 *
 * `fit: "inside"` y `withoutEnlargement`: un logotipo no se recorta nunca —le
 * cortaría media palabra— y tampoco se agranda, que solo añadiría peso y
 * borrosidad.
 *
 * La transparencia se conserva: la mayoría de los logotipos vienen en PNG con
 * fondo transparente y aplanarlos contra blanco los rompería en el tema oscuro.
 */
export async function prepararLogo(bytes: Uint8Array): Promise<string> {
  if (bytes.length > LOGO_ENTRADA_MAXIMA) {
    throw new LogoNoValidoError("el archivo es demasiado grande");
  }

  let salida: Buffer;
  try {
    salida = await sharp(bytes, { limitInputPixels: MAX_PIXELES_ENTRADA })
      .rotate()
      .resize({
        width: LOGO_ANCHO,
        height: LOGO_ALTO,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Lo que no se puede decodificar no es una imagen, diga lo que diga su
    // nombre o su Content-Type.
    throw new LogoNoValidoError("no se ha podido leer la imagen");
  }

  let uri = `data:image/webp;base64,${salida.toString("base64")}`;

  /*
   * Si con calidad 82 no cabe —un logotipo fotográfico, o con degradados—, se
   * baja la calidad antes que rendirse. Se prueba en escalones y no en un bucle
   * infinito: si al 40 sigue sin caber, es que eso no es un logotipo.
   */
  for (const calidad of [60, 40]) {
    if (uri.length <= LOGO_SALIDA_MAXIMA) break;
    const reintento = await sharp(salida).webp({ quality: calidad }).toBuffer();
    uri = `data:image/webp;base64,${reintento.toString("base64")}`;
  }

  if (uri.length > LOGO_SALIDA_MAXIMA) {
    throw new LogoNoValidoError("la imagen no se puede reducir lo suficiente");
  }
  return uri;
}
