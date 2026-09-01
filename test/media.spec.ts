import { describe, it, expect, beforeEach } from "vitest";
import sharp from "sharp";
import { createPass } from "../src/lib/pass";
import { signMediaUrl } from "../src/lib/media";
import {
  call,
  callAs,
  crearCuenta,
  db,
  galeriaCon,
  panelSession,
  resetDb,
  seedProfile,
  subirMedio,
} from "./helpers";

beforeEach(resetDb);

/** Perfil con una foto suya, el pase abierto y las URLs firmadas de la visita. */
async function paseConFoto(ip: string, userId = "duena", profileId = "pro_media") {
  await crearCuenta(userId, "Dueña");
  await seedProfile(profileId, { sections: [] }, userId);
  const sesion = await panelSession(userId, ip);
  const { mediaId, bytes } = await subirMedio(sesion, profileId, { ip });

  await callAs(ip, `/api/profiles/${profileId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
    body: JSON.stringify({ data: galeriaCon(mediaId, "Obra 1") }),
  });

  const { token } = await createPass(db, { profileId });
  const res = await callAs(ip, "/api/open/" + token);
  const body = (await res.json()) as { sections: { items: { url: string; type: string }[] }[] };
  return {
    media: body.sections.flatMap((s) => s.items),
    mediaId,
    sesion,
    profileId,
    original: bytes,
  };
}

describe("medios firmados", () => {
  it("la apertura devuelve URLs firmadas que sirven el medio", async () => {
    const { media } = await paseConFoto("192.0.2.10");
    expect(media).toHaveLength(1);
    expect(media[0].url).toMatch(/^\/m\/[0-9a-f-]{36}\?/);

    const res = await callAs("192.0.2.10", media[0].url);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("una firma manipulada queda denegada", async () => {
    const { media } = await paseConFoto("192.0.2.11");
    const url = new URL(media[0].url, "https://vistta.test");
    url.searchParams.set("sig", "0".repeat(64));
    expect((await call(url.pathname + url.search)).status).toBe(403);
  });

  it("una firma caducada queda denegada", async () => {
    const { media } = await paseConFoto("192.0.2.12");
    const url = new URL(media[0].url, "https://vistta.test");
    url.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 10));
    expect((await call(url.pathname + url.search)).status).toBe(403);
  });

  it("sin firma no se sirve nada", async () => {
    const { mediaId } = await paseConFoto("192.0.2.14");
    expect((await call(`/m/${mediaId}`)).status).toBe(403);
  });

  it("una firma válida de otra visita no sirve", async () => {
    const { media } = await paseConFoto("192.0.2.13");
    const url = new URL(media[0].url, "https://vistta.test");
    url.searchParams.set("pid", crypto.randomUUID());
    expect((await call(url.pathname + url.search)).status).toBe(403);
  });
});

describe("aislamiento entre inquilinos (fallo 4 del HANDOFF)", () => {
  it("un perfil no puede referenciar el medio de otra cuenta", async () => {
    // Cuenta A sube una foto suya.
    await crearCuenta("marina", "Marina");
    await seedProfile("pro_a", { sections: [] }, "marina");
    const sesionA = await panelSession("marina", "192.0.2.20");
    const { mediaId: ajeno } = await subirMedio(sesionA, "pro_a", { ip: "192.0.2.20" });

    // Cuenta B intenta meter ese id en SU perfil.
    await crearCuenta("otro", "Otro");
    await seedProfile("pro_b", { sections: [] }, "otro");
    const sesionB = await panelSession("otro", "192.0.2.21");
    const res = await callAs("192.0.2.22", "/api/profiles/pro_b", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesionB}` },
      body: JSON.stringify({ data: galeriaCon(ajeno) }),
    });

    // Antes esto se guardaba y la apertura del pase firmaba la URL del medio ajeno.
    expect(res.status).toBe(400);
    const fila = await db.one<{ data: { sections: unknown[] } }>(
      `SELECT data FROM vistta.profiles WHERE id = 'pro_b'`
    );
    expect(fila?.data.sections).toEqual([]);
  });

  it("ni siquiera con una firma auténtica se sirve un medio fuera del pase", async () => {
    await crearCuenta("marina", "Marina");
    await seedProfile("pro_a", { sections: [] }, "marina");
    const sesionA = await panelSession("marina", "192.0.2.30");
    const { mediaId: ajeno } = await subirMedio(sesionA, "pro_a", { ip: "192.0.2.30" });

    // Un pase de OTRO perfil, con su propia foto.
    const { media } = await paseConFoto("192.0.2.31", "otra", "pro_b");
    const passId = new URL(media[0].url, "https://vistta.test").searchParams.get("pid")!;

    // Firma emitida por nosotros mismos, con la clave real, para el medio ajeno.
    const firmada = await signMediaUrl(
      "clave-de-firma-de-pruebas-con-longitud-suficiente",
      ajeno,
      passId
    );
    // La firma es válida; la instantánea del pase es la que dice que no.
    expect((await call(firmada)).status).toBe(403);
  });

  it("la vista previa del panel no sirve el medio de otra cuenta", async () => {
    await crearCuenta("marina", "Marina");
    await seedProfile("pro_a", { sections: [] }, "marina");
    const sesionA = await panelSession("marina", "192.0.2.40");
    const { mediaId } = await subirMedio(sesionA, "pro_a", { ip: "192.0.2.40" });

    await crearCuenta("otro", "Otro");
    const sesionB = await panelSession("otro", "192.0.2.41");
    const res = await callAs("192.0.2.42", `/api/media/${mediaId}`, {
      headers: { authorization: `Bearer ${sesionB}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("marca de agua incrustada (fallo 6 del HANDOFF)", () => {
  it("lo que se sirve NO son los bytes originales", async () => {
    const { media, original } = await paseConFoto("192.0.2.50");
    const res = await callAs("192.0.2.50", media[0].url);
    const servido = new Uint8Array(await res.arrayBuffer());

    // Antes esto era un overlay CSS y "guardar imagen como" bajaba el original.
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(servido).not.toEqual(original);
  });

  it("los píxeles servidos difieren de la misma imagen sin marcar", async () => {
    const { media, original } = await paseConFoto("192.0.2.51");
    const res = await callAs("192.0.2.51", media[0].url);
    const servido = Buffer.from(await res.arrayBuffer());

    // Reencodificar sin marcar da otra imagen: si los píxeles coincidieran,
    // la marca no se habría llegado a pintar (por ejemplo, por falta de fuentes).
    const sinMarcar = await sharp(original).webp({ quality: 82 }).toBuffer();
    const a = await sharp(servido).raw().toBuffer();
    const b = await sharp(sinMarcar).raw().toBuffer();
    expect(a.equals(b)).toBe(false);
  });

  it("cada visita lleva su propia marca", async () => {
    const primera = await paseConFoto("192.0.2.52", "una", "pro_una");
    const segunda = await paseConFoto("192.0.2.53", "dos", "pro_dos");

    const bytesA = Buffer.from(
      await (await callAs("192.0.2.52", primera.media[0].url)).arrayBuffer()
    );
    const bytesB = Buffer.from(
      await (await callAs("192.0.2.53", segunda.media[0].url)).arrayBuffer()
    );
    // Misma foto de partida, distinto pase: los píxeles no pueden coincidir.
    expect(bytesA.equals(bytesB)).toBe(false);
  });

  it("un documento se sirve tal cual: no lleva marca, y no se finge que la lleve", async () => {
    await crearCuenta("marina", "Marina");
    await seedProfile("pro_doc", { sections: [] }, "marina");
    const sesion = await panelSession("marina", "192.0.2.60");
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
    const { mediaId } = await subirMedio(sesion, "pro_doc", {
      kind: "doc",
      bytes: pdf,
      ip: "192.0.2.60",
    });
    await callAs("192.0.2.60", "/api/profiles/pro_doc", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
      body: JSON.stringify({ data: galeriaCon(mediaId) }),
    });

    const { token } = await createPass(db, { profileId: "pro_doc" });
    const abierto = (await (await callAs("192.0.2.61", "/api/open/" + token)).json()) as {
      sections: { items: { url: string; type: string }[] }[];
    };
    const item = abierto.sections[0].items[0];
    expect(item.type).toBe("doc");

    const res = await callAs("192.0.2.61", item.url);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(pdf);
  });
});

describe("firma sin ambigüedad de campos (fallo 5 del HANDOFF)", () => {
  it("mover el corte entre campos no produce la misma firma", async () => {
    const secret = "clave-de-firma-de-pruebas-con-longitud-suficiente";
    const sig = async (mediaId: string, passId: string) =>
      new URL(
        await signMediaUrl(secret, mediaId, passId, 300),
        "https://vistta.test"
      ).searchParams.get("sig");

    // El formato viejo concatenaba con "\n" sin delimitar, así que los campos
    // ("a\nb", "c") y ("a", "b\nc") producían EL MISMO mensaje: una firma
    // legítima para un medio valía para otro. Con el prefijo de longitud por
    // campo, el separador deja de significar nada y la colisión desaparece.
    expect(await sig("a\nb", "c")).not.toBe(await sig("a", "b\nc"));
  });

  it("una firma de lectura no vale para subir", async () => {
    const { verifyUploadSignature } = await import("../src/lib/media");
    const secret = "clave-de-firma-de-pruebas-con-longitud-suficiente";
    const url = await signMediaUrl(secret, "m1", "p1", 300);
    const qs = new URL(url, "https://vistta.test").searchParams;

    // Mismos tres campos, mismo secreto: lo único que las separa es el dominio.
    const vale = await verifyUploadSignature(
      secret,
      "m1",
      "p1",
      Number(qs.get("exp")),
      qs.get("sig")!
    );
    expect(vale).toBe(false);
  });
});
