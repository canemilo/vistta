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

/**
 * Cómo caduca un pase.
 *
 *   unico   — se abre una vez. Es el modo por defecto y el único que este
 *             producto promete; `docs/11` §7 lo comprueba en cada despliegue.
 *   accesos — hasta N aperturas, y además una ventana desde la primera.
 *   ventana — sin tope de aperturas, válido X tiempo desde la primera.
 */
export type ModoDePase = "unico" | "accesos" | "ventana";

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
  /** Modos de pase que el plan admite. `unico` está en todos. */
  modosDePase: readonly ModoDePase[];
  /** Tope de aperturas en modo `accesos`. `null` = el plan no admite ese modo. */
  maxAccesos: number | null;
  /** Ventana máxima desde la primera apertura. `null` = no admite ventana. */
  ventanaMaxMs: number | null;
  /**
   * Plazo máximo para la PRIMERA apertura en los modos nuevos. El modo `unico`
   * no usa este tope: se queda con el de siempre (`PLAZO_UNICO_MAX_MS`), para
   * que su comportamiento no cambie ni un poco.
   */
  plazoPrimeraAperturaMaxMs: number;
  /**
   * Si el plan registra actividad de lectura del destinatario.
   *
   * Fuera de Prueba a propósito: es donde entra quien viene a mirar el producto,
   * y medir la conducta de lectura de un tercero por defecto, en la cuenta de
   * alguien que solo está probando, es el sitio donde menos aporta y más pesa.
   */
  metricasDeLectura: boolean;
}

/** Aperturas mínimas en modo `accesos`: con una sola, el modo es `unico`. */
export const ACCESOS_MINIMOS = 2;

/** Por debajo de una hora, una ventana no es una ventana: es un solo uso lento. */
export const VENTANA_MINIMA_MS = 60 * 60 * 1000;

/**
 * Ventana que se aplica a un pase de modo `accesos` si no se pide otra.
 *
 * El modo `accesos` la lleva SIEMPRE, y ese es el motivo: sin plazo, un pase de
 * tres accesos que solo se abre una vez sigue siendo abrible para siempre, y la
 * purga no borra los medios de un pase abrible. Ese contenido se quedaría
 * inmovilizado contra la retención del plan, indefinidamente.
 */
export const VENTANA_POR_DEFECTO_MS = 24 * 60 * 60 * 1000;

/** Plazo para la primera apertura del modo `unico`: el de siempre, sin tocar. */
export const PLAZO_UNICO_MAX_MS = 24 * 60 * 60 * 1000;

/** Y el que se aplica por defecto en los modos nuevos, si no se pide otro. */
export const PLAZO_NUEVOS_POR_DEFECTO_MS = 72 * 60 * 60 * 1000;

/**
 * Cuánto se guarda la actividad de lectura de un pase.
 *
 * Treinta días, y es un plazo declarado en `legal/rat.md`: cambiarlo es cambiar
 * el registro de tratamiento, no una constante. Los eventos se van ADEMÁS con
 * su pase (clave ajena en cascada), así que en la práctica manda el que ocurra
 * antes de los dos.
 */
export const RETENCION_EVENTOS_MS = 30 * 24 * 60 * 60 * 1000;

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
    // Solo un uso. Es coherencia técnica antes que comercial: con 7 días de
    // retención, una ventana de 7 días crea pases que sobreviven a su propio
    // contenido. Y de paso es la razón para subir de plan.
    modosDePase: ["unico"],
    maxAccesos: null,
    ventanaMaxMs: null,
    plazoPrimeraAperturaMaxMs: PLAZO_UNICO_MAX_MS,
    metricasDeLectura: false,
  },
  pro: {
    perfiles: 3,
    pasesSimultaneos: 30,
    cuotaPorPerfil: 200 * MB,
    retencionMs: 15 * DIA,
    modosDePase: ["unico", "accesos", "ventana"],
    maxAccesos: 5,
    ventanaMaxMs: 2 * DIA,
    plazoPrimeraAperturaMaxMs: 7 * DIA,
    metricasDeLectura: true,
  },
  boveda: {
    perfiles: 10,
    // Sin límite. No es un número grande: es la ausencia de límite.
    pasesSimultaneos: null,
    cuotaPorPerfil: 1024 * MB,
    // Lo otro que distingue a este plan: la ausencia de plazo, no un plazo largo.
    retencionMs: null,
    modosDePase: ["unico", "accesos", "ventana"],
    maxAccesos: 10,
    // Siete días es el techo DURO de la ventana, en cualquier plan: es la
    // retención del plan más corto, y una ventana más larga que la retención
    // más corta abre la puerta a un pase que sobrevive a sus propias fotos.
    ventanaMaxMs: 7 * DIA,
    plazoPrimeraAperturaMaxMs: 7 * DIA,
    metricasDeLectura: true,
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
