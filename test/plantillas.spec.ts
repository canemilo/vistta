import { describe, expect, it } from "vitest";
import { ProfileDataSchema } from "../src/schemas.js";
import {
  EJEMPLOS,
  PLANTILLAS,
  contenidoDe,
  hayTextoDeEjemplo,
  plantillaPorId,
} from "../web/src/app/panel/plantillas.js";

/**
 * Las plantillas del panel, contra el esquema DE VERDAD.
 *
 * Viven en el frontend y el esquema vive aquí, así que sin esta prueba las dos
 * mitades se separan en silencio: alguien acorta un `max()` en `schemas.ts`, o
 * renombra un tipo de bloque, y la plantilla sigue compilando tan campante
 * porque en TypeScript encaja. Lo que falla es el `PUT` del perfil, en
 * producción, justo después de que un cliente haya creado su primer perfil y
 * escrito dentro. La plantilla es lo primero que ve alguien que empieza: si
 * algo se rompe, que se rompa aquí.
 *
 * La importación cruzada `web/…` es a propósito y es el único sitio donde
 * ocurre. `plantillas.ts` no importa nada de Angular —solo un `import type`,
 * que TypeScript borra—, así que este runner puede leerlo sin arrastrar el
 * framework entero.
 */
describe("las plantillas de partida", () => {
  it("todas validan contra ProfileDataSchema", () => {
    for (const p of PLANTILLAS) {
      const r = ProfileDataSchema.safeParse(p.contenido);
      expect(r.success, `${p.id}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
    }
  });

  it("hay entre 4 y 6, contando la de vacío", () => {
    expect(PLANTILLAS.length).toBeGreaterThanOrEqual(4);
    expect(PLANTILLAS.length).toBeLessThanOrEqual(6);
  });

  it("los identificadores no se repiten", () => {
    expect(new Set(PLANTILLAS.map((p) => p.id)).size).toBe(PLANTILLAS.length);
  });

  /*
   * «Desde cero» la última y vacía. No es cosmética: es la opción de siempre y
   * tiene que seguir estando, pero si vuelve a ser la primera vuelve a ser la
   * que se elige por inercia, que es el problema entero que esto resuelve.
   */
  it("«desde cero» va la última y no trae nada", () => {
    const ultima = PLANTILLAS[PLANTILLAS.length - 1];
    expect(ultima.id).toBe("vacio");
    expect(ultima.contenido.sections).toEqual([]);
    expect(ultima.contenido.intro).toBeUndefined();
  });

  it("todas menos la vacía traen estructura y entradilla", () => {
    for (const p of PLANTILLAS.filter((x) => x.id !== "vacio")) {
      expect(p.contenido.sections.length, p.id).toBeGreaterThan(0);
      expect(p.contenido.intro, p.id).toBeTruthy();
      expect(p.para.length, p.id).toBeGreaterThan(10);
    }
  });

  /*
   * Los textos de ejemplo tienen que PARECER ejemplos. Si alguien los sustituye
   * por prosa verosímil, el dosier que se manda sin tocar deja de delatarse y
   * el cliente recibe un texto inventado sobre su propio inmueble.
   */
  it("los textos de ejemplo se leen como instrucciones", () => {
    for (const texto of Object.values(EJEMPLOS)) {
      expect(texto.startsWith("Describe aquí"), texto).toBe(true);
    }
  });

  it("un id desconocido cae en la vacía en vez de reventar", () => {
    expect(plantillaPorId("no-existe").id).toBe("vacio");
    expect(plantillaPorId("portfolio").id).toBe("portfolio");
  });
});

describe("copiar una plantilla", () => {
  /*
   * PROFUNDA. Con copia superficial, el editor escribe dentro de la constante:
   * el segundo perfil creado en la misma sesión nace con lo que el cliente
   * escribió en el primero. Se rompe a propósito editando la copia y mirando el
   * original, que es la única forma de que esta prueba signifique algo.
   */
  it("la copia no comparte nada con el original", () => {
    const original = plantillaPorId("propiedad");
    const copia = contenidoDe(original);
    const seccion = copia.sections[1];
    if (seccion.type !== "texto") throw new Error("la plantilla cambió de forma");
    seccion.body = "lo que escribió el cliente";
    copia.intro = "su entradilla";

    const segunda = contenidoDe(original);
    const otra = segunda.sections[1];
    if (otra.type !== "texto") throw new Error("la plantilla cambió de forma");
    expect(otra.body).toBe(EJEMPLOS.caracteristicas);
    expect(segunda.intro).toBe(EJEMPLOS.intro);
  });

  it("la copia sigue validando", () => {
    for (const p of PLANTILLAS) {
      expect(ProfileDataSchema.safeParse(contenidoDe(p)).success, p.id).toBe(true);
    }
  });
});

describe("el aviso de relleno sin tocar", () => {
  it("una plantilla recién copiada avisa", () => {
    for (const p of PLANTILLAS.filter((x) => x.id !== "vacio")) {
      expect(hayTextoDeEjemplo(contenidoDe(p)), p.id).toBe(true);
    }
  });

  it("la vacía no avisa: no tiene de qué", () => {
    expect(hayTextoDeEjemplo(contenidoDe(plantillaPorId("vacio")))).toBe(false);
  });

  it("deja de avisar en cuanto se escribe encima de todo", () => {
    const c = contenidoDe(plantillaPorId("propuesta"));
    c.intro = "Presupuesto para la reforma del local de la calle Mayor.";
    for (const s of c.sections) if ("body" in s) s.body = "Lo que sea, escrito por el cliente.";
    expect(hayTextoDeEjemplo(c)).toBe(false);
  });

  /*
   * Y sigue avisando si queda UNO solo. Es lo que separa este aviso de uno
   * inútil: el descuido típico no es mandarlo todo en blanco, es rellenar lo
   * primero y olvidarse del último apartado.
   */
  it("basta con que quede un hueco sin tocar", () => {
    const c = contenidoDe(plantillaPorId("propiedad"));
    c.intro = "Piso en la calle Mayor, exterior, tres dormitorios.";
    const primero = c.sections[1];
    if (primero.type !== "texto") throw new Error("la plantilla cambió de forma");
    primero.body = "90 m², reformado en 2019.";
    expect(hayTextoDeEjemplo(c)).toBe(true);
  });

  /*
   * Los TÍTULOS no cuentan. «Condiciones» es un título correcto que el cliente
   * puede dejar tal cual; avisar por él sería avisar siempre, y un aviso que
   * sale siempre no se lee ninguna vez.
   */
  it("no cuenta un título de plantilla sin tocar", () => {
    const c = contenidoDe(plantillaPorId("catalogo"));
    for (const s of c.sections) if ("body" in s) s.body = "Escrito por el cliente.";
    c.intro = "Colección de 2026.";
    expect(c.sections.some((s) => s.title === "Piezas")).toBe(true);
    expect(hayTextoDeEjemplo(c)).toBe(false);
  });
});
