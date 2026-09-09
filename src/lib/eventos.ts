import type { Db } from "../db";
import { parseProfileData } from "./pass";

/**
 * Métricas de lectura: qué miró el destinatario y cuánto.
 *
 * Lo que este módulo NO hace, y no por descuido: no guarda IP, ni user-agent, ni
 * nada del dispositivo —no hay columnas para eso— y no guarda una traza fina de
 * cuándo se miró cada cosa. Lo que llega ya viene agregado por el navegador:
 * tiempo total visible por sección y por medio.
 *
 * La diferencia importa. «Estuvo unos cuatro minutos y volvió dos veces a los
 * planos» es información comercial. Un rastro segundo a segundo de una persona
 * identificada —porque desde el bloque anterior el pase lleva destinatario— es
 * otra cosa, y no es la que se ha declarado en `legal/rat.md`.
 */

/** Doce horas. El mismo tope que la base; aquí para no llegar a insultarla. */
export const MS_VISIBLE_MAXIMO = 12 * 60 * 60 * 1000;

/** Cuántos eventos se admiten de una tacada. Un dossier no tiene mil secciones. */
export const EVENTOS_POR_ENVIO = 200;

/**
 * `cierre` se manda SIEMPRE al salir; `final` solo si el último apartado llegó
 * a verse. No son lo mismo y confundirlos vacía de sentido el termómetro: casi
 * todas las lecturas tienen cierre y muy pocas tienen final.
 */
export type TipoDeEvento = "apertura" | "seccion" | "medio" | "cierre" | "final";

export interface EventoDeLectura {
  tipo: TipoDeEvento;
  seccionIdx?: number;
  mediaId?: string;
  msVisible?: number;
}

/**
 * Guarda los eventos de una lectura.
 *
 * Se escribe en una sola sentencia con `unnest`: son hasta doscientas filas y
 * esto corre mientras alguien mira una página, no en un trabajo de fondo.
 *
 * Nada de lo que llega se cree sin más: el que manda es un navegador que puede
 * estar manipulado. Los topes se aplican aquí Y en la base.
 */
export async function registrarEventos(
  db: Db,
  passId: string,
  eventos: readonly EventoDeLectura[],
  ahora = Date.now()
): Promise<number> {
  const utiles = eventos.slice(0, EVENTOS_POR_ENVIO);
  if (utiles.length === 0) return 0;

  /*
   * El TÍTULO del apartado lo pone el servidor, no el navegador.
   *
   * El navegador manda un índice y nada más. Si el texto llegara de fuera, un
   * cliente manipulado escribiría lo que quisiera en un texto que acaba impreso
   * en el informe que el agente le entrega al propietario del inmueble, con su
   * marca encima. Y de paso: se resuelve AHORA, con el dosier tal y como está
   * mientras se lee, que es lo que hace que el ranking siga significando algo
   * cuando mañana se reordenen los apartados.
   */
  const titulos = utiles.some((e) => e.seccionIdx !== undefined)
    ? await titulosDelPase(db, passId)
    : [];

  const { rowCount } = await db.query(
    `INSERT INTO vistta.pass_events
       (id, pass_id, ts, tipo, seccion_idx, seccion_titulo, media_id, ms_visible)
     SELECT gen_random_uuid()::text, $1, $2, t.tipo, t.seccion_idx, t.seccion_titulo,
            t.media_id, t.ms_visible
     FROM unnest($3::text[], $4::int[], $5::text[], $6::text[], $7::int[])
       AS t(tipo, seccion_idx, seccion_titulo, media_id, ms_visible)`,
    [
      passId,
      ahora,
      utiles.map((e) => e.tipo),
      utiles.map((e) => e.seccionIdx ?? null),
      utiles.map((e) => (e.seccionIdx === undefined ? null : (titulos[e.seccionIdx] ?? null))),
      utiles.map((e) => e.mediaId ?? null),
      utiles.map((e) =>
        e.msVisible === undefined
          ? null
          : Math.min(Math.max(0, Math.round(e.msVisible)), MS_VISIBLE_MAXIMO)
      ),
    ]
  );
  return rowCount;
}

/** Tope del título guardado. El mismo que la base; aquí para no insultarla. */
const TITULO_MAXIMO = 200;

