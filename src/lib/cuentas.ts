import type { Db } from "../db";
import { pasAbribleSql } from "./pass";
import { limitesDe, planDe, type LimitesDePlan, type Plan } from "./planes";

/**
 * Lo que el plan de una cuenta permite, resuelto contra la base.
 *
 * Vive aparte de `planes.ts` a propósito: allí están las CIFRAS y aquí las
 * CONSULTAS. Así cambiar un número no obliga a leer SQL, y cambiar una consulta
 * no invita a tocar un número de paso.
 */

export interface CuentaConPlan {
  userId: string;
  plan: Plan;
  limites: LimitesDePlan;
}

/** El plan del dueño de un perfil. null si el perfil no existe. */
export async function cuentaDelPerfil(db: Db, profileId: string): Promise<CuentaConPlan | null> {
  const fila = await db.one<{ owner_id: string | null; plan: string }>(
    `SELECT p.owner_id, u.plan
     FROM vistta.profiles p
     LEFT JOIN vistta.users u ON u.id = p.owner_id
     WHERE p.id = $1`,
    [profileId]
  );
  if (!fila) return null;

  // Un perfil sin dueño es de la época anterior a las cuentas. Se le aplica el
  // plan más restrictivo: quien no tiene cuenta no ha contratado nada.
  const plan = planDe(fila.plan);
  return { userId: fila.owner_id ?? "", plan, limites: limitesDe(plan) };
}

export async function cuentaDelUsuario(db: Db, userId: string): Promise<CuentaConPlan | null> {
  const fila = await db.one<{ plan: string }>(`SELECT plan FROM vistta.users WHERE id = $1`, [
    userId,
  ]);
  if (!fila) return null;
  const plan = planDe(fila.plan);
  return { userId, plan, limites: limitesDe(plan) };
}

/** Perfiles que hoy cuentan para el límite: los activos. */
export async function perfilesActivos(db: Db, userId: string): Promise<number> {
  const fila = await db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM vistta.profiles
     WHERE owner_id = $1 AND status = 'activo'`,
    [userId]
  );
  return fila?.n ?? 0;
}

/**
 * Pases que ocupan sitio: generados, sin abrir y sin caducar.
 *
 * Un pase consumido no cuenta —ya hizo su trabajo— y uno caducado tampoco. El
 * límite es de enlaces vivos ahí fuera, no de enlaces creados en total.
 *
 * «Vivo» lo define `pasAbribleSql`, y no se escribe a mano aquí: con los modos
 * por accesos y por ventana, un pase puede seguir abriéndose mucho después de
 * su `expires_at`, que solo gobierna la PRIMERA apertura. Contarlo a mano dejaba
 * de contar pases que siguen ahí fuera, y el tope del plan se podía saltar.
 */
export async function pasesAbiertos(db: Db, userId: string, ahora = Date.now()): Promise<number> {
  const fila = await db.one<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM vistta.passes ps JOIN vistta.profiles p ON p.id = ps.profile_id
     WHERE p.owner_id = $1 AND ${pasAbribleSql("ps", "$2")}`,
    [userId, ahora]
  );
  return fila?.n ?? 0;
}
