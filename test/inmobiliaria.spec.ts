import { describe, it, expect, beforeEach } from "vitest";
import { createPass, consumePass } from "../src/lib/pass";
import { derivadosDeLectura, registrarEventos } from "../src/lib/eventos";
import { generarInforme, MINIMO_PARA_PORCENTAJES } from "../src/lib/informe";
import { termometroDeLaCuenta } from "../src/lib/termometro";
import { comparativaDeLaCuenta, APERTURA_BAJA_PCT } from "../src/lib/comparativa";
import { avisosPendientes, configurarAvisos, marcarVisto, registrarAviso } from "../src/lib/avisos";
import { guardarFichaDePropiedad } from "../src/lib/propiedad";
import { cambiarPlan } from "../src/lib/congelado";
import { procesarUno } from "../src/worker";
import {
  DEPS_DEL_TRABAJADOR,
  call,
  calentarPool,
  crearCuenta,
  db,
  panelSession,
  resetDb,
} from "./helpers";

beforeEach(resetDb);

const DIA = 86_400_000;
const JSON_HEADERS = { "content-type": "application/json" };

/** Un dosier de inmueble con los apartados que se citan en el encargo. */
const APARTADOS = ["Fotos", "Planos", "Precio"];

async function agente(userId = "marina", perfil = `p_${userId}`) {
  await crearCuenta(userId, "Inmobiliaria Demo");
  await cambiarPlan(db, userId, "pro");
  await db.query(`UPDATE vistta.profiles SET data = $2::jsonb WHERE id = $1`, [
    perfil,
    JSON.stringify({ sections: APARTADOS.map((title) => ({ type: "texto", title, body: "…" })) }),
  ]);
  return { userId, perfil };
}

/** Un segundo perfil para la misma cuenta (Pro da tres). */
async function otroPerfil(userId: string, id: string, nombre: string) {
  await db.query(
    `INSERT INTO vistta.profiles (id, display_name, brand_color, data, created_at, owner_id)
     VALUES ($1, $2, NULL, $3::jsonb, $4, $5)`,
    [id, nombre, JSON.stringify({ sections: [] }), Date.now(), userId]
  );
  return id;
}

/**
 * Manda un enlace y, si se pide, lo abre. Devuelve el id del pase.
 *
 * `hace` envejece el envío: es la forma de montar un periodo sin esperar días.
 */
async function enviar(
  perfil: string,
  opciones: {
    abrir?: boolean;
    hace?: number;
    /** Cuánto tardó en abrirse desde el envío. Sin esto, se abre al instante. */
    tardo?: number;
    destinatario?: string;
    modo?: "unico" | "ventana";
  } = {}
): Promise<{ id: string; token: string }> {
  const { id, token } = await createPass(db, {
    profileId: perfil,
    modo: opciones.modo ?? "unico",
    ...(opciones.modo === "ventana" ? { ventanaMs: 2 * DIA } : {}),
    destinatarioRef: opciones.destinatario,
  });
  if (opciones.abrir) await consumePass(db, token);
  if (opciones.hace) {
    await db.query(
      `UPDATE vistta.passes
       SET created_at = created_at - $2,
           primera_apertura_at = CASE WHEN primera_apertura_at IS NULL THEN NULL
                                      ELSE primera_apertura_at - $2 END
       WHERE id = $1`,
      [id, opciones.hace]
    );
  }
  if (opciones.tardo !== undefined) {
    await db.query(`UPDATE vistta.passes SET primera_apertura_at = created_at + $2 WHERE id = $1`, [
      id,
      opciones.tardo,
    ]);
  }
  return { id, token };
}

