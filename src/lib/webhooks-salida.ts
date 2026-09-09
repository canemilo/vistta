import { request as peticionHttps } from "node:https";
import type { Db } from "../db";
import { hmacSha256Hex } from "./crypto";
import {
  comprobarDestinoDeWebhook,
  hostProhibido,
  lookupSeguro,
  UrlNoPermitidaError,
} from "./url-segura";

/**
 * Webhooks SALIENTES: Vistta avisa al CRM del agente.
 *
 * Es la pieza que vale: «tu CRM te avisa cuando el comprador vuelve a abrir el
 * dosier» es el termómetro de interés aterrizado donde el agente ya trabaja.
 *
 * TRES REGLAS QUE NO SE NEGOCIAN:
 *
 * 1. **El envío NO ocurre dentro de la petición del viewer.** Va por la cola.
 *    Si el CRM del agente tarda cinco segundos o está caído, quien se quedaría
 *    esperando es el comprador que ha abierto el enlace, y ese es el único
 *    momento del producto que no se puede estropear.
 * 2. **No salen las métricas detalladas de lectura.** Que el agente vea en SU
 *    panel «se detuvo en Planos» es una cosa; bombear el comportamiento de una
 *    persona identificada a un sistema de terceros es otra. Sale el evento y el
 *    enlace de vuelta; el detalle se consulta en Vistta. Ver `legal/rat.md` §B.6.
 * 3. **La dirección la escribe el usuario**, así que cada petición pasa por el
 *    guardia de `url-segura.ts`. Ver allí: es la parte peligrosa de todo esto.
 */

export type EventoDeWebhook = "apertura" | "reapertura";

export const EVENTOS_DE_WEBHOOK: readonly EventoDeWebhook[] = ["apertura", "reapertura"] as const;

/**
 * Cuánto se espera a un CRM. Cinco segundos: esto corre en la cola, pero un
 * destino que no contesta no puede quedarse con un trabajador.
 */
export const ESPERA_MAXIMA_MS = 5_000;

/**
 * Envíos seguidos fallidos —ya agotados sus reintentos— antes de apagar la
 * conexión. Tres: uno puede ser un despliegue del CRM; tres es que la dirección
 * ya no vale.
 */
export const FALLOS_PARA_APAGAR = 3;

export interface DestinoDeSalida {
  id: string;
  targetUrl: string;
  eventos: EventoDeWebhook[];
  activo: boolean;
  creadoEn: number;
  fallos: number;
  ultimoError: string | null;
  ultimoEnvio: number | null;
}

interface FilaDestino {
  id: string;
  target_url: string;
  secreto: string;
  eventos: unknown;
  activo: boolean;
  created_at: number;
  fallos: number;
  last_error: string | null;
  last_sent_at: number | null;
}

/** Sin el secreto: se enseña una vez, al guardarlo, y no vuelve a salir. */
function comoDestino(f: FilaDestino): DestinoDeSalida {
  return {
    id: f.id,
    targetUrl: f.target_url,
    eventos: eventosDe(f.eventos),
    activo: f.activo,
    creadoEn: f.created_at,
    fallos: f.fallos,
    ultimoError: f.last_error,
    ultimoEnvio: f.last_sent_at,
  };
}

/** Lo que hay en la columna JSONB lo escribió esta aplicación, pero se valida. */
function eventosDe(valor: unknown): EventoDeWebhook[] {
  if (!Array.isArray(valor)) return [...EVENTOS_DE_WEBHOOK];
  const utiles = valor.filter((v): v is EventoDeWebhook =>
    EVENTOS_DE_WEBHOOK.includes(v as EventoDeWebhook)
  );
  return utiles.length > 0 ? utiles : [...EVENTOS_DE_WEBHOOK];
}

