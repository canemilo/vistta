import { describe, it, expect, beforeEach } from "vitest";
import { createPass } from "../src/lib/pass";
import { REFERENCIA_MAXIMA, watermarkFor } from "../src/lib/media";
import { marcarImagen } from "../src/lib/watermark";
import { cambiarPlan } from "../src/lib/congelado";
import { call, crearCuenta, db, panelSession, resetDb } from "./helpers";
import sharp from "sharp";

beforeEach(resetDb);

async function cuentaPro(userId = "marina") {
  await crearCuenta(userId, "Marina");
  await cambiarPlan(db, userId, "pro");
  return { userId, perfilId: `p_${userId}` };
}

describe("el texto de la marca", () => {
  it("sin destinatario, es EXACTAMENTE el de siempre", () => {
    const hora = new Date("2026-09-03T10:15:00.000Z");
    expect(watermarkFor("abcdef1234567890", hora)).toBe("PASE · abcdef12 · 10:15");
    // Y una referencia vacía o en blanco no cuenta como referencia.
    expect(watermarkFor("abcdef1234567890", hora, "")).toBe("PASE · abcdef12 · 10:15");
    expect(watermarkFor("abcdef1234567890", hora, "   ")).toBe("PASE · abcdef12 · 10:15");
  });

  it("con destinatario, va delante del pase y la hora", () => {
    const hora = new Date("2026-09-03T10:15:00.000Z");
    expect(watermarkFor("abcdef1234567890", hora, "ana@example.com")).toBe(
      "ana@example.com · PASE · abcdef12 · 10:15"
    );
  });

  /*
   * El truncado no es validación, es que quepa DIBUJADO. Y se corta con puntos
   * suspensivos a propósito: una dirección cortada en seco parece entera, y
   * quien mire la foto creería que ese es el correo completo.
   */
  it("una referencia larga se trunca, y se nota que está truncada", () => {
    const larga = "departamento.de.compras.internacional@empresa-muy-larga.example.com";
    const texto = watermarkFor("abcdef1234567890", new Date(), larga);
    const ref = texto.split(" · ")[0];
    expect(ref.length).toBe(REFERENCIA_MAXIMA);
    expect(ref.endsWith("…")).toBe(true);
    expect(larga.startsWith(ref.slice(0, -1))).toBe(true);
  });
});

describe("una referencia con caracteres raros no rompe la imagen", () => {
  /*
   * El texto se mete en un SVG que compone Sharp. Sin escapar, un `<` o un `&`
   * dejan un SVG inválido y la marca desaparece —o peor, se cuela contenido en
   * el SVG—. `watermark.ts` escapa; esto lo comprueba de verdad, generando la
   * imagen y mirando que sale marcada.
   */
  const venenosas = [
    "ana<script>alert(1)</script>@example.com",
    "compras & ventas S.L.",
    'la "empresa" de ana',
    "o'donnell@example.com",
    "<>&\"'",
  ];

  for (const ref of venenosas) {
    it(`marca la imagen con ${JSON.stringify(ref.slice(0, 24))}`, async () => {
      const original = await sharp({
        create: { width: 600, height: 400, channels: 3, background: "#000000" },
      })
        .png()
        .toBuffer();

      const marcada = await marcarImagen(
        new Uint8Array(original),
        watermarkFor("abcdef1234567890", new Date(), ref)
      );

      // Que salga una imagen no basta: hay que ver que la marca se ha dibujado.
      // El fondo es negro puro, así que cualquier píxel claro es de la marca.
      const pixeles = await sharp(marcada.bytes).raw().toBuffer();
      let claros = 0;
      for (let i = 0; i < pixeles.length; i += 3) if (pixeles[i] > 120) claros++;
      expect(claros).toBeGreaterThan(0);
    });
  }
});

describe("el destinatario, de punta a punta", () => {
  it("viaja del panel a la marca de agua del pase", async () => {
    const { perfilId } = await cuentaPro();
    const sesion = await panelSession("marina");

    const res = await call("/api/passes", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
      body: JSON.stringify({
        profileId: perfilId,
        destinatarioRef: "ana@example.com",
        destinatarioNota: "piso de la calle mayor",
      }),
    });
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };

    const abierto = await call("/api/open/" + url.split("/v/")[1]);
    const { watermark } = (await abierto.json()) as { watermark: string };
    expect(watermark.startsWith("ana@example.com · PASE · ")).toBe(true);
  });

  it("la nota privada NO se pinta ni sale al que abre el pase", async () => {
    const { perfilId } = await cuentaPro();
    const { token } = await createPass(db, {
      profileId: perfilId,
      destinatarioRef: "ana@example.com",
      destinatarioNota: "regatea mucho",
    });

    const res = await call("/api/open/" + token);
    const cuerpo = await res.text();
    expect(cuerpo).not.toContain("regatea mucho");
  });

  it("el dueño sí ve la referencia y la nota en su listado", async () => {
    const { perfilId } = await cuentaPro();
    const sesion = await panelSession("marina");
    await createPass(db, {
      profileId: perfilId,
      destinatarioRef: "ana@example.com",
      destinatarioNota: "piso de la calle mayor",
    });

    const res = await call(`/api/passes?profileId=${perfilId}`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    const { passes } = (await res.json()) as {
      passes: { destinatarioRef: string | null; destinatarioNota: string | null }[];
    };
    expect(passes[0].destinatarioRef).toBe("ana@example.com");
    expect(passes[0].destinatarioNota).toBe("piso de la calle mayor");
  });

  it("y otro cliente no ve ninguna de las dos cosas", async () => {
    await cuentaPro("marina");
    await createPass(db, { profileId: "p_marina", destinatarioRef: "ana@example.com" });
    await crearCuenta("otro", "Otro");
    const sesion = await panelSession("otro", "203.0.113.90");

    const res = await call("/api/passes?profileId=p_marina", {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("ana@example.com");
  });

  it("se borra con el pase: no queda rastro del tercero", async () => {
    const { perfilId } = await cuentaPro();
    const { id } = await createPass(db, {
      profileId: perfilId,
      destinatarioRef: "ana@example.com",
    });
    await db.query("DELETE FROM vistta.passes WHERE id = $1", [id]);
    const quedan = await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vistta.passes WHERE destinatario_ref = 'ana@example.com'`
    );
    expect(quedan?.n).toBe(0);
  });
});
