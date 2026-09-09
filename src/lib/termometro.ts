import type { Db } from "../db";

/**
 * Termómetro de interés: a quién llamar hoy.
 *
 * DOS COSAS QUE ESTE MÓDULO NO HACE, y no por falta de tiempo:
 *
 *   1. No da una puntuación del 1 al 100. Un número sin explicación no genera
 *      confianza ni acción: nadie coge el teléfono porque un dosier marque 73.
 *      Lo que sale es un estado cualitativo Y el motivo por el que lo es.
 *   2. No perfila personas. Describe el comportamiento sobre ESE dosier —«volvió
 *      a abrirlo», «no pasó de las fotos»— y nunca emite un juicio sobre quien
 *      lee. «Este comprador es indeciso» no es una conclusión que este sistema
 *      pueda sacar ni tenga derecho a escribir.
 *
 * El motivo sale en CÓDIGO, no en texto. La frase la monta el panel: es donde
 * vive el resto de la copia del producto, y así el mismo dato se puede decir de
 * otra manera sin tocar una consulta.
 *
 * Las señales, de más a menos predictiva (§2.1 del encargo):
 *   1. Relectura — la más fuerte.
 *   2. Llegar al final del dosier.
 *   3. Atención concentrada en un apartado.
 *   4. Apertura rápida tras el envío.
 */

/** Abrir dentro de esta media hora es una señal: estaba esperándolo. */
export const APERTURA_RAPIDA_MS = 30 * 60 * 1000;

/** Por debajo de un minuto de lectura total no hay «atención» que concentrar. */
export const ATENCION_MINIMA_MS = 60 * 1000;

/** Qué parte del tiempo tiene que llevarse un apartado para decir que se detuvo. */
export const ATENCION_CONCENTRADA = 0.5;

/** Sin abrir pasado esto, el enlace está frío. */
export const ENFRIAMIENTO_MS = 3 * 24 * 60 * 60 * 1000;

/** Cuánto hacia atrás mira el termómetro. Llamar por algo de hace un mes no. */
export const VENTANA_TERMOMETRO_MS = 30 * 24 * 60 * 60 * 1000;

export type Temperatura = "caliente" | "tibio" | "frio";

export type MotivoDeInteres =
  "reapertura" | "final" | "atencion" | "apertura-rapida" | "abierto-incompleto" | "sin-abrir";

export interface PaseEnElTermometro {
  passId: string;
  profileId: string;
  profileNombre: string;
  /** Dato personal de un tercero: solo sale al panel de su dueño. */
  destinatarioRef: string | null;
  destinatarioNota: string | null;
  creadoEn: number;
  temperatura: Temperatura;
  motivo: MotivoDeInteres;
  /** El instante del que habla el motivo: cuándo reabrió, cuándo se envió. */
  cuando: number;
  /** Solo con motivo `atencion`: en qué apartado se detuvo. */
  apartado: string | null;
  apartadoIdx: number | null;
  aperturas: number;
  /** Aproximado: lo mide un navegador. El panel lo dice donde lo pinta. */
  msLeidos: number;
}

interface FilaDelTermometro {
  id: string;
  profile_id: string;
  display_name: string;
  destinatario_ref: string | null;
  destinatario_nota: string | null;
  created_at: number;
  primera_apertura_at: number | null;
  accesos_usados: number;
  ultima_apertura: number | null;
  finales: number;
  ms_total: number;
  top_titulo: string | null;
  top_idx: number | null;
  top_ms: number | null;
}

/**
 * Los pases de un agente, ordenados por a quién conviene llamar antes.
 *
 * Filtra por `owner_id` en la consulta, no después: es lo único que impide ver
 * la actividad de otro inquilino, y una comprobación en TypeScript sobre filas
 * ya traídas es una comprobación que algún día se olvida.
 */
