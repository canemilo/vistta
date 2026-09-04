import type { Db } from "../db";
import type { Storage } from "../storage/port";
import { hashPassword, COSTE_POR_DEFECTO, type CosteArgon2 } from "./password";
import { cambiarPlan } from "./congelado";
import { vencimientoTras } from "./facturacion";
import { esPlanDePago, type Periodo, type Plan } from "./planes";

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

/**
 * Todo lo que un administrador puede hacer, en una lista y no en una unión de
 * cadenas suelta.
 *
 * Es una lista porque hay que RECORRERLA: el filtro del registro la valida y el
 * panel la ofrece como desplegable. Con la unión de tipos, esos dos sitios
 * habrían acabado con su propia copia escrita a mano, y la copia se queda vieja
 * en cuanto alguien añade una acción aquí.
 */
export const ACCIONES_ADMIN = [
  "crear_cuenta",
  "editar_cuenta",
  "cambiar_plan",
  "reiniciar_password",
  "suspender",
  "reactivar",
  "borrar_cuenta",
  "cobrar_pago",
  "anular_pago",
  "descartar_solicitud",
] as const;

export type AccionAdmin = (typeof ACCIONES_ADMIN)[number];

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
  /** Hasta cuándo tiene pagado. `null` = sin plazo (Prueba, o Bóveda sin vencer). */
  planHasta: number | null;
  /** El código sin cobrar, si lo hay: lo que el administrador coteja con el extracto. */
  pagoPendiente: { codigo: string; importe: number; plan: string; caduca: number } | null;
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

/** Una línea del registro, tal y como se sirve. */
export interface RegistroAuditoria {
  id: string;
  adminId: string;
  accion: string;
  objetivo: string | null;
  detalle: Record<string, unknown>;
  createdAt: number;
}

export interface FiltroAuditoria {
  /** Franja cerrada por abajo y abierta por arriba: `[desde, hasta)`. */
  desde?: number | null;
  hasta?: number | null;
  accion?: string | null;
  objetivo?: string | null;
  /** Cursor: la página siguiente empieza ANTES de este instante. */
  antes?: number | null;
  limite?: number;
}

/** Cuántas líneas se sirven de una vez. Más que esto no se lee, se escanea. */
export const AUDITORIA_POR_PAGINA = 50;

/**
 * El registro, filtrado.
 *
 * Nació devolviendo las últimas 200 líneas sin más, y con eso se puede
 * responder a «¿qué acaba de pasar?» pero no a ninguna de las preguntas que
 * de verdad se le hacen a un registro: qué se hizo el martes, quién ha tocado
 * esta cuenta, cuándo se cobró aquello. Una lista sin fin tampoco es un
 * registro: es un sitio donde no se encuentra nada.
 *
 * El corte va por INSTANTE y no por número de página. Con OFFSET, un apunte
 * nuevo entre dos peticiones desplaza toda la lista y la página siguiente
 * repite una línea o se salta otra; aquí cada página continúa exactamente donde
 * acabó la anterior, aunque entretanto se haya escrito algo.
 *
 * `hayMas` se calcula pidiendo UNA fila de más y descartándola. Sin eso, la
 * única forma de saber si quedan más es un `count(*)` de toda la tabla en cada
 * página.
 */
export async function listarAuditoria(
  db: Db,
  filtro: FiltroAuditoria = {}
): Promise<{ registros: RegistroAuditoria[]; hayMas: boolean }> {
  const condiciones: string[] = [];
  const valores: unknown[] = [];
  const parametro = (valor: unknown): string => {
    valores.push(valor);
    return `$${valores.length}`;
  };

  // `?? null` primero: así un campo ausente y uno puesto a null se tratan
  // igual, sin que la condición dependa de cuál de los dos llegó.
  const desde = filtro.desde ?? null;
  const hasta = filtro.hasta ?? null;
  const antes = filtro.antes ?? null;

  if (desde !== null) condiciones.push(`created_at >= ${parametro(desde)}`);
  if (hasta !== null) condiciones.push(`created_at < ${parametro(hasta)}`);
  if (filtro.accion) condiciones.push(`accion = ${parametro(filtro.accion)}`);
  if (filtro.objetivo) condiciones.push(`objetivo = ${parametro(filtro.objetivo)}`);
  if (antes !== null) condiciones.push(`created_at < ${parametro(antes)}`);

  const limite = Math.min(Math.max(filtro.limite ?? AUDITORIA_POR_PAGINA, 1), 200);
  const donde = condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";

  const { rows } = await db.query<RegistroAuditoria>(
    `SELECT id, admin_id AS "adminId", accion, objetivo, detalle,
            created_at AS "createdAt"
       FROM vistta.admin_audit
       ${donde}
      ORDER BY created_at DESC, id DESC
      LIMIT ${parametro(limite + 1)}`,
    valores
  );

  return { registros: rows.slice(0, limite), hayMas: rows.length > limite };
}

/**
 * Qué días tienen apuntes, y cuántos.
 *
 * Es lo que llena el selector de fechas del panel: se ofrecen SOLO los días en
 * los que pasó algo. Un calendario donde la mayoría de los días están vacíos
 * obliga a ir probando fechas a ciegas hasta dar con una que tenga algo.
 *
 * El día se corta en la zona horaria de quien mira, que llega desde el
 * navegador. Con UTC fijo, todo lo hecho de noche en España aparecería fechado
 * al día siguiente y el registro contradiría al reloj de quien lo escribió.
 * La zona se valida contra el catálogo de PostgreSQL DENTRO de la consulta: un
 * nombre inventado cae en UTC en vez de reventar la petición.
 */
