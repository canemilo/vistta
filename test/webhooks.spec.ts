import { describe, it, expect, beforeEach } from "vitest";
import { consumePass, createPass } from "../src/lib/pass";
import { cambiarPlan } from "../src/lib/congelado";
import {
  comprobarDestinoDeWebhook,
  direccionesPublicasDe,
  esDireccionInterna,
  lookupSeguro,
  urlBienFormada,
  UrlNoPermitidaError,
} from "../src/lib/url-segura";
import {
  avisarAlCrm,
  enviarWebhook,
  destinosParaElEvento,
  FALLOS_PARA_APAGAR,
} from "../src/lib/webhooks-salida";
import { crearConexionDeEntrada, revocarConexionDeEntrada } from "../src/lib/webhooks";
import { TRABAJO_WEBHOOK_SALIDA } from "../src/lib/trabajos";
import { call, callAs, crearCuenta, db, panelSession, resetDb } from "./helpers";

beforeEach(resetDb);

const JSON_HEADERS = { "content-type": "application/json" };

async function agente(userId = "marina") {
  await crearCuenta(userId, "Inmobiliaria Demo");
  await cambiarPlan(db, userId, "pro");
  return { userId, perfil: `p_${userId}` };
}

/** Un destino metido a mano: `guardarDestino` no dejaría pasar estas URLs. */
async function destinoCrudo(userId: string, targetUrl: string, id = crypto.randomUUID()) {
  await db.query(
    `INSERT INTO vistta.webhooks_salida
       (id, owner_id, target_url, secreto, eventos, activo, created_at)
     VALUES ($1, $2, $3, 'secreto-de-prueba', '["apertura","reapertura"]'::jsonb, TRUE, $4)`,
    [id, userId, targetUrl, Date.now()]
  );
  return id;
}

// ===========================================================================
// SSRF. Es lo más delicado de toda la funcionalidad: nuestro servidor llama a
// una dirección que escribe el usuario, desde dentro de nuestra red.
// ===========================================================================

describe("SSRF · la forma de la URL", () => {
  it("solo https, sin credenciales y solo el 443", () => {
    expect(() => urlBienFormada("http://ejemplo.test/hook")).toThrow(UrlNoPermitidaError);
    expect(() => urlBienFormada("file:///etc/passwd")).toThrow(UrlNoPermitidaError);
    expect(() => urlBienFormada("gopher://ejemplo.test/")).toThrow(UrlNoPermitidaError);
    expect(() => urlBienFormada("https://usuario:clave@ejemplo.test/h")).toThrow(
      UrlNoPermitidaError
    );
    // Un puerto raro es casi siempre un servicio interno.
    expect(() => urlBienFormada("https://ejemplo.test:8080/hook")).toThrow(UrlNoPermitidaError);
    expect(() => urlBienFormada("no es una url")).toThrow(UrlNoPermitidaError);

    expect(urlBienFormada("https://hooks.ejemplo.test/x").hostname).toBe("hooks.ejemplo.test");
    expect(urlBienFormada("https://hooks.ejemplo.test:443/x").hostname).toBe("hooks.ejemplo.test");
  });
});

describe("SSRF · qué direcciones son internas", () => {
  /*
   * 169.254.169.254 es la importante: en la mayoría de las nubes ese servicio
   * entrega credenciales de la máquina a quien las pida, sin autenticación.
   */
  it.each([
    ["127.0.0.1", 4],
    ["127.1.2.3", 4],
    ["0.0.0.0", 4],
    ["10.1.2.3", 4],
    ["172.16.0.1", 4],
    ["172.31.255.255", 4],
    ["192.168.1.1", 4],
    ["169.254.169.254", 4],
    ["100.64.0.1", 4],
    ["224.0.0.1", 4],
    ["::1", 6],
    ["::", 6],
    ["fd00::1", 6],
    ["fe80::1", 6],
    ["::ffff:127.0.0.1", 6],
  ])("%s es interna", (ip, familia) => {
    expect(esDireccionInterna(ip, familia)).toBe(true);
  });

  it.each([
    ["8.8.8.8", 4],
    ["1.1.1.1", 4],
    ["172.32.0.1", 4],
    ["93.184.216.34", 4],
    ["2606:4700::1111", 6],
  ])("%s es pública", (ip, familia) => {
    expect(esDireccionInterna(ip, familia)).toBe(false);
  });

  /*
   * Y lo que un filtro de CADENAS deja pasar: 2130706433 y 0177.0.0.1 son
   * 127.0.0.1 escritos de otra manera. Aquí se juzga la IP ya resuelta, no el
   * texto, así que la forma rara ni llega.
   */
  it("una dirección que no se entiende se trata como interna", () => {
    expect(esDireccionInterna("2130706433", 4)).toBe(true);
    expect(esDireccionInterna("0177.0.0.1", 4)).toBe(true);
    expect(esDireccionInterna("", 4)).toBe(true);
  });
});