describe("Fase 0 · derivados de una lectura", () => {
  it("responde a las tres preguntas: si se abrió, qué se miró y si llegó al final", async () => {
    const { perfil } = await agente();
    const { id, token } = await createPass(db, { profileId: perfil });
    // Envejece el envío para que «tardó en abrirlo» tenga algo que medir.
    await db.query(`UPDATE vistta.passes SET created_at = created_at - $2 WHERE id = $1`, [
      id,
      3_600_000,
    ]);
    await consumePass(db, token);

    await registrarEventos(db, id, [
      { tipo: "apertura" },
      { tipo: "seccion", seccionIdx: 0, msVisible: 20_000 },
      { tipo: "seccion", seccionIdx: 1, msVisible: 90_000 },
      { tipo: "final" },
    ]);

    const d = (await derivadosDeLectura(db, id))!;
    expect(d.abierto).toBe(true);
    expect(d.aperturas).toBe(1);
    // Una hora, más lo poco que tarde la prueba en llegar hasta aquí.
    expect(d.msHastaPrimeraApertura).toBeGreaterThanOrEqual(3_600_000);
    expect(d.llegoAlFinal).toBe(true);
    expect(d.msTotales).toBe(110_000);
    // Ordenado por atención: Planos por delante de Fotos.
    expect(d.ranking.map((r) => r.titulo)).toEqual(["Planos", "Fotos"]);
    // Y lo que nadie miró, que es lo más accionable del informe.
    expect(d.saltados).toEqual([{ seccionIdx: 2, titulo: "Precio" }]);
  });

  /*
   * ESTE ES EL PUNTO. El navegador manda un índice; el título lo pone el
   * servidor leyéndolo del dosier. Si viniera de fuera, un cliente manipulado
   * escribiría el texto que acaba impreso en el informe que el agente le
   * entrega al propietario, con su marca encima.
   */
  it("el título del apartado lo pone el servidor, no el navegador", async () => {
    const { perfil } = await agente();
    const { id } = await createPass(db, { profileId: perfil });
    await registrarEventos(db, id, [{ tipo: "seccion", seccionIdx: 1, msVisible: 1_000 }]);

    const fila = await db.one<{ seccion_titulo: string }>(
      `SELECT seccion_titulo FROM vistta.pass_events WHERE pass_id = $1`,
      [id]
    );
    expect(fila?.seccion_titulo).toBe("Planos");
  });

  it("un pase sin abrir lo dice, y no inventa un cero de lectura", async () => {
    const { perfil } = await agente();
    const { id } = await createPass(db, { profileId: perfil });

    const d = (await derivadosDeLectura(db, id))!;
    expect(d.abierto).toBe(false);
    expect(d.hayLectura).toBe(false);
    expect(d.msHastaPrimeraApertura).toBeNull();
  });
});

