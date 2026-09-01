/**
 * Los planes, y TODAS sus cifras.
 *
 * ============================================================================
 *  ESTE ES EL ÚNICO SITIO DONDE SE TOCAN LOS NÚMEROS DE LOS PLANES.
 *  Cámbialos aquí y no hace falta tocar nada más: ninguna ruta, ningún trabajo
 *  de la cola y ninguna consulta llevan un número escrito a mano.
 * ============================================================================
 *
 * Lo que SÍ es decisión tomada y no provisional:
 *   - Los tres nombres: prueba, pro, boveda.
 *   - Que «Bóveda» es el plan que NO caduca. De ahí el nombre.
 *   - Que pasarse de un límite nunca borra nada por sorpresa: lo que sobra se
 *     congela, el cliente elige qué deja activo, y solo después de la gracia
 *     se borra.
 */

export type Plan = "prueba" | "pro" | "boveda";

export const PLANES_VALIDOS: readonly Plan[] = ["prueba", "pro", "boveda"] as const;

/** El plan con el que nace una cuenta. */
export const PLAN_POR_DEFECTO: Plan = "prueba";

const MB = 1024 * 1024;
const DIA = 24 * 60 * 60 * 1000;

export interface LimitesDePlan {
  /** Perfiles que pueden estar ACTIVOS a la vez. Los que sobran se congelan. */
  perfiles: number;
  /**
   * Pases generados y todavía sin abrir ni caducar. `null` = sin límite.
   *
   * Mismo criterio que `retencionMs`: «ilimitado» se escribe como ausencia de
   * límite y no como un número muy grande. Un tope enorme sigue siendo un tope,
   * y tarde o temprano alguien lo compara, lo suma o lo divide.
   */
  pasesSimultaneos: number | null;
  /** Bytes de medios por perfil. Cuenta lo confirmado y lo reservado. */
  cuotaPorPerfil: number;
  /**
   * Cuánto se conserva un medio desde que se confirma. `null` = para siempre,
   * que es lo que se paga en Bóveda. Pasado el plazo, el medio se borra del
   * almacenamiento y de la base: el contenido de este producto es volátil a
   * propósito, no es un disco duro.
   */
  retencionMs: number | null;
}

/**
 * Cifras fijadas por el cliente el 2026-09-01.
 *
 * Un aviso para quien las cambie: la cuota de Prueba (70 MB) es menor que la
 * suma de dos vídeos al máximo permitido (50 MB cada uno). Es coherente —en ese
 * plan cabe un vídeo y poco más—, pero si alguna vez se sube el tope de vídeo
 * por encima de la cuota de un plan, ese plan se queda sin poder aceptar un
 * solo vídeo. Los topes por tipo están en `sniff.ts`.
 */
export const PLANES: Readonly<Record<Plan, LimitesDePlan>> = Object.freeze({
  prueba: {
    perfiles: 1,
    pasesSimultaneos: 5,
    cuotaPorPerfil: 70 * MB,
    retencionMs: 7 * DIA,
  },
  pro: {
    perfiles: 3,
    pasesSimultaneos: 30,
    cuotaPorPerfil: 200 * MB,
    retencionMs: 15 * DIA,
  },
  boveda: {
    perfiles: 10,
    // Sin límite. No es un número grande: es la ausencia de límite.
    pasesSimultaneos: null,
    cuotaPorPerfil: 1024 * MB,
    // Lo otro que distingue a este plan: la ausencia de plazo, no un plazo largo.
    retencionMs: null,
  },
});

/**
 * Cuánto sobrevive un perfil congelado antes de borrarse.
 *
 * PROVISIONAL: es el único plazo que el cliente todavía no ha fijado, y el más
 * delicado del proyecto: cuando venza, se borra trabajo del
 * cliente y no hay vuelta atrás. Está puesto largo a propósito. Si dudas entre
 * dos cifras, coge la mayor: un mes de más cuesta unos megabytes, y un mes de
 * menos cuesta el contenido de alguien.
 */
export const GRACIA_CONGELADO_MS = 30 * DIA;

/** Cuánto antes de que venza la gracia se avisa en el panel. */
export const AVISO_CONGELADO_MS = 7 * DIA;

export function limitesDe(plan: Plan): LimitesDePlan {
  return PLANES[plan];
}

/**
 * Normaliza lo que venga de la base. Una fila con un plan que ya no existe
 * (renombrado, retirado) no puede tumbar el panel de nadie: cae al plan más
 * restrictivo, que es el que no regala nada.
 */
export function planDe(valor: unknown): Plan {
  return PLANES_VALIDOS.includes(valor as Plan) ? (valor as Plan) : PLAN_POR_DEFECTO;
}

// ---------------------------------------------------------------------------
// Facturación manual (bloque F)
// ---------------------------------------------------------------------------

export type Periodo = "mensual" | "anual";

export const PERIODOS: readonly Periodo[] = ["mensual", "anual"] as const;

/** Cuánto dura cada periodo. Un mes son 30 días: no se factura por calendario. */
export const DURACION_PERIODO_MS: Readonly<Record<Periodo, number>> = Object.freeze({
  mensual: 30 * DIA,
  anual: 365 * DIA,
});

/**
 * PRECIOS EN CÉNTIMOS — PENDIENTES DE DECIDIR.
 *
 * Están puestos para que el circuito se pueda probar de punta a punta, no como
 * decisión comercial. Cámbialos aquí y ya está: el importe de un pago se
 * congela al generar el código, así que tocar esta tabla no altera lo que ya se
 * pidió cobrar.
 *
 * En céntimos y enteros a propósito: un importe en coma flotante acaba
 * cobrando 11,999999 €.
 *
 * `prueba` vale 0 porque no se vende: es donde cae una cuenta cuando su plan
 * vence. Aparece en la tabla para que no haya un plan sin precio, no para que
 * alguien lo compre.
 */
export const PRECIOS: Readonly<Record<Plan, Record<Periodo, number>>> = Object.freeze({
  prueba: { mensual: 0, anual: 0 },
  pro: { mensual: 1200, anual: 12000 },
  boveda: { mensual: 2900, anual: 29000 },
});

/** Los planes que se pueden comprar. El de prueba no se vende. */
export const PLANES_DE_PAGO: readonly Plan[] = ["pro", "boveda"] as const;

/** Cuánto vale un código de pago sin usar. Pasado el plazo se anula solo. */
export const CADUCIDAD_CODIGO_MS = 14 * DIA;

/** Con cuánta antelación se avisa al cliente de que su plan vence. */
export const AVISO_VENCIMIENTO_MS = 7 * DIA;

/** A dónde cae una cuenta cuando su plan vence. No se borra nada: baja de plan. */
export const PLAN_AL_VENCER: Plan = "prueba";

export function precioDe(plan: Plan, periodo: Periodo): number {
  return PRECIOS[plan][periodo];
}

export function esPlanDePago(plan: Plan): boolean {
  return PLANES_DE_PAGO.includes(plan);
}