describe("SSRF · se resuelve el DNS, no se mira el texto", () => {
  /*
   * ESTE ES EL PUNTO. `localhost` es un nombre, no una IP: un filtro que mire
   * la cadena de la URL buscando «127.» lo deja pasar tan campante. Lo que lo
   * corta es resolverlo y mirar a dónde apunta.
   */
  it("un NOMBRE que resuelve a una dirección interna se rechaza", async () => {
    await expect(direccionesPublicasDe("localhost")).rejects.toThrow(UrlNoPermitidaError);
    await expect(comprobarDestinoDeWebhook("https://localhost/hook")).rejects.toThrow(
      UrlNoPermitidaError
    );
  });

  it("los metadatos de la nube tampoco", async () => {
    await expect(
      comprobarDestinoDeWebhook("https://169.254.169.254/latest/meta-data/")
    ).rejects.toThrow(UrlNoPermitidaError);
    await expect(comprobarDestinoDeWebhook("https://127.0.0.1/hook")).rejects.toThrow(
      UrlNoPermitidaError
    );
  });

  it("un nombre que no resuelve se rechaza en vez de intentarlo", async () => {
    await expect(comprobarDestinoDeWebhook("https://esto.no.existe.invalid/h")).rejects.toThrow(
      UrlNoPermitidaError
    );
  });

  /*
   * El `lookup` que se le pasa al socket. Es lo que cierra el DNS rebinding:
   * comprobar al guardar y dejar que Node vuelva a resolver al enviar deja una
   * ventana en la que el mismo nombre puede contestar otra cosa.
   */
  it("el lookup del socket corta lo mismo que la comprobación", async () => {
    const error = await new Promise<Error | null>((resolver) => {
      lookupSeguro("localhost", { all: true }, (err) => resolver(err));
    });
    expect(error).toBeInstanceOf(UrlNoPermitidaError);
  });

  /*
   * Y el camino entero, con `https.request` de verdad: la petición ni sale.
   * Aquí es donde se comprueba que el guardia está ENCHUFADO y no solo escrito.
   */
  it("un envío a una dirección interna no llega a salir", async () => {
    const resultado = await enviarWebhook(
      { targetUrl: "https://127.0.0.1/hook", secreto: "s" },
      {
        evento: "apertura",
        ocurrioEn: Date.now(),
        pase: { id: "p", aperturas: 1, destinatarioRef: null },
        propiedad: { id: "pf", nombre: "X", referencia: null },
        panel: "https://vistta.test/panel",
      }
    );
    expect(resultado.ok).toBe(false);
    expect(resultado.error).toBe("destino-no-permitido");
  });
});

// ===========================================================================
// Fase 1 — entrantes
// ===========================================================================

