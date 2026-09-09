import type { Db } from "../db";
import { titulosDelPerfil } from "./eventos";
import { fichaDePropiedad } from "./propiedad";
import { limitesDe, planDe } from "./planes";

/**
 * El informe al propietario: el entregable que justifica la comisión.
 *
 * ============================================================================
 *  ES AGREGADO Y ANÓNIMO. NUNCA APARECE UN DESTINATARIO CONCRETO.
 * ============================================================================
 *
 * «Enviado a 12 compradores, 9 lo abrieron» sí. «Juan Pérez estuvo 4 minutos»
 * no, y no es una cuestión de gusto. Dos razones, las dos suficientes por sí
 * solas:
 *
 *   1. Ese destinatario (`passes.destinatario_ref`) es dato personal de un
 *      tercero que introdujo el agente. Enseñárselo al propietario del inmueble
 *      es una comunicación de datos a otro responsable, que nadie ha declarado
 *      ni tiene por qué poder declarar.
 *   2. El agente pierde su valor como intermediario en el momento en que el
 *      propietario ve la lista de sus compradores.
 *
 * Por eso ninguna consulta de este archivo selecciona `destinatario_ref` ni
 * `destinatario_nota`, y hay una prueba que lee el informe entero buscándolos.
 *
 * LA OTRA REGLA: el umbral. Con dos lecturas, «el 50%» es ruido estadístico
 * presentado como hecho, y este documento se lleva a una reunión. Por debajo del
 * mínimo salen los números absolutos y nada más.
 */

/**
 * Lecturas mínimas para que un porcentaje signifique algo.
 *
 * Cuatro. No es una cifra de plan —no vive en `planes.ts`— sino el punto por
 * debajo del cual un porcentaje engaña más de lo que informa: con tres
 * lecturas, cada una mueve el resultado 33 puntos.
 */
export const MINIMO_PARA_PORCENTAJES = 4;

/** Periodo por defecto del informe: el último mes. */
export const PERIODO_POR_DEFECTO_MS = 30 * 24 * 60 * 60 * 1000;

export interface ApartadoDelInforme {
  /** Puede ser null: un apartado sin título. El panel lo nombra por su número. */
  titulo: string | null;
  seccionIdx: number;
  /** Cuántas lecturas pasaron por él. Nunca quiénes. */
  lectores: number;
  /** null por debajo del umbral. */
  pctLectores: number | null;
  /** Atención media por lectura, en ms. Aproximado: lo mide un navegador. */
  msMedio: number;
}

export interface CifrasDelPeriodo {
  enviados: number;
  abiertos: number;
  pctApertura: number | null;
  /** Tiempo medio de lectura por dosier abierto. null si no se midió nada. */
  msMedio: number | null;
}

export interface Informe {
  profileId: string;
  displayName: string;
  brandColor: string | null;
  logo: string | null;
  /** Referencia y exclusiva. La nota del agente NO viaja: es suya. */
  propiedad: { referencia: string | null; exclusivaDesde: number | null } | null;
  periodo: { desde: number; hasta: number };
  generadoEn: number;
  /**
   * Si el plan de la cuenta registra actividad de lectura. En `prueba` no, y
   * entonces el informe trae los envíos y las aperturas —que salen del pase,
   * no de la telemetría— y nada más.
   */
  mideLectura: boolean;
  /**
   * Si hay lecturas suficientes para hablar en porcentajes. Cuando es `false`
   * todos los `pct*` vienen a null a propósito, para que no haya forma de
   * pintarlos por descuido.
   */
  datosSuficientes: boolean;
  cifras: CifrasDelPeriodo;
  relecturas: number;
  llegaronAlFinal: number;
  pctFinal: number | null;
  apartados: ApartadoDelInforme[];
  /** Apartados que hoy tiene el dosier y por los que no pasó ninguna lectura. */
  saltados: { titulo: string | null; seccionIdx: number }[];
  /** El mismo periodo, justo antes. `null` si no había ni un envío entonces. */
  anterior: CifrasDelPeriodo | null;
}

interface FilaDeApartado {
  titulo: string | null;
  idx: number;
  lectores: number;
  ms_medio: number;
}