/** Los títulos de los apartados de un dosier, por índice. */
export async function titulosDelPerfil(db: Db, profileId: string): Promise<(string | null)[]> {
  const fila = await db.one<{ data: unknown }>(`SELECT data FROM vistta.profiles WHERE id = $1`, [
    profileId,
  ]);
  if (!fila) return [];
  return parseProfileData(fila.data).sections.map((s) =>
    s.title ? s.title.slice(0, TITULO_MAXIMO) : null
  );
}

/** Lo mismo, llegando por el pase. */
async function titulosDelPase(db: Db, passId: string): Promise<(string | null)[]> {
  const fila = await db.one<{ data: unknown }>(
    `SELECT p.data FROM vistta.passes ps
     JOIN vistta.profiles p ON p.id = ps.profile_id
     WHERE ps.id = $1`,
    [passId]
  );
  if (!fila) return [];
  return parseProfileData(fila.data).sections.map((s) =>
    s.title ? s.title.slice(0, TITULO_MAXIMO) : null
  );
}

export interface ResumenDeLectura {
  /** Si no hay ni una apertura registrada, el panel dice «aún sin abrir». */
  hayDatos: boolean;
  msTotales: number;
  secciones: { seccionIdx: number; msVisible: number }[];
  medios: { mediaId: string; msVisible: number }[];
}

/**
 * Lo que se le enseña al dueño del pase.
 *
 * Suma y agrupa aquí, en SQL, y no manda los eventos crudos al panel: el
 * navegador del cliente no tiene por qué recibir la lista de instantes en que
 * otra persona miró cada foto.
 */
export async function resumenDeLectura(db: Db, passId: string): Promise<ResumenDeLectura> {
  const [{ rows: totales }, { rows: secciones }, { rows: medios }] = await Promise.all([
    db.query<{ n: number; ms: number }>(
      `SELECT count(*)::int AS n, COALESCE(sum(ms_visible), 0)::bigint AS ms
       FROM vistta.pass_events WHERE pass_id = $1`,
      [passId]
    ),
    db.query<{ seccion_idx: number; ms: number }>(
      `SELECT seccion_idx, COALESCE(sum(ms_visible), 0)::bigint AS ms
       FROM vistta.pass_events
       WHERE pass_id = $1 AND tipo = 'seccion' AND seccion_idx IS NOT NULL
       GROUP BY seccion_idx ORDER BY ms DESC`,
      [passId]
    ),
    db.query<{ media_id: string; ms: number }>(
      `SELECT media_id, COALESCE(sum(ms_visible), 0)::bigint AS ms
       FROM vistta.pass_events
       WHERE pass_id = $1 AND tipo = 'medio' AND media_id IS NOT NULL
       GROUP BY media_id ORDER BY ms DESC LIMIT 20`,
      [passId]
    ),
  ]);

  return {
    hayDatos: Number(totales[0]?.n ?? 0) > 0,
    msTotales: Number(totales[0]?.ms ?? 0),
    secciones: secciones.map((r) => ({ seccionIdx: r.seccion_idx, msVisible: Number(r.ms) })),
    medios: medios.map((r) => ({ mediaId: r.media_id, msVisible: Number(r.ms) })),
  };
}

/**
 * Los derivados: lo que de verdad se puede hacer con una lectura.
 *
 * «Tiempo total» es una métrica de vanidad —no dice qué hacer con ella—. Estos
 * siete responden a las tres preguntas de quien vende: ¿lo ha abierto?, ¿qué le
 * interesó?, ¿hay señal de compra?
 *
 * Vienen de DOS sitios distintos y conviene no mezclarlos:
 *
 *   - Del PASE (`passes`): abierto, cuándo, cuántas veces, y cuánto tardó. Es
 *     verdad del servidor, la escribe el consumo atómico, y está en todos los
 *     planes porque no es telemetría.
 *   - De la TELEMETRÍA (`pass_events`): qué apartados y cuánto. Solo la hay si
 *     el plan la registra, y es APROXIMADA: la mide un navegador. `hayLectura`
 *     dice cuál de los dos casos es, para que el panel no enseñe un cero que
 *     parece «no miró nada» cuando significa «no se midió».
 */
export interface ApartadoLeido {
  seccionIdx: number;
  titulo: string | null;
  msVisible: number;
}