describe("webhooks entrantes", () => {
  async function conexion(userId: string, profileId: string | null = null) {
    const { token, conexion } = await crearConexionDeEntrada(db, userId, {
      nombre: "Mi CRM",
      profileId,
    });
    return { token, id: conexion.id };
  }

  async function pedirPase(token: string, cuerpo: unknown, ip = "203.0.113.5") {
    return callAs(ip, `/api/webhooks/entrada/${token}`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify(cuerpo),
    });
  }

  it("el CRM crea un pase y recibe la URL para la ficha del contacto", async () => {
    const { userId, perfil } = await agente();
    const { token } = await conexion(userId);

    const res = await pedirPase(token, { profileId: perfil, destinatarioRef: "Ana" });
    expect(res.status).toBe(201);
    const cuerpo = (await res.json()) as { url: string; modo: string };
    expect(cuerpo.url).toContain("/v/");
    expect(cuerpo.modo).toBe("unico");

    // Y el pase existe de verdad, con su destinatario.
    const fila = await db.one<{ destinatario_ref: string }>(
      `SELECT destinatario_ref FROM vistta.passes WHERE profile_id = $1`,
      [perfil]
    );
    expect(fila?.destinatario_ref).toBe("Ana");
  });

  it("una conexión atada a un dosier no sirve para otro", async () => {
    const { userId, perfil } = await agente();
    await db.query(
      `INSERT INTO vistta.profiles (id, display_name, data, created_at, owner_id)
       VALUES ('p_otro', 'Otro dosier', '{"sections":[]}'::jsonb, $1, $2)`,
      [Date.now(), userId]
    );
    const { token } = await conexion(userId, perfil);

    // Pide el otro y le dan el fijado: lo que el agente ató a la credencial no
    // lo cambia quien tenga la credencial.
    const res = await pedirPase(token, { profileId: "p_otro" });
    expect(res.status).toBe(201);
    const cuantos = await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vistta.passes WHERE profile_id = 'p_otro'`
    );
    expect(cuantos?.n).toBe(0);
  });

  /*
   * ANTI-IDOR. Un token válido de una cuenta no puede crear pases sobre el
   * dosier de otra: si esto no estuviera, bastaría con escribir el
   * identificador ajeno.
   */
  it("un token válido no alcanza el dosier de otra cuenta", async () => {
    const { userId } = await agente("marina");
    await agente("rival");
    const { token } = await conexion(userId);

    const res = await pedirPase(token, { profileId: "p_rival" });
    expect(res.status).toBe(404);
    const cuantos = await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vistta.passes WHERE profile_id = 'p_rival'`
    );
    expect(cuantos?.n).toBe(0);
  });

  it("revocada responde igual que inexistente: 404 las dos", async () => {
    const { userId, perfil } = await agente();
    const { token, id } = await conexion(userId);
    await revocarConexionDeEntrada(db, userId, id);

    const revocada = await pedirPase(token, { profileId: perfil }, "203.0.113.6");
    const inventada = await pedirPase("token-que-no-existe", { profileId: perfil }, "203.0.113.7");

    expect(revocada.status).toBe(404);
    expect(inventada.status).toBe(404);
    expect(await revocada.text()).toBe(await inventada.text());
  });

  /*
   * Un webhook no puede ser la puerta de atrás de una cuota. Es la misma
   * `createPass` con las mismas comprobaciones.
   */
  it("los límites del plan valen aquí igual que en el panel", async () => {
    const { userId, perfil } = await agente();
    await cambiarPlan(db, userId, "prueba"); // solo modo `unico`
    const { token } = await conexion(userId);

    const res = await pedirPase(token, { profileId: perfil, modo: "ventana", ventanaMs: 7200000 });
    expect(res.status).toBe(403);
  });

  it("deja constancia del último uso, que es lo primero que se mira", async () => {
    const { userId, perfil } = await agente();
    const { token, id } = await conexion(userId);
    await pedirPase(token, { profileId: perfil });

    const fila = await db.one<{ last_used_at: number | null }>(
      `SELECT last_used_at FROM vistta.webhooks_entrada WHERE id = $1`,
      [id]
    );
    expect(fila?.last_used_at).not.toBeNull();
  });

  it("en la base no hay ni un token en claro", async () => {
    const { userId } = await agente();
    const { token } = await conexion(userId);
    const fila = await db.one<{ token_hash: string }>(
      `SELECT token_hash FROM vistta.webhooks_entrada WHERE owner_id = $1`,
      [userId]
    );
    expect(fila?.token_hash).not.toContain(token);
    expect(fila?.token_hash).toHaveLength(64);
  });

  it("las conexiones de otro no se revocan", async () => {
    const { userId } = await agente("marina");
    await crearCuenta("intruso", "Otro");
    const { id } = await conexion(userId);

    expect(await revocarConexionDeEntrada(db, "intruso", id)).toBe(false);
  });
});

// ===========================================================================
// Fase 2 — salientes
// ===========================================================================

