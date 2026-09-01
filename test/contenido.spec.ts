import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import { createPass } from "../src/lib/pass";
import { call, callAs, crearCuenta, panelSession, resetDb, seedProfile } from "./helpers";

beforeEach(resetDb);

const CONTENIDO = {
  tagline: "Fotografía de arquitectura",
  intro: "Trabajo reciente para estudios de arquitectura.",
  sections: [
    { type: "texto", title: "Sobre el encargo", body: "Dos semanas de rodaje en Praga." },
    {
      type: "proyecto",
      title: "Casa Vltava",
      body: "Serie completa.",
      items: [{ key: "u/pro_1/a.jpg", type: "image", caption: "Fachada" }],
    },
    {
      type: "galeria",
      title: "Selección",
      items: [
        { key: "u/pro_1/b.jpg", type: "image" },
        { key: "u/pro_1/c.jpg", type: "image" },
      ],
    },
  ],
};

async function guardar(sesion: string, profileId: string, data: unknown) {
  return callAs("198.51.100.20", `/api/profiles/${profileId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${sesion}` },
    body: JSON.stringify({ data }),
  });
}

describe("contenido del perfil", () => {
  it("el cliente guarda su contenido y el pase lo devuelve en secciones", async () => {
    const userId = await crearCuenta();
    const profileId = await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);

    expect((await guardar(sesion, profileId, CONTENIDO)).status).toBe(200);

    const { token } = await createPass(env, { profileId });
    const res = await callAs("198.51.100.21", "/api/open/" + token);
    const body = await res.json<{
      profile: { tagline: string; intro: string };
      sections: { type: string; title?: string; body?: string; items: { url: string }[] }[];
    }>();

    expect(body.profile.tagline).toBe("Fotografía de arquitectura");
    expect(body.sections.map((s) => s.type)).toEqual(["texto", "proyecto", "galeria"]);
    expect(body.sections[0].items).toHaveLength(0);
    expect(body.sections[1].body).toBe("Serie completa.");
    // Las claves nunca salen en claro: solo URLs firmadas.
    expect(body.sections[2].items).toHaveLength(2);
    for (const item of body.sections[2].items) {
      expect(item.url).toMatch(/^\/m\/u\/pro_1\/.+\?pid=.+&exp=\d+&sig=[0-9a-f]{64}$/);
    }
    expect(JSON.stringify(body)).not.toContain('"key"');
  });

  it("guardar y leer contenido exige autenticación", async () => {
    const profileId = await seedProfile("pro_1", { sections: [] }, await crearCuenta());
    const sinAuth = await call(`/api/profiles/${profileId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: CONTENIDO }),
    });
    expect(sinAuth.status).toBe(401);
    expect((await call(`/api/profiles/${profileId}`)).status).toBe(401);
  });

  it("rechaza un contenido con forma no válida", async () => {
    const userId = await crearCuenta();
    const profileId = await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    const res = await guardar(sesion, profileId, { sections: [{ type: "video", body: "x" }] });
    expect(res.status).toBe(400);
  });

  it("una cuenta no ve ni toca el perfil de otra", async () => {
    await crearCuenta("marina", "Marina");
    await crearCuenta("otro", "Otro");
    const ajeno = await seedProfile("pro_ajeno", { sections: [] }, "marina");
    const sesion = await panelSession("otro");
    const auth = { authorization: `Bearer ${sesion}` };

    // No aparece en su listado...
    const lista = await callAs("198.51.100.30", "/api/profiles", { headers: auth });
    const { profiles } = await lista.json<{ profiles: { id: string }[] }>();
    expect(profiles.map((p) => p.id)).not.toContain(ajeno);

    // ...ni se puede leer ni escribir: 404, no 403, para no confirmar que existe.
    expect(
      (await callAs("198.51.100.31", `/api/profiles/${ajeno}`, { headers: auth })).status
    ).toBe(404);
    expect((await guardar(sesion, ajeno, CONTENIDO)).status).toBe(404);
  });

  it("el panel recupera lo guardado para seguir editando", async () => {
    const userId = await crearCuenta();
    const profileId = await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    await guardar(sesion, profileId, CONTENIDO);

    const res = await callAs("198.51.100.22", `/api/profiles/${profileId}`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    const body = await res.json<{ data: { sections: { type: string }[] } }>();
    expect(body.data.sections).toHaveLength(3);
  });

  it("un perfil con el formato antiguo se sigue viendo como galería", async () => {
    const profileId = await seedProfile("pro_legado", {
      bio: "texto antiguo",
      media: [{ key: "viejo/1.jpg", type: "image" }],
    }, await crearCuenta());
    const { token } = await createPass(env, { profileId });
    const body = await (
      await callAs("198.51.100.23", "/api/open/" + token)
    ).json<{ profile: { intro: string }; sections: { type: string }[] }>();
    expect(body.profile.intro).toBe("texto antiguo");
    expect(body.sections).toEqual([expect.objectContaining({ type: "galeria" })]);
  });
});

describe("subida de fotos", () => {
  async function subir(sesion: string, tipo: string, bytes = "foto") {
    const form = new FormData();
    form.set("file", new File([bytes], "foto.jpg", { type: tipo }));
    form.set("profileId", "pro_1");
    return callAs("198.51.100.24", "/api/media", {
      method: "POST",
      headers: { authorization: `Bearer ${sesion}` },
      body: form,
    });
  }

  it("guarda la foto en R2 y devuelve su clave", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    const res = await subir(sesion, "image/jpeg");
    expect(res.status).toBe(201);
    const { key } = await res.json<{ key: string }>();
    expect(key).toMatch(/^u\/pro_1\/[0-9a-f-]{36}\.jpg$/);
    expect(await (await env.MEDIA.get(key))?.text()).toBe("foto");
  });

  it("rechaza formatos que no son imagen admitida", async () => {
    const userId = await crearCuenta();
    await seedProfile("pro_1", { sections: [] }, userId);
    const sesion = await panelSession(userId);
    expect((await subir(sesion, "image/svg+xml")).status).toBe(415);
    expect((await subir(sesion, "application/pdf")).status).toBe(415);
  });

  it("no se puede subir al perfil de otra cuenta", async () => {
    await crearCuenta("marina", "Marina");
    await crearCuenta("otro", "Otro");
    await seedProfile("pro_1", { sections: [] }, "marina");
    const form = new FormData();
    form.set("file", new File(["x"], "f.jpg", { type: "image/jpeg" }));
    form.set("profileId", "pro_1");
    const res = await callAs("198.51.100.40", "/api/media", {
      method: "POST",
      headers: { authorization: `Bearer ${await panelSession("otro")}` },
      body: form,
    });
    expect(res.status).toBe(404);
  });

  it("subir exige autenticación", async () => {
    const form = new FormData();
    form.set("file", new File(["x"], "f.jpg", { type: "image/jpeg" }));
    form.set("profileId", "pro_1");
    expect((await call("/api/media", { method: "POST", body: form })).status).toBe(401);
  });
});