describe("Fase 1 · informe al propietario", () => {
  it("cuenta envíos, aperturas y el ranking de apartados", async () => {
    const { perfil } = await agente();
    for (let i = 0; i < 5; i++) {
      const { id } = await enviar(perfil, { abrir: true });
      await registrarEventos(db, id, [
        { tipo: "seccion", seccionIdx: 0, msVisible: 30_000 },
        { tipo: "seccion", seccionIdx: 1, msVisible: 60_000 },
        ...(i < 2 ? [{ tipo: "final" as const }] : []),
      ]);
    }
    await enviar(perfil); // uno sin abrir

    const informe = (await generarInforme(db, perfil))!;
    expect(informe.cifras.enviados).toBe(6);
    expect(informe.cifras.abiertos).toBe(5);
    expect(informe.cifras.pctApertura).toBe(83);
    expect(informe.cifras.msMedio).toBe(90_000);
    expect(informe.llegaronAlFinal).toBe(2);
    expect(informe.pctFinal).toBe(40);
    expect(informe.apartados.map((a) => a.titulo)).toEqual(["Planos", "Fotos"]);
    expect(informe.apartados[0].pctLectores).toBe(100);
    // Nadie llegó a Precio: eso es una conversación que tener.
    expect(informe.saltados).toEqual([{ seccionIdx: 2, titulo: "Precio" }]);
  });

  /*
   * El umbral. Con dos lecturas, «el 50%» es ruido presentado como hecho, y
   * este documento se lleva a una reunión con el dueño del piso.
   */
  it("por debajo del mínimo no da porcentajes, da números", async () => {
    const { perfil } = await agente();
    for (let i = 0; i < MINIMO_PARA_PORCENTAJES - 1; i++) await enviar(perfil, { abrir: true });

    const pocos = (await generarInforme(db, perfil))!;
    expect(pocos.datosSuficientes).toBe(false);
    expect(pocos.cifras.pctApertura).toBeNull();
    expect(pocos.pctFinal).toBeNull();
    expect(pocos.cifras.abiertos).toBe(MINIMO_PARA_PORCENTAJES - 1);

    await enviar(perfil, { abrir: true });
    const bastantes = (await generarInforme(db, perfil))!;
    expect(bastantes.datosSuficientes).toBe(true);
    expect(bastantes.cifras.pctApertura).toBe(100);
  });

  /*
   * LA REGLA QUE NO SE SALTA. Identificar compradores ante el propietario es un
   * problema de protección de datos y, además, deja al agente sin su papel de
   * intermediario. Se busca el nombre en el informe ENTERO, serializado.
   */
  it("no aparece ni un destinatario, por ningún lado", async () => {
    const { perfil } = await agente();
    for (let i = 0; i < 5; i++) {
      const { id } = await enviar(perfil, { abrir: true, destinatario: `Comprador ${i}` });
      await registrarEventos(db, id, [{ tipo: "seccion", seccionIdx: 0, msVisible: 10_000 }]);
    }

    const informe = (await generarInforme(db, perfil))!;
    const texto = JSON.stringify(informe);
    expect(texto).not.toContain("Comprador");
    expect(texto).not.toContain("destinatario");
  });

  it("compara con el periodo anterior cuando lo hay", async () => {
    const { perfil } = await agente();
    // Cuatro en el mes pasado (el periodo anterior) y dos en este.
    for (let i = 0; i < 4; i++) await enviar(perfil, { abrir: true, hace: 40 * DIA });
    for (let i = 0; i < 2; i++) await enviar(perfil, { abrir: true });
    // El corte, DESPUÉS de crearlos: `hasta` es exclusivo y un enlace creado en
    // el mismo milisegundo se quedaría fuera de su propio periodo.
    const ahora = Date.now() + 1;

    const informe = (await generarInforme(db, perfil, { ahora }))!;
    expect(informe.cifras.enviados).toBe(2);
    expect(informe.anterior?.enviados).toBe(4);
    // El anterior pasa el umbral por su cuenta; este no.
    expect(informe.anterior?.pctApertura).toBe(100);
    expect(informe.cifras.pctApertura).toBeNull();
  });

  it("la ficha del inmueble entra, y la nota del agente no sale", async () => {
    const { perfil } = await agente();
    await guardarFichaDePropiedad(db, perfil, {
      referencia: "REF-118",
      propietarioNota: "el dueño llama los martes",
      exclusivaDesde: Date.now() - 30 * DIA,
    });

    const informe = (await generarInforme(db, perfil))!;
    expect(informe.propiedad?.referencia).toBe("REF-118");
    expect(JSON.stringify(informe)).not.toContain("martes");
  });

  it("la ruta es solo del dueño del perfil", async () => {
    const { perfil } = await agente("marina");
    await crearCuenta("intruso", "Otro");
    const suya = await panelSession("marina", "198.51.100.10");
    const ajena = await panelSession("intruso", "198.51.100.11");

    const mia = await call(`/api/profiles/${perfil}/informe`, {
      headers: { authorization: `Bearer ${suya}` },
    });
    const otra = await call(`/api/profiles/${perfil}/informe`, {
      headers: { authorization: `Bearer ${ajena}` },
    });
    const sin = await call(`/api/profiles/${perfil}/informe`);

    expect(mia.status).toBe(200);
    // 404 y no 403: el error no puede ser un buscador de perfiles ajenos.
    expect(otra.status).toBe(404);
    expect(sin.status).toBe(401);
  });

  it("un periodo imposible se rechaza en vez de devolver una tabla vacía", async () => {
    const { perfil } = await agente();
    const sesion = await panelSession("marina", "198.51.100.12");
    const res = await call(`/api/profiles/${perfil}/informe?desde=2000&hasta=1000`, {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(400);
  });
});

describe("Fase 2 · termómetro", () => {
  it("la relectura es la señal más fuerte, y va primera", async () => {
    const { userId, perfil } = await agente();
    const frio = await enviar(perfil, { hace: 5 * DIA });
    const { token } = await enviar(perfil, { modo: "ventana" });
    await consumePass(db, token);
    await consumePass(db, token); // vuelve

    const lista = await termometroDeLaCuenta(db, userId);
    expect(lista[0].temperatura).toBe("caliente");
    expect(lista[0].motivo).toBe("reapertura");
    expect(lista[0].aperturas).toBe(2);
    expect(lista.at(-1)!.passId).toBe(frio.id);
    expect(lista.at(-1)!.motivo).toBe("sin-abrir");
    expect(lista.at(-1)!.temperatura).toBe("frio");
  });

  it("llegar al final calienta; abrir y no terminar deja tibio", async () => {
    const { userId, perfil } = await agente();
    const leido = await enviar(perfil, { abrir: true, hace: 2 * DIA });
    await registrarEventos(db, leido.id, [{ tipo: "final" }]);
    // Tardó un día en abrirlo: sin eso, la apertura rápida ya sería señal, y lo
    // que se quiere medir aquí es el pase que no da ninguna.
    const ojeado = await enviar(perfil, { abrir: true, hace: 2 * DIA, tardo: DIA });
    await registrarEventos(db, ojeado.id, [{ tipo: "seccion", seccionIdx: 0, msVisible: 4_000 }]);

    const porId = new Map((await termometroDeLaCuenta(db, userId)).map((p) => [p.passId, p]));
    expect(porId.get(leido.id)!.motivo).toBe("final");
    expect(porId.get(leido.id)!.temperatura).toBe("caliente");
    expect(porId.get(ojeado.id)!.motivo).toBe("abierto-incompleto");
    expect(porId.get(ojeado.id)!.temperatura).toBe("tibio");
  });

  it("detenerse en un apartado se nota, y dice en cuál", async () => {
    const { userId, perfil } = await agente();
    const { id } = await enviar(perfil, { abrir: true, hace: 2 * DIA });
    await registrarEventos(db, id, [
      { tipo: "seccion", seccionIdx: 0, msVisible: 10_000 },
      { tipo: "seccion", seccionIdx: 1, msVisible: 120_000 },
    ]);

    const [primero] = await termometroDeLaCuenta(db, userId);
    expect(primero.motivo).toBe("atencion");
    expect(primero.apartado).toBe("Planos");
  });

  it("no se ve el termómetro de otra cuenta", async () => {
    const { perfil } = await agente("marina");
    await enviar(perfil, { abrir: true });
    await crearCuenta("intruso", "Otro");

    expect(await termometroDeLaCuenta(db, "intruso")).toEqual([]);
    const ajena = await panelSession("intruso", "198.51.100.20");
    const res = await call("/api/panel/termometro", {
      headers: { authorization: `Bearer ${ajena}` },
    });
    expect(((await res.json()) as { pases: unknown[] }).pases).toEqual([]);
  });
});

describe("Fase 2 · avisos de reapertura", () => {
  /*
   * INVARIANTE DE CONCURRENCIA. «Si un pase se abre cinco veces, un aviso, no
   * cinco» es un tope con un contador, y en este proyecto todos los que se han
   * buscado han aparecido. Dieciséis a la vez, con el pool ya caliente: sin el
   * índice único parcial y el ON CONFLICT, salen dieciséis filas.
   */
  it("dieciséis reaperturas a la vez dejan UN aviso que dice dieciséis", async () => {
    const { userId, perfil } = await agente();
    const { id } = await enviar(perfil, { abrir: true });
    await calentarPool();

    await Promise.all(Array.from({ length: 16 }, () => registrarAviso(db, id)));

    const avisos = await avisosPendientes(db, userId);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].veces).toBe(16);
  });

  it("abrir otra vez un enlace encola el aviso, y el trabajador lo crea", async () => {
    const { userId, perfil } = await agente();
    const { token } = await enviar(perfil, { modo: "ventana" });
    await consumePass(db, token);
    await consumePass(db, token);

    // La cola: el trabajo existe y lo ejecuta el trabajador de siempre.
    while (await procesarUno(DEPS_DEL_TRABAJADOR)) {
      /* vaciar */
    }

    const avisos = await avisosPendientes(db, userId);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].tipo).toBe("reapertura");
    expect(avisos[0].profileId).toBe(perfil);
  });

  it("la primera apertura NO avisa: la noticia es que vuelva", async () => {
    const { userId, perfil } = await agente();
    const { token } = await enviar(perfil, { modo: "ventana" });
    await consumePass(db, token);
    while (await procesarUno(DEPS_DEL_TRABAJADOR)) {
      /* vaciar */
    }
    expect(await avisosPendientes(db, userId)).toEqual([]);
  });

  it("apagados, no se crea ninguno", async () => {
    const { userId, perfil } = await agente();
    const { id } = await enviar(perfil, { abrir: true });
    await configurarAvisos(db, userId, false);

    expect(await registrarAviso(db, id)).toBe(false);
    expect(await avisosPendientes(db, userId)).toEqual([]);
  });

  it("visto uno, la siguiente vuelta abre otro: es una noticia nueva", async () => {
    const { userId, perfil } = await agente();
    const { id } = await enviar(perfil, { abrir: true });
    await registrarAviso(db, id);
    const [primero] = await avisosPendientes(db, userId);

    expect(await marcarVisto(db, userId, primero.id)).toBe(true);
    expect(await avisosPendientes(db, userId)).toEqual([]);

    await registrarAviso(db, id);
    expect(await avisosPendientes(db, userId)).toHaveLength(1);
  });

  it("nadie marca como visto el aviso de otro", async () => {
    const { userId, perfil } = await agente("marina");
    await crearCuenta("intruso", "Otro");
    const { id } = await enviar(perfil, { abrir: true });
    await registrarAviso(db, id);
    const [aviso] = await avisosPendientes(db, userId);

    expect(await marcarVisto(db, "intruso", aviso.id)).toBe(false);
    expect(await avisosPendientes(db, userId)).toHaveLength(1);
  });
});

