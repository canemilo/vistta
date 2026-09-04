import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * El contraste de la paleta, medido.
 *
 * Existe porque la degradación fue real y silenciosa: los grises tenues del
 * panel se quedaron en **4,38** sobre las superficies —por debajo del 4,5 de la
 * WCAG AA— y nadie podía verlo, porque el color estaba escrito a mano en 36
 * sitios distintos. El texto de los perfiles se leía mal y no había forma de
 * detectarlo salvo mirándolo.
 *
 * Ahora la paleta vive en tokens y esto la comprueba entera, en los dos temas.
 * Si alguien vuelve a bajar un color, esto se pone rojo antes de que llegue a
 * la cara de nadie.
 */

const CSS = readFileSync(join(process.cwd(), "web/src/styles.css"), "utf8");

function canalLineal(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminancia(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * canalLineal(r) + 0.7152 * canalLineal(g) + 0.0722 * canalLineal(b);
}

/** Ratio de contraste de la WCAG, de 1 (nulo) a 21 (negro sobre blanco). */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Los tokens de un tema. El claro es el bloque `@theme`; el oscuro, el que va
 * dentro de `prefers-color-scheme: dark`. Se leen del archivo de verdad: una
 * copia aquí se quedaría vieja, que es exactamente el fallo que esto persigue.
 */
function tokensDe(tema: "claro" | "oscuro"): Record<string, string> {
  if (tema === "claro") {
    // El claro es el bloque `@theme`, con los colores escritos directamente.
    const bloque = CSS.slice(CSS.indexOf("@theme {"), CSS.indexOf("/*\n * Los valores del tema"));
    return Object.fromEntries(
      [...bloque.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
    );
  }

  /*
   * El oscuro va en dos partes: los valores (`--o-*`, escritos una vez) y la
   * asignación (`--color-x: var(--o-y)`, escrita en los dos caminos: la
   * preferencia del sistema y el botón).
   *
   * Se resuelven los alias en vez de leer los `--o-*` a pelo para que esto mida
   * los colores que de verdad se aplican. El mapeo en sí lo vigila la prueba de
   * más abajo, porque un cruce entre dos tokens parecidos puede seguir pasando
   * el contraste y aun así ser un error.
   */
  const valores = Object.fromEntries(
    [...CSS.matchAll(/--o-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
  );
  const asignacion = CSS.slice(CSS.indexOf("[data-theme='dark']"));
  const tokens: Record<string, string> = {};
  for (const [, nombre, alias] of asignacion.matchAll(
    /--color-([a-z0-9-]+):\s*var\(--o-([a-z0-9-]+)\)/g
  )) {
    if (valores[alias]) tokens[nombre] = valores[alias];
  }
  return tokens;
}

const FONDOS = ["fondo", "sup", "sup-2", "sup-3"];
const TEXTOS = ["titulo", "texto", "texto-2", "texto-3", "texto-4", "acento", "peligro", "aviso"];

describe.each(["claro", "oscuro"] as const)("paleta: tema %s", (tema) => {
  const tokens = tokensDe(tema);

  it("define todos los tokens que usan las plantillas", () => {
    for (const t of [...FONDOS, ...TEXTOS, "acento-2", "sobre-acento"]) {
      expect(tokens[t], `falta --color-${t}`).toBeDefined();
    }
  });

  it.each(TEXTOS)("«%s» se lee sobre las cuatro superficies (AA: 4.5)", (texto) => {
    for (const fondo of FONDOS) {
      const r = contraste(tokens[texto], tokens[fondo]);
      expect(
        r,
        `--color-${texto} (${tokens[texto]}) sobre --color-${fondo} (${tokens[fondo]}) da ${r.toFixed(2)}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("el texto de los botones se lee sobre el acento", () => {
    const r = contraste(tokens["sobre-acento"], tokens["acento"]);
    expect(r, `${r.toFixed(2)} sobre el acento`).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * La jerarquía tiene que existir: si el texto de tercer nivel acabara más
   * contrastado que el principal, se arreglaría el contraste rompiendo el
   * diseño, y el ojo iría al sitio equivocado.
   */
  it("mantiene la jerarquía: título ≥ texto ≥ texto-2 ≥ texto-3 ≥ texto-4", () => {
    const escalones = ["titulo", "texto", "texto-2", "texto-3", "texto-4"].map((t) =>
      contraste(tokens[t], tokens["sup"])
    );
    for (let i = 1; i < escalones.length; i++) {
      expect(escalones[i - 1], `el escalón ${i} rompe el orden`).toBeGreaterThanOrEqual(
        escalones[i]
      );
    }
  });
});

describe("la mecánica del tema oscuro", () => {
  /*
   * El oscuro se aplica por dos caminos —la preferencia del sistema y el
   * botón— y los dos repiten la misma lista de asignaciones. Es la única
   * duplicación del archivo, y esto es lo que impide que se separen: cambiar un
   * token en un sitio y olvidarse del otro da un tema a medias que solo aparece
   * por uno de los dos caminos, que es de los fallos más difíciles de ver.
   */
  it("todos los caminos al oscuro asignan exactamente lo mismo", () => {
    const bloques = [...CSS.matchAll(/color-scheme: dark;([\s\S]*?)\n\}/g)].map((m) =>
      [...m[1].matchAll(/--color-([a-z0-9-]+):\s*var\(--o-([a-z0-9-]+)\)/g)]
        .map((a) => `${a[1]}=${a[2]}`)
        .join(",")
    );
    // Tres: la preferencia del sistema, el botón, y la clase de las pantallas
    // que van en oscuro pase lo que pase (entrada al panel y administración).
    expect(bloques.length).toBeGreaterThanOrEqual(3);
    expect(bloques.every((b) => b === bloques[0] && b.length > 0)).toBe(true);
  });

  /*
   * Y que cada token vaya a su homólogo. Un `--color-texto-3: var(--o-texto-4)`
   * puede pasar el contraste tan campante y ser igualmente un error: el texto de
   * tercer nivel se pintaría con el color del cuarto.
   */
  it("cada token oscuro apunta a su homólogo, sin cruces", () => {
    const asignacion = CSS.slice(CSS.indexOf("[data-theme='dark']"));
    const cruces = [...asignacion.matchAll(/--color-([a-z0-9-]+):\s*var\(--o-([a-z0-9-]+)\)/g)]
      .filter((m) => m[1] !== m[2])
      .map((m) => `--color-${m[1]} → --o-${m[2]}`);
    expect(cruces).toEqual([]);
  });
});

describe("las plantillas ya no llevan color escrito a mano", () => {
  it.each([
    "panel/panel.html",
    "admin/admin.html",
    "legal/legal.html",
    "app.html",
    "demo/demo.html",
    "pass-card/pass-card.html",
  ])("%s usa tokens, no hexadecimales", (archivo) => {
    const html = readFileSync(join(process.cwd(), "web/src/app", archivo), "utf8");
    const sueltos = [...html.matchAll(/(?:bg|text|border|placeholder|ring)-\[#[0-9a-fA-F]{6}\]/g)];
    expect(sueltos.map((m) => m[0])).toEqual([]);
  });
});
