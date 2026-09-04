import { describe, it, expect } from "vitest";
import { readdir } from "node:fs/promises";
import { PUBLICOS, INTERNOS } from "../scripts/copiar-legal.mjs";
import { createApp } from "../src/app";
import { configDePruebasCon, db, storage, ORIGIN, call } from "./helpers";
import { PLANES, PLANES_VALIDOS, PRECIOS, type Plan } from "../src/lib/planes";

/**
 * La identidad del titular y el contacto legal.
 *
 * Salen de la configuración y no del texto de los documentos, por la misma
 * razón que el teléfono del Bizum: son datos del negocio, cambian sin que
 * cambie el software y en el despliegue de otro no son los mismos.
 */

const TITULAR = {
  TITULAR_NOMBRE: "Estudio Ejemplo S.L.",
  TITULAR_IDENTIFICACION: "B00000000",
  TITULAR_DIRECCION: "Calle de Ejemplo 1, 28001 Madrid",
  CONTACTO_LEGAL: "legal@ejemplo.test",
};

const appConfigurada = createApp({
  config: configDePruebasCon(TITULAR),
  db,
  storage,
});

const pide = async (app: ReturnType<typeof createApp>): Promise<Response> =>
  app.fetch(new Request(ORIGIN + "/api/legal"));

describe("aviso legal y contacto", () => {
  it("se puede consultar SIN sesión", async () => {
    // Quien tiene que avisar de un contenido suele no ser cliente: la persona
    // que aparece en una foto, o quien recibió el enlace. Exigirle una cuenta
    // convertiría el procedimiento de retirada en un trámite imposible.
    const res = await pide(appConfigurada);
    expect(res.status).toBe(200);
    const cuerpo = (await res.json()) as { contacto: string; completo: boolean };
    expect(cuerpo.contacto).toBe("legal@ejemplo.test");
    expect(cuerpo.completo).toBe(true);
  });

  it("devuelve la identidad completa del titular", async () => {
    const cuerpo = (await pide(appConfigurada).then((r) => r.json())) as {
      titular: { nombre: string; identificacion: string; direccion: string };
      completo: boolean;
    };
    // Un aviso legal sin nombre, identificación y dirección no es un aviso legal.
    expect(cuerpo.titular).toEqual({
      nombre: "Estudio Ejemplo S.L.",
      identificacion: "B00000000",
      direccion: "Calle de Ejemplo 1, 28001 Madrid",
    });
    expect(cuerpo.completo).toBe(true);
  });

  it("sin configurar lo dice, en vez de callarlo", async () => {
    // Enseñar el documento con los marcadores sin sustituir sería peor que no
    // enseñarlo: parecería un texto en vigor.
    const cuerpo = (await call("/api/legal").then((r) => r.json())) as {
      titular: { nombre: null };
      contacto: null;
      completo: boolean;
    };
    expect(cuerpo.completo).toBe(false);
    expect(cuerpo.titular.nombre).toBeNull();
    expect(cuerpo.contacto).toBeNull();
  });

  it("falta uno solo de los cuatro y ya no está completo", async () => {
    for (const quitado of [
      "TITULAR_NOMBRE",
      "TITULAR_IDENTIFICACION",
      "TITULAR_DIRECCION",
      "CONTACTO_LEGAL",
    ] as const) {
      const app = createApp({
        config: configDePruebasCon({ ...TITULAR, [quitado]: undefined }),
        db,
        storage,
      });
      const cuerpo = (await pide(app).then((r) => r.json())) as { completo: boolean };
      expect(cuerpo.completo, `falta ${quitado}`).toBe(false);
    }
  });

  it("no filtra ninguna otra parte de la configuración", async () => {
    // Es una ruta pública: lo que devuelva es público. Que no se cuele nada.
    const texto = await pide(appConfigurada).then((r) => r.text());
    expect(texto).not.toContain("clave-de-firma");
    expect(texto).not.toContain("postgres");
    expect(texto).not.toContain("600000000");
  });
});

describe("qué documentos legales se publican", () => {
  it("el registro del art. 30 y el análisis de riesgos NO se publican", async () => {
    // Se entregan a la autoridad de control si los pide. Publicarlos no es
    // ilegal, pero es una decisión que nadie ha tomado, y el copiador debe
    // exigir que se tome en vez de arrastrarlos por llamarse `.md`.
    for (const interno of INTERNOS) {
      expect(PUBLICOS, `${interno} no puede publicarse`).not.toContain(interno);
    }
  });

  it("cada documento de legal/ está clasificado, sin quedarse a medias", async () => {
    // Un documento nuevo que no esté en ninguna de las dos listas no se publica
    // —el copiador solo copia lo que se le nombra—, pero sí queda sin decidir.
    // Esta prueba obliga a decidirlo.
    const documentos = (await readdir("legal")).filter((f) => f.endsWith(".md"));
    const clasificados = new Set([...PUBLICOS, ...INTERNOS]);
    const sinClasificar = documentos.filter((d) => !clasificados.has(d));
    expect(sinClasificar, "añádelo a PUBLICOS o a INTERNOS en scripts/copiar-legal.mjs").toEqual(
      []
    );
  });
});

describe("los planes, en público", () => {
  /*
   * Sin sesión a propósito: quien mira si esto le sirve todavía no tiene cuenta
   * —ni puede crearla, porque aquí no hay alta pública—. Pedirle que entre para
   * ver los precios sería pedirle que entre donde no puede.
   */
  it("se pueden consultar sin sesión", async () => {
    const res = await call("/api/planes");
    expect(res.status).toBe(200);
    const { planes } = (await res.json()) as { planes: { nombre: string }[] };
    expect(planes.map((p) => p.nombre)).toEqual([...PLANES_VALIDOS]);
  });

  it("las cifras son las de planes.ts, no una copia", async () => {
    const { planes } = (await (await call("/api/planes")).json()) as {
      planes: { nombre: Plan; limites: unknown; precios: unknown }[];
    };
    for (const p of planes) {
      expect(p.limites).toEqual(PLANES[p.nombre]);
      expect(p.precios).toEqual(PRECIOS[p.nombre]);
    }
  });

  it("dice cuál se vende: el de prueba no", async () => {
    const { planes } = (await (await call("/api/planes")).json()) as {
      planes: { nombre: string; seVende: boolean }[];
    };
    expect(planes.find((p) => p.nombre === "prueba")?.seVende).toBe(false);
    expect(planes.find((p) => p.nombre === "pro")?.seVende).toBe(true);
  });

  /*
   * «Ilimitado» y «nunca» viajan como null hasta la portada. Si alguien los
   * tradujera a un número grande para que la página lo pintara más fácil, la
   * página acabaría enseñando ese número como si fuera un tope real.
   */
  it("lo ilimitado sigue siendo null al salir por la API", async () => {
    const { planes } = (await (await call("/api/planes")).json()) as {
      planes: {
        nombre: string;
        limites: { pasesSimultaneos: number | null; retencionMs: number | null };
      }[];
    };
    const boveda = planes.find((p) => p.nombre === "boveda")!;
    expect(boveda.limites.pasesSimultaneos).toBeNull();
    expect(boveda.limites.retencionMs).toBeNull();
  });
});
