import type { Db } from "../db";

/**
 * Cola de trabajos sobre Postgres.
 *
 * No hace falta Redis para cuatro tareas, y meterlo añadiría un sistema más que
 * puede estar caído cuando la base no lo está. Lo que sí hace falta es que dos
 * trabajadores no se coman el mismo trabajo, y eso lo resuelve
 * `FOR UPDATE SKIP LOCKED`: cada uno se lleva una fila distinta y ninguno espera
 * al de al lado.
 */

export interface Trabajo {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Tras estos intentos el trabajo se da por perdido y deja de reintentarse. */
export const MAX_INTENTOS = 5;

export async function encolar(
  db: Db,
  kind: string,
  payload: Record<string, unknown> = {},
  runAfter = Date.now()
): Promise<string> {
  const id = crypto.randomUUID();
  const ahora = Date.now();
  await db.query(
    `INSERT INTO vistta.jobs (id, kind, payload, status, run_after, created_at, updated_at)
     VALUES ($1, $2, $3::jsonb, 'pending', $4, $5, $5)`,
    [id, kind, JSON.stringify(payload), runAfter, ahora]
  );
  return id;
}

/**
 * Toma UN trabajo, o null si no hay ninguno listo.
 *
 * Es una sola sentencia a propósito. La subconsulta bloquea la fila candidata y
 * salta las que ya tenga otro trabajador; el UPDATE de fuera la marca como
 * tomada en el mismo paso. Hacerlo en dos —leer y luego marcar— es exactamente
 * el error que en el consumo del pase producía un verde falso: entre la lectura
 * y la escritura cabe otro trabajador entero.
 */
export async function tomarTrabajo(db: Db, ahora = Date.now()): Promise<Trabajo | null> {
  const fila = await db.one<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
    attempts: number;
  }>(
    `UPDATE vistta.jobs
     SET status = 'running', attempts = attempts + 1, updated_at = $1
     WHERE id = (
       SELECT id FROM vistta.jobs
       WHERE status = 'pending' AND run_after <= $1
       ORDER BY run_after, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, kind, payload, attempts`,
    [ahora]
  );
  return fila ?? null;
}

export async function completar(db: Db, id: string): Promise<void> {
  await db.query(`UPDATE vistta.jobs SET status = 'done', updated_at = $1 WHERE id = $2`, [
    Date.now(),
    id,
  ]);
}

/**
 * Devuelve el trabajo a la cola con espera creciente, o lo entierra si ya ha
 * agotado los intentos. El mensaje del error se guarda recortado: puede traer
 * rutas o identificadores, y esta tabla no es sitio para PII.
 */
export async function fallar(db: Db, trabajo: Trabajo, err: unknown): Promise<void> {
  const motivo = (err instanceof Error ? err.name : "error").slice(0, 120);
  const agotado = trabajo.attempts >= MAX_INTENTOS;
  const espera = Math.min(2 ** trabajo.attempts, 60) * 1000;
  await db.query(
    `UPDATE vistta.jobs
     SET status = $1, run_after = $2, updated_at = $3, last_error = $4
     WHERE id = $5`,
    [agotado ? "failed" : "pending", Date.now() + espera, Date.now(), motivo, trabajo.id]
  );
}