export async function destinosDe(db: Db, userId: string): Promise<DestinoDeSalida[]> {
  const { rows } = await db.query<FilaDestino>(
    `SELECT id, target_url, secreto, eventos, activo, created_at, fallos, last_error, last_sent_at
     FROM vistta.webhooks_salida WHERE owner_id = $1 ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map(comoDestino);
}

/**
 * Guarda un destino. Comprueba la dirección ANTES de escribir nada: guardar
 * primero y validar después deja en la base una dirección que alguien acabará
 * llamando.
 *
 * El secreto lo genera el servidor. Que lo eligiera el usuario acabaría en
 * «vistta123» firmando los avisos de su cartera entera.
 */
export async function guardarDestino(
  db: Db,
  userId: string,
  datos: { targetUrl: string; eventos?: EventoDeWebhook[] },
  ahora = Date.now()
): Promise<{ destino: DestinoDeSalida; secreto: string }> {
  const url = await comprobarDestinoDeWebhook(datos.targetUrl);
  const secreto = secretoNuevo();
  const id = crypto.randomUUID();
  const eventos = datos.eventos?.length ? datos.eventos : [...EVENTOS_DE_WEBHOOK];

  const fila = await db.one<FilaDestino>(
    `INSERT INTO vistta.webhooks_salida
       (id, owner_id, target_url, secreto, eventos, activo, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, TRUE, $6)
     RETURNING id, target_url, secreto, eventos, activo, created_at, fallos, last_error, last_sent_at`,
    [id, userId, url.toString(), secreto, JSON.stringify(eventos), ahora]
  );
  return { destino: comoDestino(fila!), secreto };
}

export async function borrarDestino(db: Db, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM vistta.webhooks_salida WHERE id = $2 AND owner_id = $1`,
    [userId, id]
  );
  return rowCount > 0;
}