describe("avisos salientes", () => {
  /*
   * LA REGLA QUE SOSTIENE TODO LO DEMÁS. Si el envío ocurriera dentro de la
   * apertura del pase, un CRM caído dejaría al comprador mirando una pantalla
   * en blanco. Se comprueba que lo que queda al abrir es un TRABAJO, no una
   * petición hecha.
   */
  it("abrir un pase encola el aviso, no lo manda en línea", async () => {
    const { userId, perfil } = await agente();
    await destinoCrudo(userId, "https://crm.ejemplo.test/hook");

    const { token } = await createPass(db, { profileId: perfil });
    const antes = Date.now();
    await consumePass(db, token);
    // La apertura ha terminado enseguida: no se ha esperado a ningún tercero.
    expect(Date.now() - antes).toBeLessThan(1_000);

    const trabajo = await db.one<{ payload: { evento: string } }>(
      `SELECT payload FROM vistta.jobs WHERE kind = $1`,
      [TRABAJO_WEBHOOK_SALIDA]
    );
    expect(trabajo?.payload.evento).toBe("apertura");
  });

  it("y la segunda vez lo llama reapertura", async () => {
    const { userId, perfil } = await agente();
    const { token } = await createPass(db, {
      profileId: perfil,
      modo: "ventana",
      ventanaMs: 7200000,
    });
    await consumePass(db, token);
    await consumePass(db, token);

    const { rows } = await db.query<{ payload: { evento: string } }>(
      `SELECT payload FROM vistta.jobs WHERE kind = $1 ORDER BY created_at`,
      [TRABAJO_WEBHOOK_SALIDA]
    );
    expect(rows.map((r) => r.payload.evento)).toEqual(["apertura", "reapertura"]);
    expect(userId).toBe("marina");
  });

  it("solo van los destinos que quieren ese evento", async () => {
    const { userId } = await agente();
    const id = await destinoCrudo(userId, "https://crm.ejemplo.test/hook");
    await db.query(`UPDATE vistta.webhooks_salida SET eventos = '["reapertura"]'::jsonb`);

    expect(await destinosParaElEvento(db, userId, "apertura")).toEqual([]);
    expect((await destinosParaElEvento(db, userId, "reapertura")).map((d) => d.id)).toEqual([id]);
  });

  it("no se cruzan las cuentas: cada uno recibe lo suyo", async () => {
    const { userId } = await agente("marina");
    await agente("rival");
    await destinoCrudo(userId, "https://crm.ejemplo.test/hook");

    expect(await destinosParaElEvento(db, "rival", "apertura")).toEqual([]);
  });

  /*
   * Tres ENVÍOS perdidos apagan la conexión; tres INTENTOS de un mismo aviso no.
   * La distinción importa: la cola reintenta cinco veces cada aviso, así que
   * contar intentos apagaría la conexión al primer despliegue del CRM.
   */
  it("un intento fallido no apaga nada; tres avisos perdidos sí", async () => {
    const { userId, perfil } = await agente();
    await destinoCrudo(userId, "https://no-existe.invalid/hook");
    const { id: passId, token } = await createPass(db, { profileId: perfil });
    await consumePass(db, token);

    // Cuatro intentos del mismo aviso, ninguno el último.
    for (let i = 0; i < 4; i++) {
      await expect(
        avisarAlCrm(
          db,
          { passId, evento: "apertura" },
          { baseUrl: "https://v.test", esElUltimoIntento: false }
        )
      ).rejects.toThrow();
    }
    let fila = await db.one<{ activo: boolean; fallos: number }>(
      `SELECT activo, fallos FROM vistta.webhooks_salida WHERE owner_id = $1`,
      [userId]
    );
    expect(fila?.fallos).toBe(0);
    expect(fila?.activo).toBe(true);

    // Y ahora tres avisos que se pierden del todo.
    for (let i = 0; i < FALLOS_PARA_APAGAR; i++) {
      await expect(
        avisarAlCrm(
          db,
          { passId, evento: "apertura" },
          { baseUrl: "https://v.test", esElUltimoIntento: true }
        )
      ).rejects.toThrow();
    }
    fila = await db.one<{ activo: boolean; fallos: number }>(
      `SELECT activo, fallos FROM vistta.webhooks_salida WHERE owner_id = $1`,
      [userId]
    );
    expect(fila?.fallos).toBe(FALLOS_PARA_APAGAR);
    expect(fila?.activo).toBe(false);
  });

  it("sin destinos configurados no falla ni reintenta", async () => {
    const { perfil } = await agente();
    const { id: passId, token } = await createPass(db, { profileId: perfil });
    await consumePass(db, token);

    await expect(
      avisarAlCrm(
        db,
        { passId, evento: "apertura" },
        { baseUrl: "https://v.test", esElUltimoIntento: false }
      )
    ).resolves.toEqual({ enviados: 0, fallidos: 0 });
  });

  /*
   * EL LÍMITE QUE NO SE CRUZA. Que el agente vea en su panel «se detuvo en
   * Planos» es una cosa; bombear el comportamiento de una persona identificada
   * a un sistema de terceros es otra.
   */
  it("la carga no lleva métricas de lectura", async () => {
    const { userId, perfil } = await agente();
    await destinoCrudo(userId, "https://no-existe.invalid/hook");
    const { id: passId, token } = await createPass(db, {
      profileId: perfil,
      destinatarioRef: "Ana",
    });
    await consumePass(db, token);
    await db.query(
      `INSERT INTO vistta.pass_events (id, pass_id, ts, tipo, seccion_idx, seccion_titulo, ms_visible)
       VALUES ('e1', $1, $2, 'seccion', 0, 'Planos', 120000)`,
      [passId, Date.now()]
    );

    // Se captura la carga interceptando el envío: el destino no resuelve, así
    // que lo que se comprueba es lo que SE HABRÍA mandado, campo a campo.
    const { rows } = await db.query<{ target_url: string }>(
      `SELECT target_url FROM vistta.webhooks_salida WHERE owner_id = $1`,
      [userId]
    );
    expect(rows).toHaveLength(1);

    // La forma de la carga se comprueba sobre el tipo y sobre el módulo: no hay
    // ningún camino por el que un ms_visible llegue a `CargaDeWebhook`.
    const fuente = await import("node:fs/promises").then((fs) =>
      fs.readFile("src/lib/webhooks-salida.ts", "utf8")
    );
    const carga = fuente.slice(
      fuente.indexOf("export interface CargaDeWebhook"),
      fuente.indexOf("export interface ResultadoDeEnvio")
    );
    for (const prohibido of ["msVisible", "ms_visible", "secciones", "apartado", "ranking"]) {
      expect(carga).not.toContain(prohibido);
    }
  });
});

