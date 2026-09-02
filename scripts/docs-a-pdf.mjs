#!/usr/bin/env node
/**
 * Genera los PDF de `docs/` a partir de su Markdown.
 *
 *   pnpm docs:pdf
 *
 * El Markdown es la ÚNICA versión buena: es lo que se revisa, lo que tiene
 * historial y lo que se puede diferenciar en un commit. El PDF es un derivado,
 * como `dist/`. Por eso `docs/pdf/` se regenera entero cada vez y no se edita a
 * mano: un PDF corregido a mano se separa del texto en la primera revisión y
 * acaban circulando dos versiones distintas del mismo documento.
 *
 * Se imprime con el Chrome que ya está instalado en vez de con una librería de
 * PDF: es el mismo motor que renderiza la aplicación, así que los diagramas SVG
 * y la tipografía salen igual que en pantalla, y no añade una dependencia
 * pesada al proyecto.
 */
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { anotarHuella } from "./docs-verificar.mjs";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirDocs = join(raiz, "docs");
const dirPdf = join(dirDocs, "pdf");

/** Rutas habituales de Chrome. Se puede forzar con la variable CHROME. */
const CANDIDATOS = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const chrome = CANDIDATOS.find((c) => existsSync(c));
if (!chrome) {
  console.error(
    "No encuentro Chrome. Instálalo o indícalo:\n  CHROME=/ruta/a/chrome pnpm docs:pdf"
  );
  process.exit(1);
}

/**
 * La hoja de impresión.
 *
 * Medidas en milímetros y no en píxeles: esto se imprime en A4, y un margen en
 * píxeles cambia con la resolución. El cuerpo va en serif porque son documentos
 * para leer seguido; el monoespaciado se reserva para lo que es literal —cifras,
 * rutas, identificadores—, igual que en la aplicación.
 */
const HOJA = `
  @page { size: A4; margin: 20mm 18mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #16232b;
    background: #fff;
    font-family: "Charter", "Georgia", "Times New Roman", serif;
    font-size: 10.5pt;
    line-height: 1.62;
  }
  code, pre, .mono { font-family: "SF Mono", "Menlo", "Consolas", monospace; }

  /* Portada */
  .portada { page-break-after: always; padding-top: 38mm; }
  .portada img { height: 16mm; }
  .portada .titulo {
    margin: 14mm 0 0; font-size: 30pt; line-height: 1.1; font-weight: 600;
    letter-spacing: -0.02em; color: #0b1a24;
  }
  .portada .subtitulo { margin-top: 5mm; font-size: 13pt; color: #4a6470; max-width: 120mm; }
  .portada .meta {
    margin-top: 26mm; border-top: 0.4mm solid #cfd9dd; padding-top: 4mm;
    font-family: "SF Mono", Menlo, monospace; font-size: 8pt; color: #5d7783;
    letter-spacing: 0.06em; text-transform: uppercase;
  }
  .portada .meta span { display: inline-block; margin-right: 10mm; }

  h1, h2, h3, h4 { color: #0b1a24; line-height: 1.25; font-weight: 600; }
  h1 { font-size: 19pt; margin: 0 0 6mm; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { font-size: 13.5pt; margin: 9mm 0 3mm; border-top: 0.3mm solid #dde5e8; padding-top: 4mm; }
  h3 { font-size: 11pt; margin: 6mm 0 2mm; color: #1d4f5c; }
  h4 { font-size: 10pt; margin: 4mm 0 1.5mm; }
  h1, h2, h3, h4 { page-break-after: avoid; }
  p, ul, ol, table, blockquote, figure { page-break-inside: avoid; }
  p { margin: 0 0 3.4mm; }
  ul, ol { margin: 0 0 3.4mm; padding-left: 6mm; }
  li { margin-bottom: 1.2mm; }
  strong { color: #08131a; }
  a { color: #12656f; text-decoration: none; border-bottom: 0.2mm solid #a9cdd2; }

  code {
    font-size: 8.6pt; background: #f2f6f7; border: 0.2mm solid #dde5e8;
    border-radius: 0.8mm; padding: 0.3mm 1mm; color: #17414c;
  }
  pre {
    background: #f7fafa; border: 0.2mm solid #dde5e8; border-left: 1mm solid #12656f;
    border-radius: 1mm; padding: 3mm 4mm; font-size: 8.4pt; line-height: 1.5;
    overflow-x: auto; page-break-inside: avoid;
  }
  pre code { background: none; border: 0; padding: 0; }

  blockquote {
    margin: 4mm 0; padding: 3mm 5mm; background: #f4f9f9;
    border-left: 1mm solid #4aa89a; color: #2a4550;
  }
  blockquote p:last-child { margin-bottom: 0; }

  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin: 0 0 4mm; }
  th, td { border: 0.2mm solid #d5e0e3; padding: 1.8mm 2.4mm; text-align: left; vertical-align: top; }
  th { background: #eef4f5; color: #17414c; font-weight: 600; }

  img { max-width: 100%; }
  figure { margin: 5mm 0; text-align: center; }
  figcaption {
    margin-top: 2mm; font-family: "SF Mono", Menlo, monospace;
    font-size: 7.6pt; color: #5d7783; letter-spacing: 0.04em;
  }
  hr { border: 0; border-top: 0.3mm solid #dde5e8; margin: 7mm 0; }
`;

