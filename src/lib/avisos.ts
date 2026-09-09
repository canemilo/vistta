import type { Db } from "../db";

/**
 * Avisos al agente. Hoy solo uno: alguien ha vuelto a abrir un dosier.
 *
 * Ese es el momento de llamar, y es la señal que ningún CRM tiene: el CRM sabe
 * a quién se le mandó, no sabe quién volvió el domingo por la noche.
 *
 * LA AGRUPACIÓN ES UN TOPE CON UN CONTADOR, Y POR TANTO TIENE CARRERA. «Si un
 * pase se abre cinco veces, un aviso, no cinco» se implementa en UNA sentencia:
 * el índice único parcial de la 0015 decide y el `ON CONFLICT DO UPDATE`
 * contabiliza, a la vez. Mirar si ya existe y crearlo si no son dos sentencias,
 * y entre las dos caben otras quince reaperturas. Hay prueba de ráfaga de 16,
 * verificada por mutación: partido en dos, se pone rojo.
 */

export type TipoDeAviso = "reapertura";

export interface Aviso {
  id: string;
  profileId: string;
  profileNombre: string;
  passId: string;
  tipo: TipoDeAviso;
  /** Cuántas veces ha vuelto a pasar desde que se creó el aviso. */
  veces: number;
  creadoEn: number;
  ultimoEn: number;
  /**
   * A quién se le mandó el enlace, si el agente lo escribió. Es dato personal
   * de un tercero y solo sale aquí, que es el panel de su dueño; en el informe
   * al propietario NO aparece nunca.
   */
  destinatarioRef: string | null;
  destinatarioNota: string | null;
}

/**
 * Deja constancia de una reapertura.
 *
 * Devuelve `false` si no había a quién avisar: el pase ya no existe, el perfil
 * no tiene dueño, o la cuenta tiene los avisos apagados. La preferencia se
 * comprueba DENTRO de la sentencia y no antes, por lo mismo que todo lo demás:
 * una comprobación aparte es otra sentencia y otra ventana.
 */
export async function registrarAviso(
  db: Db,
  passId: string,
  tipo: TipoDeAviso = "reapertura",
  ahora = Date.now()
): Promise<boolean> {
  const { rowCount } = await db.query(
    `INSERT INTO vistta.avisos
       (id, user_id, profile_id, pass_id, tipo, veces, creado_en, ultimo_en)
     SELECT gen_random_uuid()::text, p.owner_id, p.id, ps.id, $2, 1, $3, $3
     FROM vistta.passes ps
     JOIN vistta.profiles p ON p.id = ps.profile_id
     JOIN vistta.users    u ON u.id = p.owner_id
     WHERE ps.id = $1 AND u.avisos_reapertura AND u.status = 'activa'
     ON CONFLICT (pass_id, tipo) WHERE visto_en IS NULL
     DO UPDATE SET veces = avisos.veces + 1, ultimo_en = EXCLUDED.ultimo_en`,
    [passId, tipo, ahora]
  );
  return rowCount > 0;
}

/** Los avisos sin ver de una cuenta, los más recientes primero. */
export async function avisosPendientes(db: Db, userId: string, limite = 50): Promise<Aviso[]> {
  const { rows } = await db.query<{
    id: string;
    profile_id: string;
    display_name: string;
    pass_id: string;
    tipo: TipoDeAviso;
    veces: number;
    creado_en: number;
    ultimo_en: number;
    destinatario_ref: string | null;
    destinatario_nota: string | null;
  }>(
    `SELECT a.id, a.profile_id, p.display_name, a.pass_id, a.tipo, a.veces,
            a.creado_en, a.ultimo_en, ps.destinatario_ref, ps.destinatario_nota
     FROM vistta.avisos a
     JOIN vistta.profiles p ON p.id = a.profile_id
     JOIN vistta.passes   ps ON ps.id = a.pass_id
     WHERE a.user_id = $1 AND a.visto_en IS NULL
     ORDER BY a.ultimo_en DESC
     LIMIT $2`,
    [userId, limite]
  );

  return rows.map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    profileNombre: r.display_name,
    passId: r.pass_id,
    tipo: r.tipo,
    veces: r.veces,
    creadoEn: r.creado_en,
    ultimoEn: r.ultimo_en,
    destinatarioRef: r.destinatario_ref,
    destinatarioNota: r.destinatario_nota,
  }));
}

/**
 * Marcar un aviso como visto. Con el `user_id` en el WHERE, no comprobado
 * aparte: es lo que impide marcar el aviso de otro, y va en la misma sentencia
 * que escribe.
 */
export async function marcarVisto(
  db: Db,
  userId: string,
  avisoId: string,
  ahora = Date.now()
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE vistta.avisos SET visto_en = $3
     WHERE id = $2 AND user_id = $1 AND visto_en IS NULL`,
    [userId, avisoId, ahora]
  );
  return rowCount > 0;
}

/** Encender o apagar los avisos de reapertura de una cuenta. */
export async function configurarAvisos(db: Db, userId: string, activos: boolean): Promise<void> {
  await db.query(`UPDATE vistta.users SET avisos_reapertura = $2 WHERE id = $1`, [userId, activos]);
}

export async function avisosActivos(db: Db, userId: string): Promise<boolean> {
  const fila = await db.one<{ avisos_reapertura: boolean }>(
    `SELECT avisos_reapertura FROM vistta.users WHERE id = $1`,
    [userId]
  );
  return fila?.avisos_reapertura ?? false;
}