export interface DerivadosDeLectura {
  abierto: boolean;
  primeraAperturaEn: number | null;
  /** La última vez que se abrió. Sale de los eventos: el pase no la guarda. */
  ultimaAperturaEn: number | null;
  aperturas: number;
  /**
   * Cuánto tardó en abrirse desde que se generó el enlace.
   *
   * Es el mejor indicador de temperatura que hay aquí: minutos es caliente,
   * días es frío. Y no depende de la telemetría.
   */
  msHastaPrimeraApertura: number | null;
  hayLectura: boolean;
  /** Suma de los apartados. NO incluye el tiempo por medio, que los solapa. */
  msTotales: number;
  llegoAlFinal: boolean;
  /** De más a menos atención. */
  ranking: ApartadoLeido[];
  /**
   * Apartados de los que no consta lectura.
   *
   * Se comparan contra los que el dosier tiene HOY, no contra los que tenía al
   * abrirse: no hay instantánea de apartados, solo de medios. Si el dosier ha
   * cambiado desde que se envió el enlace, esta lista puede nombrar un apartado
   * que aquella lectura no llegó a tener delante. El panel lo dice.
   */
  saltados: { seccionIdx: number; titulo: string | null }[];
}

export async function derivadosDeLectura(
  db: Db,
  passId: string
): Promise<DerivadosDeLectura | null> {
  const pase = await db.one<{
    created_at: number;
    primera_apertura_at: number | null;
    accesos_usados: number;
    profile_id: string;
  }>(
    `SELECT created_at, primera_apertura_at, accesos_usados, profile_id
     FROM vistta.passes WHERE id = $1`,
    [passId]
  );
  if (!pase) return null;

  const [agregado, ranking, titulos] = await Promise.all([
    db.one<{
      ultima_apertura: number | null;
      finales: number;
      eventos: number;
      ms: number;
    }>(
      `SELECT max(ts) FILTER (WHERE tipo = 'apertura')      AS ultima_apertura,
              count(*) FILTER (WHERE tipo = 'final')::int   AS finales,
              count(*)::int                                 AS eventos,
              COALESCE(sum(ms_visible) FILTER (WHERE tipo = 'seccion'), 0)::bigint AS ms
       FROM vistta.pass_events WHERE pass_id = $1`,
      [passId]
    ),
    db.query<{ seccion_idx: number; titulo: string | null; ms: number }>(
      // El título, el del evento MÁS RECIENTE de ese apartado: si el dosier se
      // renombró a mitad de la lectura, manda cómo se llamaba al final.
      `SELECT seccion_idx,
              (array_agg(seccion_titulo ORDER BY ts DESC))[1] AS titulo,
              COALESCE(sum(ms_visible), 0)::bigint            AS ms
       FROM vistta.pass_events
       WHERE pass_id = $1 AND tipo = 'seccion' AND seccion_idx IS NOT NULL
       GROUP BY seccion_idx
       ORDER BY ms DESC`,
      [passId]
    ),
    titulosDelPerfil(db, pase.profile_id),
  ]);

  const leidos = new Set(ranking.rows.map((r) => r.seccion_idx));

  return {
    abierto: pase.primera_apertura_at !== null,
    primeraAperturaEn: pase.primera_apertura_at,
    // Si no hay eventos de apertura —plan sin métricas—, la primera es lo único
    // que se sabe, y es mejor dato que un null.
    ultimaAperturaEn: agregado?.ultima_apertura ?? pase.primera_apertura_at,
    aperturas: pase.accesos_usados,
    msHastaPrimeraApertura:
      pase.primera_apertura_at === null ? null : pase.primera_apertura_at - pase.created_at,
    hayLectura: (agregado?.eventos ?? 0) > 0,
    msTotales: Number(agregado?.ms ?? 0),
    llegoAlFinal: (agregado?.finales ?? 0) > 0,
    ranking: ranking.rows.map((r) => ({
      seccionIdx: r.seccion_idx,
      titulo: r.titulo,
      msVisible: Number(r.ms),
    })),
    saltados: titulos
      .map((titulo, seccionIdx) => ({ seccionIdx, titulo }))
      .filter((s) => !leidos.has(s.seccionIdx)),
  };
}

/**
 * Borrado por antigüedad.
 *
 * Los eventos ya se van con su pase (clave ajena en cascada). Esto es el otro
 * plazo: aunque el pase siga ahí, la actividad de lectura no se guarda para
 * siempre. Es el plazo que `legal/rat.md` declara.
 */
export async function purgarEventos(
  db: Db,
  retencionMs: number,
  ahora = Date.now()
): Promise<number> {
  const { rowCount } = await db.query(`DELETE FROM vistta.pass_events WHERE ts < $1`, [
    ahora - retencionMs,
  ]);
  return rowCount;
}