/** Volver a encenderla después de arreglar lo que fuera. Reinicia el contador. */
export async function reactivarDestino(db: Db, userId: string, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE vistta.webhooks_salida SET activo = TRUE, fallos = 0, last_error = NULL
     WHERE id = $2 AND owner_id = $1`,
    [userId, id]
  );
  return rowCount > 0;
}

/** ¿Tiene esta cuenta alguna conexión apagada por fallos? El panel lo dice. */
export async function hayConexionApagada(db: Db, userId: string): Promise<boolean> {
  const fila = await db.one<{ id: string }>(
    `SELECT id FROM vistta.webhooks_salida WHERE owner_id = $1 AND activo = FALSE LIMIT 1`,
    [userId]
  );
  return fila !== null;
}

// ---------------------------------------------------------------------------
// El envío
// ---------------------------------------------------------------------------

/**
 * Lo que viaja al CRM.
 *
 * Nótese lo que NO está: ni tiempo por apartado, ni ranking, ni si llegó al
 * final. Solo que ocurrió algo, sobre qué dosier, y a qué contacto se le había
 * mandado —que es un dato que el propio agente escribió y que su CRM ya tiene—.
 */
export interface CargaDeWebhook {
  evento: EventoDeWebhook;
  ocurrioEn: number;
  pase: { id: string; aperturas: number; destinatarioRef: string | null };
  propiedad: { id: string; nombre: string; referencia: string | null };
  /** A dónde ir a ver el detalle. El detalle NO viaja: se consulta aquí. */
  panel: string;
}

export interface ResultadoDeEnvio {
  ok: boolean;
  estado: number | null;
  error: string | null;
}

/**
 * Manda la carga firmada, y devuelve qué pasó en vez de lanzar.
 *
 * La firma va sobre `<marca de tiempo>.<cuerpo>` y no solo sobre el cuerpo: sin
 * la marca dentro de lo firmado, quien capture un envío puede reenviarlo mañana
 * y el CRM no tiene forma de notarlo.
 *
 * `node:https` y no `fetch` por una razón concreta: hace falta pasarle el
 * `lookup`. Es lo que hace que el socket se conecte a la dirección que se ha
 * validado y no a la que conteste el DNS medio segundo después.
 */
export async function enviarWebhook(
  destino: { targetUrl: string; secreto: string },
  carga: CargaDeWebhook
): Promise<ResultadoDeEnvio> {
  let url: URL;
  try {
    url = new URL(destino.targetUrl);
  } catch {
    return { ok: false, estado: null, error: "direccion-no-valida" };
  }

  /*
   * Con una IP literal en la URL, Node NO llama al `lookup`: se conecta y ya.
   * Es la única puerta que el guardia del socket no cubre, así que se cierra
   * aquí, antes de abrir nada.
   */
  if (hostProhibido(url.hostname)) {
    return { ok: false, estado: null, error: "destino-no-permitido" };
  }

  const cuerpo = JSON.stringify(carga);
  const marca = Date.now();
  const firma = await hmacSha256Hex(destino.secreto, `${marca}.${cuerpo}`);

  return new Promise<ResultadoDeEnvio>((resolver) => {
    const peticion = peticionHttps(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(cuerpo),
          "user-agent": "Vistta",
          "X-Vistta-Evento": carga.evento,
          "X-Vistta-Firma": `t=${marca},v1=${firma}`,
        },
        // El guardia. Sin esto, esta función es un SSRF con formulario.
        lookup: lookupSeguro,
        timeout: ESPERA_MAXIMA_MS,
      },
      (respuesta) => {
        const estado = respuesta.statusCode ?? 0;
        // No se lee el cuerpo de la respuesta: no hay nada que nos interese en
        // él y leerlo es aceptar los bytes que quiera mandar un tercero.
        respuesta.resume();
        resolver({
          ok: estado >= 200 && estado < 300,
          estado,
          // Un 3xx es un fallo A PROPÓSITO: seguir la redirección se saltaría
          // las comprobaciones de la URL de una sola vez, y `node:https` no la
          // sigue por su cuenta.
          error: estado >= 200 && estado < 300 ? null : `estado-${estado}`,
        });
      }
    );

    peticion.on("timeout", () => {
      peticion.destroy();
      resolver({ ok: false, estado: null, error: "sin-respuesta" });
    });
    peticion.on("error", (err) => {
      resolver({
        ok: false,
        estado: null,
        // Solo el TIPO del fallo, nunca su mensaje: puede traer el nombre que
        // resolvió y a qué dirección, y esto se guarda y se enseña.
        error: err instanceof UrlNoPermitidaError ? "destino-no-permitido" : "sin-conexion",
      });
    });
    peticion.end(cuerpo);
  });
}

/** Los destinos activos de una cuenta que quieren este evento. */
export async function destinosParaElEvento(
  db: Db,
  userId: string,
  evento: EventoDeWebhook
): Promise<{ id: string; targetUrl: string; secreto: string }[]> {
  const { rows } = await db.query<{ id: string; target_url: string; secreto: string }>(
    `SELECT id, target_url, secreto FROM vistta.webhooks_salida
     WHERE owner_id = $1 AND activo = TRUE AND eventos @> to_jsonb($2::text)`,
    [userId, evento]
  );
  return rows.map((r) => ({ id: r.id, targetUrl: r.target_url, secreto: r.secreto }));
}

/** Un envío que ha ido bien: se limpia el historial de fallos. */
export async function anotarEnvioBueno(db: Db, id: string, ahora = Date.now()): Promise<void> {
  await db.query(
    `UPDATE vistta.webhooks_salida SET fallos = 0, last_error = NULL, last_sent_at = $2
     WHERE id = $1`,
    [id, ahora]
  );
}

/**
 * Uno que ha ido mal. Devuelve si la conexión ha quedado apagada.
 *
 * `definitivo` distingue un intento fallido de un ENVÍO fallido: la cola
 * reintenta cinco veces cada aviso, así que contar intentos apagaría la conexión
 * al primer despliegue del CRM. Solo suma cuando el aviso entero se ha perdido.
 */
export async function anotarEnvioMalo(
  db: Db,
  id: string,
  error: string,
  definitivo: boolean
): Promise<boolean> {
  const fila = await db.one<{ activo: boolean }>(
    `UPDATE vistta.webhooks_salida
     SET last_error = $2,
         fallos = CASE WHEN $3 THEN fallos + 1 ELSE fallos END,
         activo = CASE WHEN $3 AND fallos + 1 >= $4 THEN FALSE ELSE activo END
     WHERE id = $1
     RETURNING activo`,
    [id, error.slice(0, 120), definitivo, FALLOS_PARA_APAGAR]
  );
  return fila !== null && !fila.activo;
}

/** 256 bits en hexadecimal. Lo genera el servidor: nadie elige su secreto. */
function secretoNuevo(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// El trabajo de la cola
// ---------------------------------------------------------------------------

interface DatosDelAviso {
  id: string;
  accesos_usados: number;
  destinatario_ref: string | null;
  profile_id: string;
  display_name: string;
  owner_id: string | null;
  referencia: string | null;
}

/**
 * Manda un evento a todos los destinos activos del dueño del dosier.
 *
 * LANZA si alguno ha fallado, y eso es lo que hace que la cola lo reintente con
 * espera creciente: `jobs` ya sabe hacerlo (`attempts`, `last_error`), y
 * reimplementarlo aquí sería un segundo mecanismo de reintentos que nadie mira.
 *
 * `esElUltimoIntento` lo sabe el trabajador, no este módulo: es lo que
 * distingue «este intento ha fallado» de «este aviso se ha perdido», y solo lo
 * segundo cuenta para apagar la conexión.
 */
export async function avisarAlCrm(
  db: Db,
  datos: { passId: string; evento: EventoDeWebhook },
  opciones: { baseUrl: string; esElUltimoIntento: boolean }
): Promise<{ enviados: number; fallidos: number }> {
  const pase = await db.one<DatosDelAviso>(
    `SELECT ps.id, ps.accesos_usados, ps.destinatario_ref,
            p.id AS profile_id, p.display_name, p.owner_id, pm.referencia
     FROM vistta.passes ps
     JOIN vistta.profiles p ON p.id = ps.profile_id
     LEFT JOIN vistta.propiedad_meta pm ON pm.profile_id = p.id
     WHERE ps.id = $1`,
    [datos.passId]
  );
  // El pase pudo borrarse entre que se abrió y que le toca a la cola. No es un
  // fallo que reintentar: ya no hay nada que contar.
  if (!pase?.owner_id) return { enviados: 0, fallidos: 0 };

  const destinos = await destinosParaElEvento(db, pase.owner_id, datos.evento);
  if (destinos.length === 0) return { enviados: 0, fallidos: 0 };

  const carga: CargaDeWebhook = {
    evento: datos.evento,
    ocurrioEn: Date.now(),
    pase: {
      id: pase.id,
      aperturas: pase.accesos_usados,
      destinatarioRef: pase.destinatario_ref,
    },
    propiedad: {
      id: pase.profile_id,
      nombre: pase.display_name,
      referencia: pase.referencia,
    },
    panel: `${opciones.baseUrl}/panel/actividad`,
  };

  let enviados = 0;
  let fallidos = 0;
  for (const destino of destinos) {
    const resultado = await enviarWebhook(destino, carga);
    if (resultado.ok) {
      await anotarEnvioBueno(db, destino.id);
      enviados++;
    } else {
      await anotarEnvioMalo(
        db,
        destino.id,
        resultado.error ?? "desconocido",
        opciones.esElUltimoIntento
      );
      fallidos++;
    }
  }

  if (fallidos > 0) throw new EnvioFallidoError(fallidos);
  return { enviados, fallidos };
}

/** Para que la cola reintente. No lleva la URL ni el error: acaba en un log. */
export class EnvioFallidoError extends Error {
  readonly name = "EnvioFallidoError";
  constructor(readonly fallidos: number) {
    super(`${fallidos} envíos fallidos`);
  }
}

/**
 * «Enviar prueba» desde el panel.
 *
 * Es lo que convierte «configurar un webhook» en algo que un comercial puede
 * hacer solo: sin esto, la única forma de saber si funciona es esperar a que un
 * cliente de verdad abra un dosier de verdad.
 *
 * Un fallo aquí NO cuenta para apagar la conexión: estás probando, y probar
 * mientras lo arreglas no puede castigarte.
 */
export async function enviarPrueba(
  db: Db,
  userId: string,
  destinoId: string,
  baseUrl: string
): Promise<ResultadoDeEnvio | null> {
  const fila = await db.one<{ target_url: string; secreto: string }>(
    `SELECT target_url, secreto FROM vistta.webhooks_salida WHERE id = $2 AND owner_id = $1`,
    [userId, destinoId]
  );
  if (!fila) return null;

  const resultado = await enviarWebhook(
    { targetUrl: fila.target_url, secreto: fila.secreto },
    {
      evento: "reapertura",
      ocurrioEn: Date.now(),
      // Datos de mentira, y que se note que lo son: si el CRM del agente crea
      // una tarea con esto, tiene que quedar claro al leerla.
      pase: { id: "prueba", aperturas: 2, destinatarioRef: "Envío de prueba de Vistta" },
      propiedad: { id: "prueba", nombre: "Envío de prueba de Vistta", referencia: null },
      panel: `${baseUrl}/panel/actividad`,
    }
  );
  // Sí se anota el último error, para que la pantalla lo enseñe; lo que no se
  // toca es el contador que apaga.
  if (!resultado.ok) await anotarEnvioMalo(db, destinoId, resultado.error ?? "desconocido", false);
  else await anotarEnvioBueno(db, destinoId);
  return resultado;
}