/**
 * Genera el informe de una propiedad.
 *
 * `desde`/`hasta` acotan por la fecha en que se GENERÓ cada enlace, no por la
 * de apertura. Es lo que hace que la cohorte sea comparable con la del periodo
 * anterior: «de lo que mandé en mayo, cuánto se abrió», y no «lo que se abrió en
 * mayo», que mezcla envíos de meses distintos.
 *
 * No comprueba de quién es el perfil. Eso lo hace la ruta, que tiene la sesión.
 */
export async function generarInforme(
  db: Db,
  profileId: string,
  opciones: { desde?: number; hasta?: number; ahora?: number } = {}
): Promise<Informe | null> {
  const ahora = opciones.ahora ?? Date.now();
  const hasta = opciones.hasta ?? ahora;
  const desde = opciones.desde ?? hasta - PERIODO_POR_DEFECTO_MS;

  const perfil = await db.one<{
    display_name: string;
    brand_color: string | null;
    logo: string | null;
    plan: string | null;
  }>(
    `SELECT p.display_name, p.brand_color, p.logo, u.plan
     FROM vistta.profiles p
     LEFT JOIN vistta.users u ON u.id = p.owner_id
     WHERE p.id = $1`,
    [profileId]
  );
  if (!perfil) return null;

  const [cifras, extra, apartados, titulos, ficha] = await Promise.all([
    cifrasDe(db, profileId, desde, hasta),
    extrasDe(db, profileId, desde, hasta),
    apartadosDe(db, profileId, desde, hasta),
    titulosDelPerfil(db, profileId),
    fichaDePropiedad(db, profileId),
  ]);

  // El periodo anterior, de la misma longitud y pegado a este. Solo se enseña
  // si entonces hubo algo: «0% respecto a nada» no es una evolución.
  const largo = hasta - desde;
  const anterior = largo > 0 ? await cifrasDe(db, profileId, desde - largo, desde) : null;

  const suficientes = cifras.abiertos >= MINIMO_PARA_PORCENTAJES;
  const porcentaje = (parte: number): number | null =>
    suficientes ? Math.round((parte / cifras.abiertos) * 100) : null;

  const vistos = new Set(apartados.map((a) => a.idx));

  return {
    profileId,
    displayName: perfil.display_name,
    brandColor: perfil.brand_color,
    logo: perfil.logo,
    propiedad:
      ficha === null
        ? null
        : { referencia: ficha.referencia, exclusivaDesde: ficha.exclusivaDesde },
    periodo: { desde, hasta },
    generadoEn: ahora,
    // Del plan, no de una lista escrita aquí: la regla del proyecto es que
    // ninguna decisión de plan vive fuera de `planes.ts`. Un perfil sin dueño
    // cae en el plan más restrictivo, que es el que no mide.
    mideLectura: perfil.plan === null ? false : limitesDe(planDe(perfil.plan)).metricasDeLectura,
    datosSuficientes: suficientes,
    cifras: conPorcentaje(cifras),
    relecturas: extra.relecturas,
    llegaronAlFinal: extra.finales,
    pctFinal: porcentaje(extra.finales),
    apartados: apartados.map((a) => ({
      titulo: a.titulo,
      seccionIdx: a.idx,
      lectores: a.lectores,
      pctLectores: porcentaje(a.lectores),
      msMedio: Number(a.ms_medio),
    })),
    saltados: titulos
      .map((titulo, seccionIdx) => ({ titulo, seccionIdx }))
      .filter((s) => !vistos.has(s.seccionIdx)),
    // El periodo anterior pasa por el MISMO umbral, y por su cuenta: puede
    // tener datos de sobra aunque este no, y al revés. Compararlos es asunto de
    // quien lo lea; darle un porcentaje inventado a uno de los dos, no.
    anterior: anterior !== null && anterior.enviados > 0 ? conPorcentaje(anterior) : null,
  };
}

/**
 * Rellena el porcentaje de apertura, o lo deja en null si no hay datos para
 * decirlo. En un solo sitio: si el umbral se aplicara en cada llamada, tarde o
 * temprano una se lo saltaría.
 */
function conPorcentaje(c: CifrasDelPeriodo): CifrasDelPeriodo {
  if (c.abiertos < MINIMO_PARA_PORCENTAJES || c.enviados === 0) return c;
  return { ...c, pctApertura: Math.round((c.abiertos / c.enviados) * 100) };
}

/**
 * Envíos, aperturas y tiempo medio de una cohorte.
 *
 * `pctApertura` sale a null aquí y lo rellena quien llama, que es el que sabe
 * si se ha superado el umbral. Así no hay dos sitios decidiendo lo mismo.
 */
