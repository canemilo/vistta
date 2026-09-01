#!/usr/bin/env node
// Pone los documentos de `legal/` donde el frontend pueda servirlos.
//
// Se COPIAN en vez de duplicarse: `legal/*.md` es la única versión buena. Si la
// página del panel tuviera su propio texto, los dos se separarían en la primera
// corrección y habría dos avisos legales distintos en vigor a la vez.
//
// Los marcadores (TITULAR_NOMBRE, CONTACTO_LEGAL…) se quedan tal cual y los
// sustituye el navegador con lo que devuelve /api/legal, porque son datos del
// despliegue y no del código.
import { mkdir, copyFile, rm, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const origen = join(raiz, "legal");
const destino = join(raiz, "web", "public", "legal");

/**
 * Los PÚBLICOS, uno a uno y escritos a mano.
 *
 * No se copia la carpeta entera a propósito. `rat.md` (el registro del art. 30)
 * y `eipd.md` (el análisis de riesgos) son INTERNOS: se entregan a la autoridad
 * si los pide, no se publican. Copiar todo lo que acabe en `.md` haría que el
 * próximo documento interno que alguien escriba aquí se publicara solo, sin que
 * nadie tomara esa decisión.
 */
export const PUBLICOS = ["terminos.md", "privacidad.md", "encargado.md", "aup.md"];

/**
 * Los que NO salen de aquí, escritos aparte para poder comprobarlo.
 *
 * `rat.md` es el registro del art. 30 y `eipd.md` el análisis de riesgos: se
 * entregan a la autoridad de control si los pide, no se publican. Hay una
 * prueba (`test/legal.spec.ts`) que falla si alguno aparece en `PUBLICOS`.
 */
export const INTERNOS = ["rat.md", "eipd.md", "README.md"];

export async function publicar() {
  await rm(destino, { recursive: true, force: true });
  await mkdir(destino, { recursive: true });
  for (const doc of PUBLICOS) {
    await access(join(origen, doc)); // si falta, que falle aquí y no en el navegador
    await copyFile(join(origen, doc), join(destino, doc));
  }
  return PUBLICOS;
}

// Solo copia si se ejecuta como script; importarlo desde una prueba no toca nada.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(`Documentos legales publicados: ${(await publicar()).join(", ")}`);
}
