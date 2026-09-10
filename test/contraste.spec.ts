import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Los archivos de `web/src/app` que contienen un texto dado. */
function archivosQueDicen(aguja: string, dir = join(process.cwd(), "web/src/app")): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivosQueDicen(aguja, ruta);
    if (!/\.(ts|html|css)$/.test(e.name)) return [];
    return readFileSync(ruta, "utf8").includes(aguja) ? [ruta] : [];
  });
}

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

/*
 * EL MARCO DE COLOR, que no es texto pero tiene que verse.
 *
 * Nació de una queja concreta: en claro, la pantalla se leía plana. Los bordes
 * grises dibujan la estructura pero no jerarquizan —todo lo enmarcado pesa
 * igual—, y con doce tarjetas eso equivale a no enmarcar nada.
 *
 * El listón no es el 4,5 de la AA porque no lleva texto: para elementos no
 * textuales el mínimo es 3, y aquí se exige 2,5 contra las cuatro superficies.
 * Es a propósito más bajo que el de un control: esto es un realce, no el borde
 * que hace legible un campo. Lo que impide es que alguien lo "suavice" hasta
 * dejarlo invisible, que es exactamente el estado del que se venía.
 */
describe.each(["claro", "oscuro"] as const)("el marco de acento: tema %s", (tema) => {
  const tokens = tokensDe(tema);

  it("existe", () => {
    expect(tokens["borde-acento"], "falta --color-borde-acento").toBeTruthy();
  });

  it.each(FONDOS)("se distingue de la superficie %s", (fondo) => {
    expect(contraste(tokens["borde-acento"], tokens[fondo])).toBeGreaterThanOrEqual(2.5);
  });

  /*
   * Y NO se usa como texto. Si alguien lo intentara, el contraste sería el que
   * es —por debajo del 4,5— así que esto deja escrito que el token existe para
   * un borde. La comprobación que lo respalda vive en las plantillas: ninguna
   * escribe `text-borde-acento`.
   */
  it("no aparece como color de texto en ninguna plantilla", () => {
    expect(archivosQueDicen("text-borde-acento")).toEqual([]);
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

/*
 * PASÓ, Y POR ESO ESTO EXISTE.
 *
 * El informe forzaba la paleta clara en `:host`, copiando la regla del
 * documento del pase. Estaba mal copiada: el pase lo abre un TERCERO y su
 * aspecto lo elige quien lo manda; el informe lo mira SU DUEÑO, en su panel.
 * Con el panel en oscuro, entrar a un informe desde Actividad ponía la pantalla
 * en blanco de golpe.
 *
 * Una pantalla del panel no decide el tema de nadie. Lo que sí tiene aspecto
 * propio es el papel, y para eso está `@media print`.
 */
/*
 * EL DOCUMENTO DEL PASE, QUE ES LO QUE VE EL CLIENTE DEL CLIENTE.
 *
 * Estaba fuera de esta prueba, y era el sitio donde menos podía estarlo: la
 * paleta del panel se mide desde que los grises se quedaron en 4,38, y la del
 * documento —el único artefacto que se entrega a alguien de fuera— no la medía
 * nadie. Sus dos temas viven acotados a su propio componente, así que hay que
 * leerlos de ahí.
 */
const DOC = readFileSync(join(process.cwd(), "web/src/app/document/pass-document.ts"), "utf8");

function paletaDelDocumento(tema: "claro" | "oscuro"): Record<string, string> {
  const bloque =
    tema === "oscuro"
      ? DOC.slice(DOC.indexOf(":host {"), DOC.indexOf(":host(.tema-claro)"))
      : DOC.slice(DOC.indexOf(":host(.tema-claro)"));
  return Object.fromEntries(
    [...bloque.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]])
  );
}

describe.each(["claro", "oscuro"] as const)("documento del pase: tema %s", (tema) => {
  const tokens = paletaDelDocumento(tema);
  const superficies = ["fondo", "sup", "sup-2", "sup-3"];

  it.each(["titulo", "texto", "texto-2", "texto-3", "texto-4", "acento"])(
    "«%s» se lee sobre las cuatro superficies (AA: 4.5)",
    (texto) => {
      for (const fondo of superficies) {
        const r = contraste(tokens[texto], tokens[fondo]);
        expect(
          r,
          `--color-${texto} (${tokens[texto]}) sobre --color-${fondo} (${tokens[fondo]}) da ${r.toFixed(2)}`
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  );

  it("mantiene la jerarquía sobre el papel del documento", () => {
    const escalones = ["titulo", "texto", "texto-2", "texto-3", "texto-4"].map((t) =>
      contraste(tokens[t], tokens["fondo"])
    );
    for (let i = 1; i < escalones.length; i++) {
      expect(escalones[i - 1], `el escalón ${i} rompe el orden`).toBeGreaterThanOrEqual(
        escalones[i]
      );
    }
  });
});

/*
 * El tema claro está escrito TRES veces: en `styles.css` (la aplicación), en el
 * documento del pase y en el bloque de impresión del informe. Ninguna de las
 * tres puede heredar de otra —las dos últimas tienen que pisar un tema oscuro
 * ya aplicado—, así que la copia es forzosa. Lo que no es forzoso es que se
 * separen en silencio, que es como se estropean estas cosas: alguien afina la
 * paleta en un sitio y el cliente recibe un documento con la vieja.
 */
describe("las tres copias del tema claro dicen lo mismo", () => {
  const app = tokensDe("claro");
  const compartidos = [
    "fondo",
    "sup",
    "sup-2",
    "sup-3",
    "borde",
    "borde-2",
    "borde-3",
    "titulo",
    "texto",
    "texto-2",
    "texto-3",
    "texto-4",
    "acento",
    "acento-tenue",
  ];

  it("el documento del pase usa la paleta clara de la aplicación", () => {
    const doc = paletaDelDocumento("claro");
    for (const t of compartidos) {
      expect(doc[t], `--color-${t} se ha separado de styles.css`).toBe(app[t]);
    }
  });

  it("el informe imprime con la paleta clara de la aplicación", () => {
    const fuente = readFileSync(join(process.cwd(), "web/src/app/inmobiliaria/informe.ts"), "utf8");
    const alImprimir = fuente.split("@media print")[1] ?? "";
    const tokens = Object.fromEntries(
      [...alImprimir.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [
        m[1],
        m[2],
      ])
    );
    // El fondo no: en papel es blanco, no el suelo gris de la pantalla.
    for (const t of compartidos.filter((x) => x !== "fondo")) {
      expect(tokens[t], `--color-${t} se ha separado de styles.css`).toBe(app[t]);
    }
  });
});

describe("ninguna pantalla del panel se salta el tema del usuario", () => {
  it.each([
    "inmobiliaria/informe.ts",
    "inmobiliaria/actividad.ts",
    "integracion/integracion.ts",
    "core/cabecera-panel.ts",
  ])("%s solo redefine colores para imprimir", (archivo) => {
    const fuente = readFileSync(join(process.cwd(), "web/src/app", archivo), "utf8");
    // Todo lo que va ANTES del bloque de impresión es lo que se ve en pantalla.
    const enPantalla = fuente.split("@media print")[0];
    const forzados = [...enPantalla.matchAll(/--color-[a-z0-9-]+:/g)].map((m) => m[0]);
    expect(forzados, `redefine la paleta en pantalla: ${forzados.join(", ")}`).toEqual([]);
  });

  /*
   * Y el reverso: al imprimir sí hay que forzarla. Sin esto, quien tenga el
   * panel en oscuro se lleva a la reunión una hoja con texto claro sobre papel
   * blanco —los navegadores no pintan los fondos por defecto—, o sea, en blanco.
   */
  it("el informe sí lleva la paleta clara en el bloque de impresión", () => {
    const fuente = readFileSync(join(process.cwd(), "web/src/app/inmobiliaria/informe.ts"), "utf8");
    const alImprimir = fuente.split("@media print")[1] ?? "";
    expect(alImprimir).toContain("color-scheme: light");
    expect(alImprimir).toMatch(/--color-texto:\s*#0d2a35/);
  });
});

/*
 * LAS DOS VOCES, Y QUE NINGUNA SE DESCARGUE.
 *
 * La tipografía de este producto distingue lo que se LEE —serif: la entradilla,
 * el cuerpo de un apartado, el pie de una foto, la prosa de un informe— de la
 * MAQUINARIA —mono: el enlace, el estado del pase, los números—. Las dos pilas
 * son de sistema y no se baja ni un byte de fuente.
 *
 * No es una preferencia estética: la CSP es estricta, y sobre todo el viewer lo
 * abre desde el móvil alguien que no es cliente nuestro, una sola vez. Ese
 * bundle no descarga un archivo de fuente para enseñar seis fotos. Quien meta
 * una tipografía web tendrá que aflojar la CSP o verla fallar en silencio, y lo
 * segundo no se nota hasta que alguien mira el documento y lo ve en Times.
 */
describe("la tipografía no sale a internet", () => {
  const FUENTES = [
    "web/src/styles.css",
    "web/src/app/document/pass-document.ts",
    "web/src/app/inmobiliaria/informe.ts",
    "web/src/app/core/cabecera-panel.ts",
  ];

  it.each(FUENTES)("%s no declara ni pide una fuente externa", (archivo) => {
    const fuente = readFileSync(join(process.cwd(), archivo), "utf8");
    for (const prohibido of ["@font-face", "fonts.googleapis", "fonts.gstatic", ".woff", ".ttf"]) {
      expect(fuente, `${archivo} trae ${prohibido}`).not.toContain(prohibido);
    }
  });

  it("las dos pilas están definidas, y la serif no es la de manual", () => {
    const bloque = CSS.slice(CSS.indexOf("@theme {"), CSS.indexOf("/*\n * Los valores del tema"));
    expect(bloque).toContain("--font-mono:");
    expect(bloque).toContain("--font-serif:");
    // Georgia vale de red, no de primera opción: es la que hace que todos los
    // productos del mundo parezcan el mismo producto.
    const serif = /--font-serif:\s*([^;]+);/.exec(bloque)?.[1] ?? "";
    expect(serif.trim().startsWith("Georgia")).toBe(false);
    expect(serif).toContain("Georgia");
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
    "inmobiliaria/actividad.html",
    "inmobiliaria/informe.html",
    "integracion/integracion.html",
  ])("%s usa tokens, no hexadecimales", (archivo) => {
    const html = readFileSync(join(process.cwd(), "web/src/app", archivo), "utf8");
    const sueltos = [...html.matchAll(/(?:bg|text|border|placeholder|ring)-\[#[0-9a-fA-F]{6}\]/g)];
    expect(sueltos.map((m) => m[0])).toEqual([]);
  });
});

/*
 * PASÓ, Y POR ESO ESTO EXISTE (segunda vez, mismo error, otro sitio).
 *
 * Los estilos de `.documento` —el HTML que sale de los `legal/*.md`— llevaban
 * los valores del tema oscuro escritos a mano: tinta `#b9d2ce`, fondos
 * `#081420`, bordes `#16303a`. Con la aplicación en claro, el texto de los
 * documentos legales salía gris claro sobre papel claro y no se leía. Las
 * pruebas de arriba no lo veían porque solo miden TOKENS, y estos colores no
 * eran tokens: eran hexadecimales sueltos en el único bloque del archivo que
 * nadie estaba mirando.
 *
 * No se mide el contraste aquí —para eso ya están los tokens, y estos son los
 * mismos—: se comprueba que no haya nada que medir aparte.
 */
describe("los documentos legales se pintan con tokens", () => {
  const bloque = CSS.slice(CSS.indexOf(".documento {"), CSS.indexOf(".documento hr {"));

  it("el bloque existe y es el de verdad", () => {
    expect(bloque).toContain("font-family: var(--font-serif)");
    expect(bloque.length).toBeGreaterThan(500);
  });

  it("no queda ni un hexadecimal escrito a mano", () => {
    expect([...bloque.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0])).toEqual([]);
  });
});