describe("Fase 3 · comparativa", () => {
  it("una fila por propiedad, con lo que destaca en positivo y en negativo", async () => {
    const { userId, perfil } = await agente();
    const floja = await otroPerfil(userId, "p_floja", "Ático sin ascensor");

    // La buena: cinco enviados, cinco abiertos.
    for (let i = 0; i < 5; i++) await enviar(perfil, { abrir: true });
    // La floja: diez enviados, cuatro abiertos (40%… y aun así por encima del
    // umbral de datos, que va por aperturas).
    for (let i = 0; i < 4; i++) await enviar(floja, { abrir: true });
    for (let i = 0; i < 16; i++) await enviar(floja);

    const { filas } = await comparativaDeLaCuenta(db, userId);
    const porId = new Map(filas.map((f) => [f.profileId, f]));
    expect(filas).toHaveLength(2);
    expect(porId.get(perfil)!.pctApertura).toBe(100);
    expect(porId.get(perfil)!.destacado).toBe("mejor-apertura");
    expect(porId.get(floja)!.pctApertura).toBe(20);
    expect(porId.get(floja)!.pctApertura!).toBeLessThan(APERTURA_BAJA_PCT);
    expect(porId.get(floja)!.destacado).toBe("apertura-baja");
  });

  it("sin datos suficientes, números absolutos y ni un porcentaje", async () => {
    const { userId, perfil } = await agente();
    await enviar(perfil, { abrir: true });
    await enviar(perfil);

    const [fila] = (await comparativaDeLaCuenta(db, userId)).filas;
    expect(fila.enviados).toBe(2);
    expect(fila.abiertos).toBe(1);
    expect(fila.datosSuficientes).toBe(false);
    expect(fila.pctApertura).toBeNull();
    expect(fila.destacado).toBeNull();
  });

  /*
   * Nunca contra datos de otro usuario: ni crudos, ni en media, ni
   * «anonimizados». Con dos cuentas en la tabla, una media revela la otra.
   */
  it("solo entra lo del mismo agente", async () => {
    const { userId, perfil } = await agente("marina");
    for (let i = 0; i < 5; i++) await enviar(perfil, { abrir: true });
    await agente("rival", "p_rival");

    const { filas } = await comparativaDeLaCuenta(db, userId);
    expect(filas.map((f) => f.profileId)).toEqual([perfil]);
  });

  it("la ruta va por sesión, y no acepta el id de otra cuenta", async () => {
    await agente("marina");
    const sesion = await panelSession("marina", "198.51.100.30");
    const res = await call("/api/panel/comparativa?userId=rival", {
      headers: { authorization: `Bearer ${sesion}` },
    });
    expect(res.status).toBe(200);
    const { filas } = (await res.json()) as { filas: { profileId: string }[] };
    expect(filas.every((f) => f.profileId.startsWith("p_marina"))).toBe(true);
  });
});

