#!/usr/bin/env node
/**
 * ¿Puede esta máquina dibujar TEXTO dentro de una imagen?
 *
 * La marca de agua se compone con un SVG que lleva texto. En una imagen de
 * contenedor mínima no hay fuentes ni fontconfig, y entonces librsvg no dibuja
 * el texto: no falla, lo omite. El resultado es una imagen que sale marcada
 * «correctamente» y sin una sola letra encima. El fallo es silencioso y solo se
 * ve mirando una foto servida en producción, que es tardísimo.
 *
 * Por eso esto se ejecuta al CONSTRUIR la imagen: si faltan las fuentes, la
 * construcción se cae y nadie despliega una marca de agua invisible.
 *
 * Comprueba el texto y no la banda opaca a propósito. La banda es un rectángulo
 * y se pinta siempre, con fuentes o sin ellas; es la red de seguridad que deja
 * algo incrustado pase lo que pase. Justamente por eso no sirve para detectar
 * este fallo: mirar la imagen entera daría verde con cero letras.
 */
import sharp from "sharp";

const LADO = 400;
const TEXTO = "VISTTA COMPROBACION DE FUENTES";

/** Un SVG con SOLO texto: sin banda que tape el resultado de la prueba. */
const svg = `<svg width="${LADO}" height="${LADO}" xmlns="http://www.w3.org/2000/svg">
  <text x="10" y="${LADO / 2}" font-family="sans-serif" font-size="34" fill="#ffffff">${TEXTO}</text>
</svg>`;

const fondo = await sharp({
  create: { width: LADO, height: LADO, channels: 3, background: "#000000" },
})
  .png()
  .toBuffer();

const compuesta = await sharp(fondo)
  .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
  .raw()
  .toBuffer();

// El fondo es negro puro: cualquier píxel claro solo puede venir de una letra.
let claros = 0;
for (let i = 0; i < compuesta.length; i += 3) {
  if (compuesta[i] > 128) claros++;
}

if (claros === 0) {
  console.error(
    [
      "FUENTES AUSENTES: el texto del SVG no se ha dibujado.",
      "",
      "La marca de agua saldría sin letras y nadie se enteraría hasta ver una",
      "foto en producción. Instala fontconfig y una familia de fuentes en la",
      "imagen (p. ej. fontconfig + fonts-dejavu-core en Debian).",
    ].join("\n")
  );
  process.exit(1);
}

console.log(`Fuentes disponibles: el texto ha dibujado ${claros} píxeles claros.`);
