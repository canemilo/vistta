import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import {
  prepararLogo,
  LogoNoValidoError,
  LOGO_SALIDA_MAXIMA,
  LOGO_ANCHO,
  LOGO_ALTO,
} from "../src/lib/logo";
import { call, crearCuenta, db, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

/** Un logotipo plausible: texto y una forma, con fondo transparente. */
async function logoPng(ancho = 900, alto = 300): Promise<Buffer> {
  const svg = `<svg width="${ancho}" height="${alto}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${alto / 2}" cy="${alto / 2}" r="${alto / 3}" fill="#34d399"/>
    <text x="${alto}" y="${alto / 1.7}" font-family="sans-serif" font-size="${alto / 3}"
          fill="#0f2c37">Estudio</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("el logotipo se reduce a lo mínimo", () => {
  it("un PNG grande sale muy por debajo del tope", async () => {
    const entrada = await logoPng(1600, 600);
    const uri = await prepararLogo(new Uint8Array(entrada));

    expect(uri.startsWith("data:image/webp;base64,")).toBe(true);
    expect(uri.length).toBeLessThan(LOGO_SALIDA_MAXIMA);
    /*
     * Y el tope que de verdad importa: que sea PEQUEÑO en absoluto, no que sea
     * más pequeño que lo que subieron. Esto viaja dentro de la respuesta que se
     * pide al abrir un pase, muchas veces desde el móvil y con datos: 12 kB es
     * un logotipo; 300 kB es una foto disfrazada. Medido: un PNG de 1600x600
     * sale en unos 7 kB.
     */
    expect(uri.length).toBeLessThan(12 * 1024);
    expect(uri.length).toBeLessThan(entrada.length);
  });

  it("no se agranda un logotipo pequeño ni se recorta uno ancho", async () => {
    const bytes = Buffer.from(
      (await prepararLogo(new Uint8Array(await logoPng(1600, 200)))).split(",")[1],
      "base64"
    );
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBeLessThanOrEqual(LOGO_ANCHO);
    expect(meta.height).toBeLessThanOrEqual(LOGO_ALTO);
    // 1600x200 es 8:1; si se hubiera recortado, la proporción cambiaría.
    expect(meta.width! / meta.height!).toBeCloseTo(8, 0);
  });

  it("conserva la transparencia: aplanarla rompería el tema oscuro", async () => {
    const uri = await prepararLogo(new Uint8Array(await logoPng()));
    const meta = await sharp(Buffer.from(uri.split(",")[1], "base64")).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it("lo que no es una imagen se rechaza", async () => {
    await expect(
      prepararLogo(new Uint8Array(Buffer.from("esto no es un png")))
    ).rejects.toBeInstanceOf(LogoNoValidoError);
  });

  /*
   * Una imagen de 40 kB puede declarar 60.000 x 60.000 píxeles: al
   * descomprimirla son gigabytes. El tope de bytes no protege de eso.
   */
  it("una bomba de descompresión no pasa", async () => {
    const bomba = await sharp({
      create: { width: 9000, height: 9000, channels: 3, background: "#ffffff" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    // Cabe de sobra en bytes, pero son 81 millones de píxeles.
    expect(bomba.length).toBeLessThan(1024 * 1024);
    await expect(prepararLogo(new Uint8Array(bomba))).rejects.toBeInstanceOf(LogoNoValidoError);
  });
});

describe("la ruta del logotipo", () => {
  async function sesionYPerfil() {
    await crearCuenta("marina", "Marina");
    return { sesion: await panelSession("marina"), perfilId: "p_marina" };
  }

  it("lo guarda, lo devuelve con el perfil y se puede quitar", async () => {
    const { sesion, perfilId } = await sesionYPerfil();
    const png = await logoPng();

    const subida = await call(`/api/profiles/${perfilId}/logo`, {
      method: "PUT",
      headers: { authorization: `Bearer ${sesion}`, "content-type": "image/png" },
      body: png,
    });
    expect(subida.status).toBe(200);
    const { logo } = (await subida.json()) as { logo: string };
    expect(logo.startsWith("data:image/webp;base64,")).toBe(true);

    const perfil = await call(`/api/profiles/${perfilId}`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(((await perfil.json()) as { logo: string }).logo).toBe(logo);

    const quitado = await call(`/api/profiles/${perfilId}/logo`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(quitado.status).toBe(200);
    const fila = await db.one<{ logo: string | null }>(
      "SELECT logo FROM vistta.profiles WHERE id = $1",
      [perfilId]
    );
    expect(fila?.logo).toBeNull();
  });

  it("viaja con el pase, para que el documento lo pinte", async () => {
    const { sesion, perfilId } = await sesionYPerfil();
    await call(`/api/profiles/${perfilId}/logo`, {
      method: "PUT",
      headers: { authorization: `Bearer ${sesion}`, "content-type": "image/png" },
      body: await logoPng(),
    });

    const { createPass } = await import("../src/lib/pass");
    const { token } = await createPass(db, { profileId: perfilId });
    const abierto = (await (await call("/api/open/" + token)).json()) as {
      profile: { logo: string | null };
    };
    expect(abierto.profile.logo?.startsWith("data:image/webp;base64,")).toBe(true);
  });

  it("no se puede poner el logotipo en el perfil de otro", async () => {
    await sesionYPerfil();
    await crearCuenta("otro", "Otro");
    const ajena = await panelSession("otro", "203.0.113.66");
    const res = await call("/api/profiles/p_marina/logo", {
      method: "PUT",
      headers: { authorization: `Bearer ${ajena}`, "content-type": "image/png" },
      body: await logoPng(),
    });
    expect(res.status).toBe(404);
  });

  it("sin sesión, nada", async () => {
    const { perfilId } = await sesionYPerfil();
    const res = await call(`/api/profiles/${perfilId}/logo`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: await logoPng(),
    });
    expect(res.status).toBe(401);
  });
});