async function cifrasDe(
  db: Db,
  profileId: string,
  desde: number,
  hasta: number
): Promise<CifrasDelPeriodo> {
  const [envios, tiempo] = await Promise.all([
    db.one<{ enviados: number; abiertos: number }>(
      `SELECT count(*)::int AS enviados,
              count(*) FILTER (WHERE primera_apertura_at IS NOT NULL)::int AS abiertos
       FROM vistta.passes
       WHERE profile_id = $1 AND created_at >= $2 AND created_at < $3`,
      [profileId, desde, hasta]
    ),
    db.one<{ ms: number | null }>(
      // Media POR LECTURA, no media de todos los eventos: dos lecturas de un
      // minuto y una de una hora tienen que dar veintiún minutos, no lo que
      // salga de promediar cientos de tramos de distinto tamaño.
      `SELECT avg(t.ms)::bigint AS ms FROM (
         SELECT e.pass_id, sum(e.ms_visible) AS ms
         FROM vistta.pass_events e
         JOIN vistta.passes p ON p.id = e.pass_id
         WHERE p.profile_id = $1 AND p.created_at >= $2 AND p.created_at < $3
           AND e.tipo = 'seccion'
         GROUP BY e.pass_id
       ) t`,
      [profileId, desde, hasta]
    ),
  ]);

  return {
    enviados: envios?.enviados ?? 0,
    abiertos: envios?.abiertos ?? 0,
    pctApertura: null,
    msMedio: tiempo?.ms === null || tiempo?.ms === undefined ? null : Number(tiempo.ms),
  };
}

/** Relecturas y lecturas completas de la cohorte. */
async function extrasDe(
  db: Db,
  profileId: string,
  desde: number,
  hasta: number
): Promise<{ relecturas: number; finales: number }> {
  const [rel, fin] = await Promise.all([
    db.one<{ n: number }>(
      `SELECT count(*)::int AS n FROM vistta.passes
       WHERE profile_id = $1 AND created_at >= $2 AND created_at < $3 AND accesos_usados > 1`,
      [profileId, desde, hasta]
    ),
    db.one<{ n: number }>(
      `SELECT count(DISTINCT e.pass_id)::int AS n
       FROM vistta.pass_events e
       JOIN vistta.passes p ON p.id = e.pass_id
       WHERE p.profile_id = $1 AND p.created_at >= $2 AND p.created_at < $3
         AND e.tipo = 'final'`,
      [profileId, desde, hasta]
    ),
  ]);
  return { relecturas: rel?.n ?? 0, finales: fin?.n ?? 0 };
}

/**
 * El ranking de apartados. Lo más accionable del informe: si nadie llega a
 * Precio, hay una conversación que tener.
 *
 * Se agrupa por TÍTULO y no por índice, y por eso se guarda el título en el
 * evento. Un informe cruza treinta lecturas de semanas distintas, y en ese
 * plazo el dosier se reordena: agrupar por índice sumaría bajo «apartado 3» lo
 * que unos leyeron en Planos y otros en Precio.
 */
async function apartadosDe(
  db: Db,
  profileId: string,
  desde: number,
  hasta: number
): Promise<FilaDeApartado[]> {
  const { rows } = await db.query<FilaDeApartado & { ms_total: number }>(
    `SELECT max(t.titulo)      AS titulo,
            min(t.idx)::int    AS idx,
            count(*)::int      AS lectores,
            avg(t.ms)::bigint  AS ms_medio,
            sum(t.ms)::bigint  AS ms_total
     FROM (
       SELECT COALESCE(e.seccion_titulo, '#' || e.seccion_idx) AS clave,
              e.seccion_titulo AS titulo,
              e.seccion_idx    AS idx,
              e.pass_id,
              sum(e.ms_visible) AS ms
       FROM vistta.pass_events e
       JOIN vistta.passes p ON p.id = e.pass_id
       WHERE p.profile_id = $1 AND p.created_at >= $2 AND p.created_at < $3
         AND e.tipo = 'seccion' AND e.seccion_idx IS NOT NULL
       GROUP BY 1, 2, 3, 4
     ) t
     GROUP BY t.clave
     ORDER BY ms_total DESC`,
    [profileId, desde, hasta]
  );
  return rows;
}
