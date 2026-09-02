#!/usr/bin/env node
/**
 * ¿Los PDF de `docs/pdf/` corresponden al Markdown de `docs/`?
 *
 *   pnpm docs:verificar
 *
 * Existe porque los PDF están COMMITEADOS, y un derivado commiteado se queda
 * viejo en silencio: alguien corrige un documento, no regenera, y semanas
 * después envía a un cliente un PDF que ya no dice lo que dice el texto. El
 * fallo no avisa por sí solo, así que hay que hacer que avise.
 *
 * Se compara por HASH del contenido y no por fecha de modificación: git no
 * conserva las fechas, así que recién clonado el repositorio todo parecería
 * desfasado (o al revés, según el orden en que se escriban los archivos).
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirDocs = join(raiz, "docs");
const marca = join(dirDocs, "pdf", ".fuente.sha256");

/** Hash de todo lo que entra en un PDF: el texto y los diagramas que incrusta. */
export async function huellaDeLasFuentes() {
  const hash = createHash("sha256");
  const md = (await readdir(dirDocs)).filter((f) => f.endsWith(".md")).sort();
  for (const f of md) {
    hash.update(f);
    hash.update(await readFile(join(dirDocs, f)));
  }
  const svg = (await readdir(join(dirDocs, "diagramas"))).filter((f) => f.endsWith(".svg")).sort();
  for (const f of svg) {
    hash.update(f);
    hash.update(await readFile(join(dirDocs, "diagramas", f)));
  }
  return hash.digest("hex");
}

export async function anotarHuella() {
  await writeFile(marca, (await huellaDeLasFuentes()) + "\n");
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const actual = await huellaDeLasFuentes();
  const anotada = await readFile(marca, "utf8")
    .then((t) => t.trim())
    .catch(() => null);

  if (anotada === null) {
    console.error("Faltan los PDF o su marca. Genera los documentos:\n  pnpm docs:pdf");
    process.exit(1);
  }
  if (anotada !== actual) {
    console.error(
      "Los PDF de docs/pdf/ NO corresponden al Markdown de docs/.\n" +
        "\n" +
        "Alguien ha cambiado un documento o un diagrama sin regenerarlos. Si se\n" +
        "commitea así, el PDF que se envíe a un cliente dirá algo distinto de lo\n" +
        "que dice el texto revisado. Regenéralos:\n" +
        "  pnpm docs:pdf"
    );
    process.exit(1);
  }
  console.log("Los PDF corresponden al Markdown.");
}