export async function diasConAuditoria(
  db: Db,
  zona = "UTC",
  limite = 120
): Promise<{ dia: string; total: number }[]> {
  const { rows } = await db.query<{ dia: string; total: number }>(
    `SELECT to_char(
              to_timestamp(created_at / 1000.0)
                AT TIME ZONE COALESCE((SELECT name FROM pg_timezone_names WHERE name = $1), 'UTC'),
              'YYYY-MM-DD'
            )                AS dia,
            count(*)::int    AS total
       FROM vistta.admin_audit
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT $2`,
    [zona, limite]
  );
  return rows;
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
    plan_until: number | null;
    pago_codigo: string | null;
    pago_importe: number | null;
    pago_plan: string | null;
    pago_caduca: number | null;
  }>(
    `SELECT u.id, u.display_name, u.plan, u.status, u.role, u.created_at, u.suspended_at,
       -- Hasta cuándo tiene pagado. NULL en Prueba y en Bóveda de por vida.
       u.plan_until,
       -- El código pendiente, si lo hay: es lo que el administrador cotejará
       -- contra el extracto. Uno por cuenta, el más reciente sin cobrar.
       (SELECT pg.code FROM vistta.payments pg
         WHERE pg.user_id = u.id AND pg.status = 'pendiente' AND pg.expires_at > $1
         ORDER BY pg.created_at DESC LIMIT 1)      AS pago_codigo,
       (SELECT pg.importe FROM vistta.payments pg
         WHERE pg.user_id = u.id AND pg.status = 'pendiente' AND pg.expires_at > $1
         ORDER BY pg.created_at DESC LIMIT 1)      AS pago_importe,
       (SELECT pg.plan FROM vistta.payments pg
         WHERE pg.user_id = u.id AND pg.status = 'pendiente' AND pg.expires_at > $1
         ORDER BY pg.created_at DESC LIMIT 1)      AS pago_plan,
       (SELECT pg.expires_at FROM vistta.payments pg
         WHERE pg.user_id = u.id AND pg.status = 'pendiente' AND pg.expires_at > $1
         ORDER BY pg.created_at DESC LIMIT 1)      AS pago_caduca,
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
    planHasta: r.plan_until === null ? null : Number(r.plan_until),
    pagoPendiente:
      r.pago_codigo === null
        ? null
        : {
            codigo: r.pago_codigo,
            importe: Number(r.pago_importe),
            plan: r.pago_plan!,
            caduca: Number(r.pago_caduca),
          },
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

/**
 * Cambia el plan de una cuenta Y le pone su fecha de vencimiento.
 *
 * Las dos cosas juntas, y esa es la corrección: antes esto solo tocaba el plan,
 * así que un plan concedido a mano nacía SIN plazo. En la tabla salía «sin
 * plazo» y en la práctica era un Pro o un Bóveda de por vida, regalado por
 * accidente: nadie lo veía vencer, nadie lo perseguía y `aplicarVencimientos`
 * ni lo miraba, porque solo mira las filas que tienen fecha.
 *
 * Ahora conceder un plan de pago es conceder UN PERIODO, exactamente igual que
 * cobrarlo. La cuenta atrás empieza al cambiar y el vencimiento lo calcula
 * `vencimientoTras`, la misma función que usa la confirmación de un pago: si el
 * plan no cambia, encadena en vez de recortar.
 *
 * `prueba` es el otro lado de la misma moneda: **no tiene plazo de plan, y por
 * eso se le BORRA la fecha**. No es que no caduque; es que lo que caduca ahí es
 * el contenido, a los 7 días, por retención (`lib/purga.ts`). Dejarle una fecha
 * heredada del plan anterior la haría vencer otra vez en cada pasada.
 *
 * El orden importa: primero el plan —`cambiarPlan` abre su propia transacción
 * para congelar y descongelar perfiles, y anidarlas no está soportado (ver
 * db.ts)—, y después la fecha. Si fallara lo segundo, la cuenta se queda con el
 * plan puesto y sin plazo, que es exactamente el estado de antes de este
 * cambio y se arregla volviendo a asignar el plan. Al revés —fecha sin plan—
 * sería una cuenta a la que se le cobra un tiempo que no tiene.
 */
export async function asignarPlan(
  db: Db,
  userId: string,
  plan: Plan,
  opciones: { periodo?: Periodo; ahora?: number } = {}
): Promise<boolean> {
  const cuenta = await db.one<{ plan: Plan; plan_until: string | number | null }>(
    `SELECT plan, plan_until FROM vistta.users WHERE id = $1`,
    [userId]
  );
  if (!cuenta) return false;

  const ahora = opciones.ahora ?? Date.now();
  const vencimiento = cuenta.plan_until === null ? null : Number(cuenta.plan_until);
  const hasta = esPlanDePago(plan)
    ? vencimientoTras(cuenta.plan, plan, vencimiento, opciones.periodo ?? "mensual", ahora)
    : null;

  await cambiarPlan(db, userId, plan);
  await db.query(`UPDATE vistta.users SET plan_until = $1 WHERE id = $2`, [hasta, userId]);
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