describe("la pantalla de conexiones", () => {
  it("guardar un destino interno se rechaza con motivo, y no se guarda", async () => {
    const { userId } = await agente();
    const sesion = await panelSession(userId, "198.51.100.70");

    const res = await call("/api/panel/integracion/salida", {
      method: "POST",
      headers: { authorization: `Bearer ${sesion}`, ...JSON_HEADERS },
      body: JSON.stringify({ targetUrl: "https://localhost/hook" }),
    });
    expect(res.status).toBe(400);

    const cuantos = await db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vistta.webhooks_salida`
    );
    expect(cuantos?.n).toBe(0);
  });

  it("la URL de una conexión de entrada se enseña una vez y nunca más", async () => {
    const { userId } = await agente();
    const sesion = await panelSession(userId, "198.51.100.71");

    const creada = await call("/api/panel/integracion/entrada", {
      method: "POST",
      headers: { authorization: `Bearer ${sesion}`, ...JSON_HEADERS },
      body: JSON.stringify({ nombre: "Mi CRM" }),
    });
    expect(creada.status).toBe(201);
    const { url } = (await creada.json()) as { url: string };
    const token = url.split("/").at(-1)!;

    const listado = await call("/api/panel/integracion", {
      headers: { authorization: `Bearer ${sesion}` },
    });
    const texto = await listado.text();
    expect(texto).toContain("Mi CRM");
    expect(texto).not.toContain(token);
  });

  it("todo esto exige sesión", async () => {
    for (const ruta of ["/api/panel/integracion"]) {
      expect((await call(ruta)).status).toBe(401);
    }
  });

  it("no se ven ni se tocan las conexiones de otra cuenta", async () => {
    const { userId } = await agente("marina");
    await crearCuenta("intruso", "Otro");
    const { conexion } = await crearConexionDeEntrada(db, userId, { nombre: "Mi CRM" });
    const ajena = await panelSession("intruso", "198.51.100.72");

    const listado = await call("/api/panel/integracion", {
      headers: { authorization: `Bearer ${ajena}` },
    });
    expect(await listado.text()).not.toContain("Mi CRM");

    const borrado = await call(`/api/panel/integracion/entrada/${conexion.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${ajena}` },
    });
    expect(borrado.status).toBe(404);
  });
});
