import type { Db } from "../db";
import type { Storage } from "../storage/port";
import { hashPassword, COSTE_POR_DEFECTO, type CosteArgon2 } from "./password";
import { cambiarPlan } from "./congelado";
import type { Plan } from "./planes";

/**
 * Gestión de cuentas por un administrador.
 *
 * Este módulo es la excepción a la regla que sostiene todo lo demás: aquí las
 * consultas NO llevan `owner_id`. Un administrador ve todas las cuentas. Por
 * eso conviene tener presentes los tres límites que se le ponen:
 *
 *   1. **No ve contenido.** No hay ninguna función aquí que devuelva perfiles,
 *      medios ni pases de un cliente. Gestiona cuentas: quién existe, qué plan
 *      tiene, cuánto ocupa. Vistta es encargado del tratamiento (RGPD art. 28),
 *      y un panel que deje pasear por las carpetas de los clientes convierte a
 *      cualquiera con la contraseña en un problema de cumplimiento.
 *   2. **No lee contraseñas.** No puede: solo hay hashes. Lo más que hace es
 *      poner una temporal y enseñarla UNA vez, al que la ha generado.
 *   3. **Deja rastro de todo.** Cada operación escribe en `admin_audit`.
 */

export type AccionAdmin =
  | "crear_cuenta"
  | "editar_cuenta"
  | "cambiar_plan"
  | "reiniciar_password"
  | "suspender"
  | "reactivar"
  | "borrar_cuenta"
  | "cobrar_pago"
  | "anular_pago"
  | "descartar_solicitud";

/** Resumen de una cuenta para la tabla del panel. Sin una línea de contenido. */
export interface CuentaAdmin {
  id: string;
  displayName: string;
  plan: Plan;
  status: "activa" | "suspendida";
  role: "cliente" | "admin";
  createdAt: number;
  suspendedAt: number | null;
  perfilesActivos: number;
  perfilesCongelados: number;
  pasesAbiertos: number;
  bytesUsados: number;
  /** Cuándo pidió una contraseña nueva, o null si no la ha pedido. */
  clavePedidaEl: number | null;
}