export async function termometroDeLaCuenta(
  db: Db,
  userId: string,
  opciones: { ahora?: number; limite?: number } = {}
): Promise<PaseEnElTermometro[]> {
  const ahora = opciones.ahora ?? Date.now();

  const { rows } = await db.query<FilaDelTermometro>(
    `SELECT ps.id, ps.profile_id, p.display_name,
            ps.destinatario_ref, ps.destinatario_nota,
            ps.created_at, ps.primera_apertura_at, ps.accesos_usados,
            ev.ultima_apertura, ev.finales, ev.ms_total,
            top.titulo AS top_titulo, top.idx AS top_idx, top.ms AS top_ms
     FROM vistta.passes ps
     JOIN vistta.profiles p ON p.id = ps.profile_id
     LEFT JOIN LATERAL (
       SELECT max(e.ts) FILTER (WHERE e.tipo = 'apertura')      AS ultima_apertura,
              count(*)  FILTER (WHERE e.tipo = 'final')::int    AS finales,
              COALESCE(sum(e.ms_visible) FILTER (WHERE e.tipo = 'seccion'), 0)::bigint AS ms_total
       FROM vistta.pass_events e WHERE e.pass_id = ps.id
     ) ev ON true
     LEFT JOIN LATERAL (
       SELECT e.seccion_idx AS idx,
              (array_agg(e.seccion_titulo ORDER BY e.ts DESC))[1] AS titulo,
              sum(e.ms_visible)::bigint AS ms
       FROM vistta.pass_events e
       WHERE e.pass_id = ps.id AND e.tipo = 'seccion' AND e.seccion_idx IS NOT NULL
       GROUP BY e.seccion_idx
       ORDER BY sum(e.ms_visible) DESC
       LIMIT 1
     ) top ON true
     WHERE p.owner_id = $1 AND ps.created_at >= $2
     ORDER BY ps.created_at DESC
     LIMIT $3`,
    [userId, ahora - VENTANA_TERMOMETRO_MS, opciones.limite ?? 200]
  );

  return rows.map((f) => clasificar(f, ahora)).sort(porUrgencia);
}

/** El orden en el que aparecen las temperaturas. */
const ORDEN: Record<Temperatura, number> = { caliente: 0, tibio: 1, frio: 2 };

/**
 * Primero por temperatura, y dentro de cada una por lo reciente que sea la
 * señal. Así lo de arriba es siempre lo que merece una llamada hoy.
 */
function porUrgencia(a: PaseEnElTermometro, b: PaseEnElTermometro): number {
  return ORDEN[a.temperatura] - ORDEN[b.temperatura] || b.cuando - a.cuando;
}

/**
 * De una fila a un estado con su motivo. Primera señal que se cumple, gana:
 * el orden de los `if` ES el orden de fuerza predictiva del encargo, y por eso
 * no se puede reordenar sin cambiar el producto.
 */
function clasificar(f: FilaDelTermometro, ahora: number): PaseEnElTermometro {
  const base = {
    passId: f.id,
    profileId: f.profile_id,
    profileNombre: f.display_name,
    destinatarioRef: f.destinatario_ref,
    destinatarioNota: f.destinatario_nota,
    creadoEn: Number(f.created_at),
    apartado: null as string | null,
    apartadoIdx: null as number | null,
    aperturas: f.accesos_usados,
    msLeidos: Number(f.ms_total ?? 0),
  };

  // Sin abrir. Frío si lleva demasiado ahí; si no, todavía no dice nada.
  if (f.primera_apertura_at === null) {
    const creado = Number(f.created_at);
    return {
      ...base,
      temperatura: ahora - creado >= ENFRIAMIENTO_MS ? "frio" : "tibio",
      motivo: "sin-abrir",
      cuando: creado,
    };
  }

  const primera = Number(f.primera_apertura_at);
  const ultima = f.ultima_apertura === null ? primera : Number(f.ultima_apertura);

  /*
   * 1. RELECTURA. Volver a abrirlo es la señal más fuerte que hay aquí.
   *
   * Se cuenta cualquier reapertura y no «otro día» como decía el encargo: el
   * día de quién sería. El servidor no sabe en qué huso está quien lee —no
   * llega nada de su navegador, y así tiene que seguir—, así que «ayer» sería
   * el ayer del servidor, que puede no ser el suyo. Lo que sí es cierto sin
   * suponer nada es que volvió, y cuándo.
   */
  if (f.accesos_usados > 1) {
    return { ...base, temperatura: "caliente", motivo: "reapertura", cuando: ultima };
  }

  // 2. Llegó al final: ha visto el precio.
  if ((f.finales ?? 0) > 0) {
    return { ...base, temperatura: "caliente", motivo: "final", cuando: ultima };
  }

  // 3. Atención concentrada en un apartado. Pide tiempo suficiente para que
  //    «la mitad» signifique algo: la mitad de veinte segundos no es nada.
  const total = Number(f.ms_total ?? 0);
  const top = Number(f.top_ms ?? 0);
  if (total >= ATENCION_MINIMA_MS && top >= total * ATENCION_CONCENTRADA) {
    return {
      ...base,
      temperatura: "caliente",
      motivo: "atencion",
      cuando: ultima,
      apartado: f.top_titulo,
      apartadoIdx: f.top_idx,
    };
  }

  // 4. Lo abrió a los pocos minutos de recibirlo.
  if (primera - Number(f.created_at) <= APERTURA_RAPIDA_MS) {
    return { ...base, temperatura: "caliente", motivo: "apertura-rapida", cuando: primera };
  }

  // Abierto, sin ninguna de las cuatro señales. Ni frío ni caliente: lo miró.
  return { ...base, temperatura: "tibio", motivo: "abierto-incompleto", cuando: ultima };
}