/** Primer `# Título` y primera línea de texto, para la portada. */
function portadaDe(md, archivo, version, fecha) {
  const titulo = md.match(/^#\s+(.+)$/m)?.[1] ?? basename(archivo, ".md");
  const sub = md.match(/^>\s*\*\*Resumen:\*\*\s*(.+)$/m)?.[1] ?? "";
  return `
  <section class="portada">
    <img src="diagramas/vistta-logo-oscuro.svg" alt="Vistta" />
    <h1 class="titulo" style="page-break-before:avoid">${titulo}</h1>
    ${sub ? `<p class="subtitulo">${sub}</p>` : ""}
    <p class="meta">
      <span>Vistta</span><span>Versión ${version}</span><span>${fecha}</span>
      <span>${basename(archivo)}</span>
    </p>
  </section>`;
}

const version = process.env.DOCS_VERSION ?? "1.0";
const fecha = new Date().toISOString().slice(0, 10);

await mkdir(dirPdf, { recursive: true });
const documentos = (await readdir(dirDocs)).filter((f) => f.endsWith(".md")).sort();

for (const doc of documentos) {
  const md = await readFile(join(dirDocs, doc), "utf8");
  // La portada ya pone el título, así que el `#` de la primera línea sobra.
  const cuerpo = await marked.parse(
    md.replace(/^#\s+.+$/m, "").replace(/^>\s*\*\*Resumen:\*\*.+$/m, "")
  );
  const html =
    `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
    `<title>${basename(doc, ".md")}</title><style>${HOJA}</style></head><body>` +
    portadaDe(md, doc, version, fecha) +
    cuerpo +
    `</body></html>`;

  // El HTML temporal vive DENTRO de docs/ para que `diagramas/x.svg` y el logo
  // resuelvan por ruta relativa, igual que al leer el Markdown en el editor.
  const temporal = join(dirDocs, `.tmp-${basename(doc, ".md")}.html`);
  const salida = join(dirPdf, `${basename(doc, ".md")}.pdf`);
  await writeFile(temporal, html);
  try {
    execFileSync(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-pdf-header-footer",
        "--virtual-time-budget=6000",
        `--print-to-pdf=${salida}`,
        `file://${temporal}`,
      ],
      { stdio: "ignore" }
    );
    console.log(`  ${basename(salida)}`);
  } finally {
    await rm(temporal, { force: true });
  }
}

// La huella deja constancia de CON QUÉ TEXTO se generaron estos PDF, para que
// `pnpm docs:verificar` pueda decir si alguien los ha dejado atrás.
await anotarHuella();

console.log(`\n${documentos.length} documentos en docs/pdf/ (versión ${version}, ${fecha}).`);
