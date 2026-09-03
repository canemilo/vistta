import type { Db } from "../db";

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

export type TipoDeEvento = "apertura" | "seccion" | "medio" | "cierre";

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

  const { rowCount } = await db.query(
    `INSERT INTO vistta.pass_events (id, pass_id, ts, tipo, seccion_idx, media_id, ms_visible)
     SELECT gen_random_uuid()::text, $1, $2, t.tipo, t.seccion_idx, t.media_id, t.ms_visible
     FROM unnest($3::text[], $4::int[], $5::text[], $6::int[])
       AS t(tipo, seccion_idx, media_id, ms_visible)`,
    [
      passId,
      ahora,
      utiles.map((e) => e.tipo),
      utiles.map((e) => e.seccionIdx ?? null),
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
