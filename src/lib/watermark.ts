import sharp from "sharp";

/**
 * Marca de agua INCRUSTADA EN LOS PÍXELES.
 *
 * Hasta el bloque D esto era un overlay CSS, y un overlay CSS no es una marca de
 * agua: "guardar imagen como" descarga el archivo original, limpio. Aquí la
 * imagen se decodifica, se le pinta encima el identificador de la visita y se
 * vuelve a codificar; lo que sale por el socket ya no son los bytes que subió
 * el cliente, y no hay forma de recuperarlos desde el navegador.
 *
 * Lo que esto NO hace, para que no se venda como lo que no es: no impide una
 * captura de pantalla ni una foto a la pantalla. Lo que hace es que cualquier
 * copia que salga de aquí lleve escrito de qué visita salió.
 */

/** A partir de aquí la imagen se reduce: nadie necesita 8000 px en un viewer. */
export const LADO_MAXIMO = 2400;

/**
 * Tope de píxeles de ENTRADA. Un archivo de 40 kB puede declarar 60.000 ×
 * 60.000 píxeles: al descomprimirlo son gigabytes de memoria. El límite de
 * tamaño en bytes no protege de eso; este sí.
 */
const MAX_PIXELES_ENTRADA = 50_000_000;

export interface ImagenMarcada {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

function escaparXml(texto: string): string {
  return texto.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!
  );
}

/**
 * La capa que se incrusta: el texto repetido en diagonal por toda la imagen, y
 * una banda legible abajo.
 *
 * Van las dos cosas a propósito. La diagonal repetida sobrevive a un recorte; la
 * banda es la que se lee de un vistazo. Y la banda es un rectángulo, no solo
 * texto: si en el servidor faltasen las fuentes (pasa en imágenes de contenedor
 * mínimas, sin fontconfig), el texto saldría vacío y la marca desaparecería sin
 * avisar. Con la banda, al menos algo queda incrustado siempre.
 */
function capaDeMarca(width: number, height: number, texto: string): string {
  const t = escaparXml(texto);
  const cuerpo = Math.max(12, Math.round(width / 34));
  const paso = cuerpo * 16;
  const banda = Math.round(cuerpo * 2.2);

  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="marca" width="${paso}" height="${paso / 2}"
             patternUnits="userSpaceOnUse" patternTransform="rotate(-28)">
      <text x="0" y="${cuerpo}" font-family="sans-serif" font-size="${cuerpo}"
            fill="#ffffff" fill-opacity="0.20">${t}</text>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#marca)"/>
  <rect x="0" y="${height - banda}" width="${width}" height="${banda}"
        fill="#000000" fill-opacity="0.42"/>
  <text x="${Math.round(cuerpo * 0.6)}" y="${height - Math.round(banda * 0.32)}"
        font-family="sans-serif" font-size="${cuerpo}"
        fill="#ffffff" fill-opacity="0.92">${t}</text>
</svg>`;
}

/**
 * Devuelve la imagen con la marca dentro, en WebP.
 *
 * Sale siempre en WebP y siempre reencodificada, aunque la entrada ya fuese
 * WebP: la salida no puede ser nunca una copia byte a byte de la entrada, o la
 * marca sería opcional según el formato que subiera el cliente.
 */
export async function marcarImagen(bytes: Uint8Array, texto: string): Promise<ImagenMarcada> {
  const entrada = sharp(bytes, { limitInputPixels: MAX_PIXELES_ENTRADA });

  // `rotate()` sin argumentos aplica la orientación del EXIF y de paso tira los
  // metadatos: ahí viven el GPS y el número de serie de la cámara, que no tienen
  // por qué viajar al cliente.
  const { data, info } = await entrada
    .rotate()
    .resize({ width: LADO_MAXIMO, height: LADO_MAXIMO, fit: "inside", withoutEnlargement: true })
    .toBuffer({ resolveWithObject: true });

  const salida = await sharp(data)
    .composite([
      { input: Buffer.from(capaDeMarca(info.width, info.height, texto)), top: 0, left: 0 },
    ])
    .webp({ quality: 82 })
    .toBuffer();

  return {
    bytes: new Uint8Array(salida),
    mime: "image/webp",
    width: info.width,
    height: info.height,
  };
}

/** Dimensiones y miniatura de arranque. Las usa el trabajo de derivados. */
export async function derivados(
  bytes: Uint8Array
): Promise<{ width: number; height: number; lqip: string }> {
  const imagen = sharp(bytes, { limitInputPixels: MAX_PIXELES_ENTRADA }).rotate();
  const meta = await imagen.metadata();

  // 16 px de ancho: lo justo para pintar un degradado en el hueco mientras
  // llega la imagen de verdad. Más grande y el data URI engorda la respuesta
  // del pase, que es la petición que el cliente espera mirando la pantalla.
  const mini = await imagen.resize({ width: 16 }).webp({ quality: 40 }).toBuffer();

  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    lqip: `data:image/webp;base64,${mini.toString("base64")}`,
  };
}