export async function registrar(
  db: Db,
  adminId: string,
  accion: AccionAdmin,
  objetivo: string | null,
  detalle: Record<string, unknown> = {}
): Promise<void> {
  await db.query(
    `INSERT INTO vistta.admin_audit (id, admin_id, accion, objetivo, detalle, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [crypto.randomUUID(), adminId, accion, objetivo, JSON.stringify(detalle), Date.now()]
  );
}

/**
 * Todas las cuentas con sus contadores.
 *
 * Los agregados van en subconsultas y no en JOINs con GROUP BY: con tres tablas
 * que multiplican filas (perfiles, pases, medios) un GROUP BY daría cifras
 * infladas, y son cifras que alguien va a mirar para decidir si cobra o
 * suspende a un cliente.
 */
export async function listarCuentas(db: Db, ahora = Date.now()): Promise<CuentaAdmin[]> {
  const { rows } = await db.query<{
    id: string;
    display_name: string;
    plan: Plan;
    status: "activa" | "suspendida";
    role: "cliente" | "admin";
    created_at: number;
    suspended_at: number | null;
    perfiles_activos: number;
    perfiles_congelados: number;
    pases_abiertos: number;
    bytes_usados: number;
    clave_pedida: number | null;
  }>(
    `SELECT u.id, u.display_name, u.plan, u.status, u.role, u.created_at, u.suspended_at,
       (SELECT count(*)::int FROM vistta.profiles p
         WHERE p.owner_id = u.id AND p.status = 'activo')     AS perfiles_activos,
       (SELECT count(*)::int FROM vistta.profiles p
         WHERE p.owner_id = u.id AND p.status = 'congelado')  AS perfiles_congelados,
       (SELECT count(*)::int FROM vistta.passes ps
          JOIN vistta.profiles p ON p.id = ps.profile_id
         WHERE p.owner_id = u.id AND ps.status = 'pending'
           AND ps.expires_at > $1)                            AS pases_abiertos,
       (SELECT COALESCE(SUM(m.bytes), 0)::bigint FROM vistta.media m
          JOIN vistta.profiles p ON p.id = m.profile_id
         WHERE p.owner_id = u.id AND m.status <> 'failed')    AS bytes_usados,
       -- Quién ha pedido contraseña nueva. Va en la misma consulta y no en una
       -- lista aparte: el administrador ya mira esta tabla, y la petición se
       -- atiende con el botón que ya está en esa fila.
       (SELECT pr.created_at FROM vistta.password_requests pr
         WHERE pr.user_id = u.id AND pr.status = 'pendiente')  AS clave_pedida
     FROM vistta.users u
     ORDER BY u.created_at DESC`,
    [ahora]
  );

  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    plan: r.plan,
    status: r.status,
    role: r.role,
    createdAt: r.created_at,
    suspendedAt: r.suspended_at,
    perfilesActivos: r.perfiles_activos,
    perfilesCongelados: r.perfiles_congelados,
    pasesAbiertos: r.pases_abiertos,
    bytesUsados: r.bytes_usados,
    clavePedidaEl: r.clave_pedida,
  }));
}

/**
 * Alfabeto sin parejas que se confundan al dictar una contraseña por teléfono:
 * fuera la `l`, la `i` y el `1`; fuera la `o` y el `0`. Todo en minúscula, para
 * que tampoco haya que decir «be de burro mayúscula».
 */
const ALFABETO = "abcdefghjkmnpqrstuvwxyz23456789";

/**
 * Contraseña temporal legible, para dictarla por teléfono o pegarla en un
 * correo. La genera el servidor y se enseña UNA vez a quien la pidió: no se
 * guarda en claro en ningún sitio, así que si se pierde hay que generar otra.
 *
 * Dieciséis caracteres de un alfabeto de 31 son unos 79 bits, de sobra para lo
 * que dura: hasta que el cliente entre y la cambie. Van en grupos de cuatro
 * porque quien la teclea la está leyendo de una pantalla o escuchándola.
 */
export function passwordTemporal(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Rechazo del último tramo incompleto de 256: sin esto, los primeros
  // caracteres del alfabeto saldrían más a menudo que los últimos.
  const tope = 256 - (256 % ALFABETO.length);
  const letras: string[] = [];
  while (letras.length < 16) {
    for (const b of bytes) {
      if (b >= tope || letras.length >= 16) continue;
      letras.push(ALFABETO[b % ALFABETO.length]);
    }
    if (letras.length < 16) crypto.getRandomValues(bytes);
  }

  return letras.join("").replace(/(.{4})(?=.)/g, "$1-");
}

export async function reiniciarPassword(
  db: Db,
  userId: string,
  coste: CosteArgon2 = COSTE_POR_DEFECTO
): Promise<string | null> {
  const temporal = passwordTemporal();
  const res = await db.query(`UPDATE vistta.users SET password_hash = $1 WHERE id = $2`, [
    await hashPassword(temporal, coste),
    userId,
  ]);
  if (res.rowCount !== 1) return null;

  // Todas las sesiones abiertas se caen: si se reinicia la contraseña porque la
  // cuenta está comprometida, dejar viva la sesión del atacante no arregla nada.
  await db.query(`DELETE FROM vistta.panel_sessions WHERE user_id = $1`, [userId]);
  return temporal;
}

/** Suspende una cuenta. Reversible: no se borra nada. */
export async function suspender(db: Db, userId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE vistta.users SET status = 'suspendida', suspended_at = $1
     WHERE id = $2 AND status = 'activa'`,
    [Date.now(), userId]
  );
  if (res.rowCount !== 1) return false;
  // Fuera las sesiones: si no, sigue dentro del panel hasta que caduque el token.
  await db.query(`DELETE FROM vistta.panel_sessions WHERE user_id = $1`, [userId]);
  return true;
}

export async function reactivar(db: Db, userId: string): Promise<boolean> {
  const res = await db.query(
    `UPDATE vistta.users SET status = 'activa', suspended_at = NULL
     WHERE id = $1 AND status = 'suspendida'`,
    [userId]
  );
  return res.rowCount === 1;
}

/** Cambiar de plan pasa por el bloque E: congela o descongela lo que toque. */
export async function asignarPlan(db: Db, userId: string, plan: Plan): Promise<boolean> {
  const existe = await db.one<{ id: string }>(`SELECT id FROM vistta.users WHERE id = $1`, [
    userId,
  ]);
  if (!existe) return false;
  await cambiarPlan(db, userId, plan);
  return true;
}

/**
 * Borrado de verdad, sin vuelta atrás.
 *
 * Existe para una razón concreta: la supresión del art. 17 del RGPD. Cuando un
 * cliente ejerce ese derecho, el plazo no es de treinta días de gracia; es
 * ahora. Para todo lo demás —impago, una cuenta que sobra— está `suspender`,
 * que es reversible y a la que la purga da su plazo.
 *
 * Los bytes se borran del almacenamiento ANTES que las filas: `ON DELETE
 * CASCADE` se lleva perfiles y medios, pero el bucket no sabe nada de claves
 * ajenas, y unos objetos sin fila que los recuerde no los encuentra ya nadie.
 */
export async function borrarCuenta(db: Db, storage: Storage, userId: string): Promise<boolean> {
  const { rows: medios } = await db.query<{ storage_key: string }>(
    `SELECT m.storage_key FROM vistta.media m
     JOIN vistta.profiles p ON p.id = m.profile_id
     WHERE p.owner_id = $1`,
    [userId]
  );
  for (const m of medios) await storage.delete(m.storage_key);

  const res = await db.query(`DELETE FROM vistta.users WHERE id = $1`, [userId]);
  return res.rowCount === 1;
}
