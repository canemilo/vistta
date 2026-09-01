import type { Db } from "../db";
import { cambiarPlan } from "./congelado";
import {
  CADUCIDAD_CODIGO_MS,
  DURACION_PERIODO_MS,
  PLAN_AL_VENCER,
  esPlanDePago,
  precioDe,
  type Periodo,
  type Plan,
} from "./planes";

/**
 * Facturación manual.
 *
 * No hay pasarela de pago. El cliente pide un plan, el sistema le da un código
 * —VISTTA-XXXXXX—, él lo escribe en el concepto de un Bizum o un PayPal, y una
 * persona coteja el extracto y lo da por cobrado. Todo el módulo existe para
 * que ese ida y vuelta deje rastro y no dependa de que alguien se acuerde.
 *
 * Dos cosas que conviene tener claras desde el principio:
 *
 *   1. **El código no autoriza nada.** Viaja en el concepto de una
 *      transferencia: lo ve el banco y puede acabar en una captura de pantalla.
 *      Confirmar un pago es una acción de administrador; el código solo dice a
 *      qué cuenta corresponde un ingreso que ya se ha visto en el extracto.
 *   2. **El importe se congela al pedirlo.** Si mañana suben los precios, quien
 *      pidió el código ayer paga lo que se le dijo. Por eso `payments.importe`
 *      es una columna y no una consulta a la tabla de precios.
 */

/** Mismo alfabeto que las contraseñas temporales: se dicta y se teclea a mano. */
const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789";

export class PlanNoVendibleError extends Error {}
export class CuentaNoEncontradaError extends Error {}

export interface Pago {
  id: string;
  code: string;
  userId: string;
  plan: Plan;
  periodo: Periodo;
  importe: number;
  moneda: string;
  status: "pendiente" | "cobrado" | "anulado";
  expiresAt: number;
  createdAt: number;
  confirmedAt: number | null;
  confirmedBy: string | null;
  metodo: string | null;
  nota: string | null;
}

const COLUMNAS = `id, code, user_id AS "userId", plan, periodo, importe, moneda, status,
  expires_at AS "expiresAt", created_at AS "createdAt", confirmed_at AS "confirmedAt",
  confirmed_by AS "confirmedBy", metodo, nota`;

function codigo(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const tope = 256 - (256 % ALFABETO.length);
  const letras: string[] = [];
  for (const b of bytes) {
    if (b >= tope || letras.length >= 6) continue;
    letras.push(ALFABETO[b % ALFABETO.length]);
  }
  // Si el rechazo dejó corto el código, se rellena con otra tanda. Pasa poco y
  // repetir es más barato que sesgar el alfabeto para no repetir.
  while (letras.length < 6) {
    const extra = new Uint8Array(1);
    crypto.getRandomValues(extra);
    if (extra[0] < tope) letras.push(ALFABETO[extra[0] % ALFABETO.length]);
  }
  return `VISTTA-${letras.join("").toUpperCase()}`;
}

/**
 * Crea la solicitud de pago y devuelve el código.
 *
 * Solo hay UNA solicitud viva por cuenta: pedir otra anula la anterior. Es lo
 * que espera cualquiera que cambie de idea entre mensual y anual, y evita que
 * un cliente pague un código de hace tres semanas mientras hay otro en pie.
 */
export async function solicitarPago(
  db: Db,
  userId: string,
  plan: Plan,
  periodo: Periodo
): Promise<Pago> {
  if (!esPlanDePago(plan)) throw new PlanNoVendibleError(plan);

  const cuenta = await db.one<{ id: string }>(`SELECT id FROM vistta.users WHERE id = $1`, [
    userId,
  ]);
  if (!cuenta) throw new CuentaNoEncontradaError(userId);

  const ahora = Date.now();
  return db.tx(async (tx) => {
    await tx.query(
      `UPDATE vistta.payments SET status = 'anulado'
       WHERE user_id = $1 AND status = 'pendiente'`,
      [userId]
    );

    // Reintento por si el código chocara: el índice único es la única autoridad
    // sobre si un código está libre, no una consulta previa que otro puede
    // adelantar entre la lectura y la inserción.
    for (let intento = 0; intento < 5; intento++) {
      try {
        const fila = await tx.one<Pago>(
          `INSERT INTO vistta.payments
             (id, code, user_id, plan, periodo, importe, status, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'pendiente', $7, $8)
           RETURNING ${COLUMNAS}`,
          [
            crypto.randomUUID(),
            codigo(),
            userId,
            plan,
            periodo,
            precioDe(plan, periodo),
            ahora + CADUCIDAD_CODIGO_MS,
            ahora,
          ]
        );
        if (fila) return fila;
      } catch (err) {
        // 23505 = violación de unicidad. Cualquier otro error no es cosa nuestra.
        if ((err as { code?: string }).code !== "23505") throw err;
      }
    }
    throw new Error("no se pudo generar un código de pago libre");
  });
}

/** La solicitud viva de una cuenta, si la hay y no ha caducado. */
export async function pagoPendiente(
  db: Db,
  userId: string,
  ahora = Date.now()
): Promise<Pago | null> {
  return db.one<Pago>(
    `SELECT ${COLUMNAS} FROM vistta.payments
     WHERE user_id = $1 AND status = 'pendiente' AND expires_at > $2
     ORDER BY created_at DESC LIMIT 1`,
    [userId, ahora]
  );
}