describe("la ficha de propiedad", () => {
  it("se guarda y se lee por su dueño; otro no la ve", async () => {
    const { perfil } = await agente("marina");
    await crearCuenta("intruso", "Otro");
    const suya = await panelSession("marina", "198.51.100.40");
    const ajena = await panelSession("intruso", "198.51.100.41");

    const puesta = await call(`/api/profiles/${perfil}/propiedad`, {
      method: "PUT",
      headers: { authorization: `Bearer ${suya}`, ...JSON_HEADERS },
      body: JSON.stringify({ referencia: "REF-42" }),
    });
    expect(puesta.status).toBe(200);

    const leida = await call(`/api/profiles/${perfil}/propiedad`, {
      headers: { authorization: `Bearer ${ajena}` },
    });
    expect(leida.status).toBe(404);
  });

  /*
   * Lo que NO se guarda del propietario del inmueble: nombre, correo, teléfono.
   * No hay columnas (migración 0014) y tampoco campos en el esquema de entrada,
   * para que no se cuelen por un `passthrough` futuro.
   */
  it("no hay dónde meter los datos personales del propietario", async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'vistta' AND table_name = 'propiedad_meta'`
    );
    const columnas = rows.map((r) => r.column_name).sort();
    expect(columnas).toEqual([
      "actualizado_en",
      "exclusiva_desde",
      "profile_id",
      "propietario_nota",
      "referencia",
    ]);

    const { perfil } = await agente();
    const sesion = await panelSession("marina", "198.51.100.42");
    const res = await call(`/api/profiles/${perfil}/propiedad`, {
      method: "PUT",
      headers: { authorization: `Bearer ${sesion}`, ...JSON_HEADERS },
      body: JSON.stringify({ referencia: "R", propietarioEmail: "dueño@ejemplo.test" }),
    });
    expect(res.status).toBe(400);
  });
});
