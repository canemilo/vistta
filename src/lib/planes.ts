/**
 * Los planes, y TODAS sus cifras.
 *
 * ============================================================================
 *  ESTE ES EL ÚNICO SITIO DONDE SE TOCAN LOS NÚMEROS DE LOS PLANES.
 *  Las cifras de abajo están marcadas como PROVISIONALES: son un punto de
 *  partida razonable para que el bloque E se pueda probar de punta a punta,
 *  no una decisión de producto. Cámbialas aquí y no hace falta tocar nada más:
 *  ninguna ruta, ningún trabajo de la cola y ninguna consulta llevan un número
 *  escrito a mano.
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
  /** Pases generados y todavía sin abrir ni caducar. */
  pasesSimultaneos: number;
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
 * PROVISIONAL — pendiente de decidir por el cliente.
 * Ver la cabecera del archivo.
 */
export const PLANES: Readonly<Record<Plan, LimitesDePlan>> = Object.freeze({
  prueba: {
    perfiles: 1,
    pasesSimultaneos: 3,
    cuotaPorPerfil: 200 * MB,
    retencionMs: 7 * DIA,
  },
  pro: {
    perfiles: 3,
    pasesSimultaneos: 25,
    cuotaPorPerfil: 200 * MB,
    retencionMs: 14 * DIA,
  },
  boveda: {
    perfiles: 10,
    pasesSimultaneos: 100,
    cuotaPorPerfil: 1024 * MB,
    // Lo que distingue a este plan. No es un número grande: es la ausencia de
    // plazo, y por eso es `null` y no `Infinity`.
    retencionMs: null,
  },
});

/**
 * PROVISIONAL — cuánto sobrevive un perfil congelado antes de borrarse.
 *
 * Es el plazo más delicado del proyecto: cuando venza, se borra trabajo del
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
