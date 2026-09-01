import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createPass } from "../src/lib/pass";
import { call, callAs, crearCuenta, resetDb, seedProfile } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await env.MEDIA.put("obras/foto.jpg", "bytes-de-la-foto", {
    httpMetadata: { contentType: "image/jpeg" },
  });
});

async function openPassWithMedia(ip: string) {
  const propietario = await crearCuenta("dueno" + ip.replace(/\./g, ""), "Dueño");
  const profileId = await seedProfile(
    "pro_media",
    {
      intro: "demo",
      sections: [
        {
          type: "galeria",
          title: "Selección",
          items: [{ key: "obras/foto.jpg", type: "image", caption: "Obra 1" }],
        },
      ],
    },
    propietario
  );
  const { token } = await createPass(env, { profileId });
  const res = await callAs(ip, "/api/open/" + token);
  const body = await res.json<{ sections: { items: { url: string; type: string }[] }[] }>();
  return { media: body.sections.flatMap((s) => s.items) };
}

describe("medios firmados", () => {
  it("la apertura devuelve URLs firmadas que sirven el medio", async () => {
    const body = await openPassWithMedia("192.0.2.10");
    expect(body.media).toHaveLength(1);
    expect(body.media[0].url).toMatch(/^\/m\/obras\/foto\.jpg\?/);

    const res = await callAs("192.0.2.10", body.media[0].url);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("bytes-de-la-foto");
  });

  it("una firma manipulada queda denegada", async () => {
    const body = await openPassWithMedia("192.0.2.11");
    const url = new URL(body.media[0].url, "https://vistta.test");
    url.searchParams.set("sig", "0".repeat(64));
    expect((await call(url.pathname + url.search)).status).toBe(403);
  });

  it("una firma caducada queda denegada", async () => {
    const body = await openPassWithMedia("192.0.2.12");
    const url = new URL(body.media[0].url, "https://vistta.test");
    url.searchParams.set("exp", String(Math.floor(Date.now() / 1000) - 10));
    expect((await call(url.pathname + url.search)).status).toBe(403);
  });

  it("sin firma no se sirve nada", async () => {
    expect((await call("/m/obras/foto.jpg")).status).toBe(403);
  });

  it("una firma válida de otra visita no sirve", async () => {
    const first = await openPassWithMedia("192.0.2.13");
    const url = new URL(first.media[0].url, "https://vistta.test");
    url.searchParams.set("pid", crypto.randomUUID());
    expect((await call(url.pathname + url.search)).status).toBe(403);
  });
});