export async function pagoPorCodigo(db: Db, code: string): Promise<Pago | null> {
  return db.one<Pago>(`SELECT ${COLUMNAS} FROM vistta.payments WHERE code = $1`, [code]);
}

export interface ResultadoConfirmacion {
  pago: Pago;
  planHasta: number;
}

/**
 * Da un pago por cobrado y activa el plan.
 *
 * La fecha de vencimiento ENCADENA: si a la cuenta le quedaban tres semanas, el
 * periodo nuevo empieza cuando acaben esas tres semanas, no hoy. Pagar antes de
 * tiempo no puede castigar al que paga antes de tiempo.
 *
 * Va en transacción con el pago bloqueado: dos confirmaciones simultáneas del
 * mismo código sumarían el periodo dos veces, y eso es dinero.
 */
export async function confirmarPago(
  db: Db,
  code: string,
  quien: string,
  opciones: { metodo?: string; nota?: string; ahora?: number } = {}
): Promise<ResultadoConfirmacion | null> {
  const ahora = opciones.ahora ?? Date.now();

  const resultado = await db.tx(async (tx) => {
    const pago = await tx.one<Pago>(
      `SELECT ${COLUMNAS} FROM vistta.payments
       WHERE code = $1 AND status = 'pendiente' FOR UPDATE`,
      [code]
    );
    if (!pago) return null;

    const cuenta = await tx.one<{ plan: string; plan_until: number | null }>(
      `SELECT plan, plan_until FROM vistta.users WHERE id = $1`,
      [pago.userId]
    );
    if (!cuenta) return null;

    // Se encadena solo si la cuenta sigue en el MISMO plan y no ha vencido.
    // Cambiar de Pro a Bóveda no arrastra los días de Pro: son otro producto.
    const restante =
      cuenta.plan === pago.plan && cuenta.plan_until !== null && cuenta.plan_until > ahora
        ? cuenta.plan_until
        : ahora;
    const planHasta = restante + DURACION_PERIODO_MS[pago.periodo];

    const confirmado = await tx.one<Pago>(
      `UPDATE vistta.payments
       SET status = 'cobrado', confirmed_at = $1, confirmed_by = $2, metodo = $3, nota = $4
       WHERE id = $5 AND status = 'pendiente'
       RETURNING ${COLUMNAS}`,
      [ahora, quien, opciones.metodo ?? null, opciones.nota ?? null, pago.id]
    );
    if (!confirmado) return null;

    await tx.query(`UPDATE vistta.users SET plan_until = $1 WHERE id = $2`, [
      planHasta,
      pago.userId,
    ]);
    return { pago: confirmado, planHasta };
  });

  if (!resultado) return null;

  // El cambio de plan va FUERA de la transacción a propósito: `cambiarPlan`
  // abre la suya para congelar y descongelar perfiles, y anidarlas no está
  // soportado (ver db.ts). Si fallara aquí, el pago queda cobrado y el plan sin
  // aplicar, que se arregla desde el panel; al revés —plan dado y pago sin
  // constancia— no se arregla, porque no queda rastro de por qué se dio.
  await cambiarPlan(db, resultado.pago.userId, resultado.pago.plan);
  return resultado;
}

export async function anularPago(db: Db, code: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE vistta.payments SET status = 'anulado' WHERE code = $1 AND status = 'pendiente'`,
    [code]
  );
  return res.rowCount === 1;
}

export async function listarPagos(db: Db, limite = 200): Promise<Pago[]> {
  const { rows } = await db.query<Pago>(
    `SELECT ${COLUMNAS} FROM vistta.payments
     -- Lo pendiente primero: es lo que hay que cotejar con el extracto.
     ORDER BY (status = 'pendiente') DESC, created_at DESC
     LIMIT $1`,
    [limite]
  );
  return rows;
}

/**
 * Baja de plan a las cuentas cuyo periodo ha vencido.
 *
 * Vencer NO borra nada: pasa a `prueba` y deja que el bloque E haga lo suyo
 * —congelar los perfiles que sobren, que siguen ahí y se pueden rescatar
 * pagando—. Lo irreversible sigue siendo el tiempo, no el impago.
 */
export async function aplicarVencimientos(db: Db, ahora = Date.now()): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM vistta.users
     WHERE plan_until IS NOT NULL AND plan_until <= $1 AND plan <> $2`,
    [ahora, PLAN_AL_VENCER]
  );

  for (const fila of rows) {
    await cambiarPlan(db, fila.id, PLAN_AL_VENCER);
    // Se limpia la fecha: la cuenta ya no tiene periodo pagado, y dejarla
    // puesta la haría vencer otra vez en cada pasada.
    await db.query(`UPDATE vistta.users SET plan_until = NULL WHERE id = $1`, [fila.id]);
  }
  return rows.map((r) => r.id);
}

/** Anula los códigos que nadie pagó dentro de su plazo. */
export async function caducarCodigos(db: Db, ahora = Date.now()): Promise<number> {
  const res = await db.query(
    `UPDATE vistta.payments SET status = 'anulado'
     WHERE status = 'pendiente' AND expires_at <= $1`,
    [ahora]
  );
  return res.rowCount;
}
