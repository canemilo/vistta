import type { Db } from "../db";

/**
 * Solicitudes de contraseña nueva.
 *
 * El cliente pide, un administrador comprueba quién es FUERA del sistema y le
 * genera una temporal con el reinicio que ya existía desde el bloque F.
 *
 * Por qué no hay recuperación por correo: no se almacena el correo de los
 * clientes. No es un olvido, es una propiedad declarada del sistema —está en
 * `legal/rat.md` y en la política de privacidad—, y montarla obligaría a
 * guardar contacto, verificarlo, contratar un proveedor de envío y rehacer esos
 * documentos. Para un MVP que ya crea cuentas y concilia pagos a mano, la
 * bandeja es lo coherente.
 *
 * **La solicitud no autoriza nada.** Solo dice «alguien dice haber perdido el
 * acceso a esta cuenta». Quien decide es el administrador, y quien comprueba la
 * identidad es él, por el mismo canal por el que entregó la cuenta. Es el mismo
 * criterio que el código de pago: el código no cobra, lo cobra una persona.
 */

/**
 * Registra la solicitud. Devuelve siempre `undefined`: la ruta responde lo
 * mismo exista o no la cuenta, para que esto no sirva de buscador de usuarios.
 *
 * Si ya había una abierta no crea otra, solo la refresca: pulsar el botón
 * cincuenta veces no puede llenar la bandeja de la misma petición.
 */
export async function pedirClaveNueva(db: Db, userId: string, ahora = Date.now()): Promise<void> {
  await db.query(
    `INSERT INTO vistta.password_requests (id, user_id, status, created_at)
     SELECT $1, u.id, 'pendiente', $2 FROM vistta.users u WHERE u.id = $3
     ON CONFLICT (user_id) WHERE status = 'pendiente'
     DO UPDATE SET created_at = EXCLUDED.created_at`,
    [`sol_${crypto.randomUUID()}`, ahora, userId]
  );
}

/** Cuentas con una solicitud abierta, para marcarlas en el panel. */
export async function solicitudesAbiertas(db: Db): Promise<Map<string, number>> {
  const { rows } = await db.query<{ user_id: string; created_at: number }>(
    `SELECT user_id, created_at FROM vistta.password_requests WHERE status = 'pendiente'`
  );
  return new Map(rows.map((r) => [r.user_id, r.created_at]));
}

/**
 * Cierra la solicitud abierta de una cuenta.
 *
 * `resuelta` la usa el reinicio de contraseña: atender la petición ES cerrarla,
 * así que el administrador no tiene que acordarse de un segundo clic. Un paso
 * que hay que recordar es un paso que se olvida, y la marca se quedaría puesta
 * para siempre sobre una cuenta ya atendida.
 */
export async function cerrarSolicitud(
  db: Db,
  userId: string,
  adminId: string,
  estado: "resuelta" | "descartada",
  ahora = Date.now()
): Promise<boolean> {
  const res = await db.query(
    `UPDATE vistta.password_requests
        SET status = $1, resolved_at = $2, resolved_by = $3
      WHERE user_id = $4 AND status = 'pendiente'`,
    [estado, ahora, adminId, userId]
  );
  return res.rowCount > 0;
}
