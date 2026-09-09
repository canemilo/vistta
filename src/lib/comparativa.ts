import type { Db } from "../db";
import { MINIMO_PARA_PORCENTAJES, PERIODO_POR_DEFECTO_MS } from "./informe";

/**
 * Comparativa entre las propiedades de UN agente: dónde merece la pena el
 * esfuerzo.
 *
 * ============================================================================
 *  SOLO ENTRE PROPIEDADES DEL MISMO DUEÑO. NUNCA CONTRA DATOS DE OTRO.
 * ============================================================================
 *
 * Ni con los de otro usuario, ni con una media del sector, ni con un agregado
 * «anonimizado» de todos los inquilinos. Lo que se abre y lo que se mira de los
 * dosieres de otra inmobiliaria es información comercial suya, y un agregado no
 * deja de serlo porque se le quiten los nombres: con dos cuentas en la tabla, la
 * media revela la otra. El filtro es `owner_id`, va en el WHERE de la consulta,
 * y hay una prueba que lo comprueba.
 *
 * Y el mismo umbral que el informe: por debajo de él, números absolutos y un
 * aviso, no porcentajes. Comparar dos propiedades por un porcentaje calculado
 * sobre tres lecturas es peor que no compararlas.
 */

/** Por debajo de esta apertura, algo pasa con cómo se está enviando. */
export const APERTURA_BAJA_PCT = 30;

export type Destacado = "mejor-apertura" | "apertura-baja";

export interface FilaDeComparativa {
  profileId: string;
  displayName: string;
  /** La referencia del CRM del agente, si la puso. */
  referencia: string | null;
  enviados: number;
  abiertos: number;
  /** null por debajo del umbral: con dos datos, un porcentaje engaña. */
  pctApertura: number | null;
  /** Tiempo medio por dosier abierto. Aproximado. null si no se midió. */
  msMedio: number | null;
  llegaronAlFinal: number;
  pctFinal: number | null;
  datosSuficientes: boolean;
  /**
   * Lo que destaca, en positivo y en negativo. Lo segundo es tan útil como lo
   * primero: una apertura muy baja no dice que el piso sea malo, dice que el
   * problema está en cómo se está mandando.
   */
  destacado: Destacado | null;
}

interface FilaCruda {
  id: string;
  display_name: string;
  referencia: string | null;
  enviados: number;
  abiertos: number;
  ms: number | null;
  finales: number;
}

export async function comparativaDeLaCuenta(
  db: Db,
  userId: string,
  opciones: { desde?: number; hasta?: number; ahora?: number } = {}
): Promise<{ periodo: { desde: number; hasta: number }; filas: FilaDeComparativa[] }> {
  const ahora = opciones.ahora ?? Date.now();
  const hasta = opciones.hasta ?? ahora;
  const desde = opciones.desde ?? hasta - PERIODO_POR_DEFECTO_MS;

  const { rows } = await db.query<FilaCruda>(
    `SELECT p.id, p.display_name, pm.referencia,
            c.enviados, c.abiertos, t.ms, f.finales
     FROM vistta.profiles p
     LEFT JOIN vistta.propiedad_meta pm ON pm.profile_id = p.id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS enviados,
              count(*) FILTER (WHERE ps.primera_apertura_at IS NOT NULL)::int AS abiertos
       FROM vistta.passes ps
       WHERE ps.profile_id = p.id AND ps.created_at >= $2 AND ps.created_at < $3
     ) c ON true
     LEFT JOIN LATERAL (
       SELECT avg(x.ms)::bigint AS ms FROM (
         SELECT e.pass_id, sum(e.ms_visible) AS ms
         FROM vistta.pass_events e
         JOIN vistta.passes ps ON ps.id = e.pass_id
         WHERE ps.profile_id = p.id AND ps.created_at >= $2 AND ps.created_at < $3
           AND e.tipo = 'seccion'
         GROUP BY e.pass_id
       ) x
     ) t ON true
     LEFT JOIN LATERAL (
       SELECT count(DISTINCT e.pass_id)::int AS finales
       FROM vistta.pass_events e
       JOIN vistta.passes ps ON ps.id = e.pass_id
       WHERE ps.profile_id = p.id AND ps.created_at >= $2 AND ps.created_at < $3
         AND e.tipo = 'final'
     ) f ON true
     WHERE p.owner_id = $1
     ORDER BY p.display_name`,
    [userId, desde, hasta]
  );

  const filas: FilaDeComparativa[] = rows.map((r) => {
    const suficientes = r.abiertos >= MINIMO_PARA_PORCENTAJES;
    const pct = (parte: number, sobre: number): number | null =>
      suficientes && sobre > 0 ? Math.round((parte / sobre) * 100) : null;
    return {
      profileId: r.id,
      displayName: r.display_name,
      referencia: r.referencia,
      enviados: r.enviados ?? 0,
      abiertos: r.abiertos ?? 0,
      pctApertura: pct(r.abiertos ?? 0, r.enviados ?? 0),
      msMedio: r.ms === null ? null : Number(r.ms),
      llegaronAlFinal: r.finales ?? 0,
      pctFinal: pct(r.finales ?? 0, r.abiertos ?? 0),
      datosSuficientes: suficientes,
      destacado: null,
    };
  });

  return { periodo: { desde, hasta }, filas: destacar(filas) };
}

/**
 * Marca lo que sobresale. Solo entre las filas que tienen datos suficientes:
 * llamar «la mejor» a la que abrió una persona de una es exactamente el error
 * que el umbral existe para evitar.
 *
 * La mejor apertura se marca solo si es ÚNICA. Con un empate no hay nada que
 * destacar, y poner la medalla a la primera por orden alfabético es inventarse
 * un ganador.
 */
function destacar(filas: FilaDeComparativa[]): FilaDeComparativa[] {
  const conDatos = filas.filter((f) => f.pctApertura !== null);
  if (conDatos.length === 0) return filas;

  const mejor = Math.max(...conDatos.map((f) => f.pctApertura ?? 0));
  const empatadas = conDatos.filter((f) => f.pctApertura === mejor).length;

  return filas.map((f) => {
    if (f.pctApertura === null) return f;
    if (f.pctApertura < APERTURA_BAJA_PCT) return { ...f, destacado: "apertura-baja" };
    // Solo si hay con quién compararla: «la mejor de una» no significa nada.
    if (f.pctApertura === mejor && empatadas === 1 && conDatos.length > 1) {
      return { ...f, destacado: "mejor-apertura" };
    }
    return f;
  });
}
