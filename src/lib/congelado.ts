import type { Db } from "../db";
import { cuentaDelUsuario } from "./cuentas";
import { limitesDe, type Plan } from "./planes";

/**
 * Congelar, descongelar y elegir qué perfil queda activo.
 *
 * La regla que ordena el módulo entero, y que es una decisión de producto, no
 * una de implementación:
 *
 *   **bajar de plan NUNCA borra nada.**
 *
 * Lo que sobra pasa a 'congelado': sigue en la base, con sus medios y su
 * contenido intactos. El cliente elige cuál de sus perfiles deja activo y puede
 * cambiar de idea las veces que quiera. Solo si un perfil se queda congelado
 * durante todo el plazo de gracia, la purga lo borra —y eso pasa en otro
 * archivo, `purga.ts`, para que la parte reversible y la irreversible no se
 * lean como si fueran lo mismo.
 */

export interface ResultadoDeAjuste {
  activos: number;
  congelados: string[];
  descongelados: string[];
}

/**
 * Deja la cuenta dentro de su plan, congelando lo que sobre.
 *
 * Cuando hay que congelar, se conservan los perfiles MÁS ANTIGUOS. No es que
 * sean mejores: es que hace falta un criterio y este es el único que el cliente
 * puede predecir sin mirar la base. Enseguida puede cambiarlo con `activar`, que
 * es la elección de verdad; esto solo evita dejar la cuenta en un estado
 * indefinido mientras tanto.
 */
export async function ajustarAlPlan(db: Db, userId: string): Promise<ResultadoDeAjuste> {
  return db.tx(async (tx) => {
    const cuenta = await cuentaDelUsuario(tx, userId);
    if (!cuenta) return { activos: 0, congelados: [], descongelados: [] };

    // La cuenta bloqueada mientras se recuenta y se decide: dos ajustes a la vez
    // (un cambio de plan y una activación, por ejemplo) dejarían un recuento mal.
    await tx.one(`SELECT id FROM vistta.users WHERE id = $1 FOR UPDATE`, [userId]);

    const { rows } = await tx.query<{ id: string; status: string }>(
      `SELECT id, status FROM vistta.profiles WHERE owner_id = $1
       ORDER BY created_at, id`,
      [userId]
    );

    const activos = rows.filter((p) => p.status === "activo");
    const limite = cuenta.limites.perfiles;
    const sobran = activos.slice(limite).map((p) => p.id);

    const congelados = sobran.length ? await congelar(tx, sobran) : [];

    /*
     * Y al revés: si el plan ha subido, los congelados vuelven solos.
     *
     * Descongelar es la mitad amable de esto y no puede depender de que el
     * cliente se acuerde de pulsar nada: quien acaba de pagar más espera
     * encontrarse su trabajo donde lo dejó, no una lista de cosas que rescatar.
     */
    const hueco = limite - (activos.length - congelados.length);
    const candidatos = rows
      .filter((p) => p.status === "congelado")
      .slice(0, Math.max(0, hueco))
      .map((p) => p.id);
    const descongelados = candidatos.length ? await descongelar(tx, candidatos) : [];

    return {
      activos: activos.length - congelados.length + descongelados.length,
      congelados,
      descongelados,
    };
  });
}

/**
 * El cliente elige qué perfil está activo.
 *
 * Si ya no queda hueco, se intercambia: entra el que pide y sale el que lleve
 * más tiempo sin tocarse. Intercambiar y no rechazar es lo que hace que el
 * plan de un solo perfil siga siendo usable —«solo disponible 1 perfil a
 * elegir»—: el cliente cambia de perfil cuando lo necesita, sin perder ninguno.
 *
 * Devuelve false solo si el perfil no es suyo o no existe.
 */
export async function activarPerfil(db: Db, userId: string, profileId: string): Promise<boolean> {
  return db.tx(async (tx) => {
    await tx.one(`SELECT id FROM vistta.users WHERE id = $1 FOR UPDATE`, [userId]);

    const objetivo = await tx.one<{ id: string; status: string }>(
      `SELECT id, status FROM vistta.profiles WHERE id = $1 AND owner_id = $2`,
      [profileId, userId]
    );
    if (!objetivo) return false;
    if (objetivo.status === "activo") return true; // ya lo estaba

    const cuenta = await cuentaDelUsuario(tx, userId);
    const limite = cuenta ? cuenta.limites.perfiles : 0;

    const { rows: activos } = await tx.query<{ id: string }>(
      `SELECT id FROM vistta.profiles
       WHERE owner_id = $1 AND status = 'activo'
       ORDER BY created_at, id`,
      [userId]
    );

    // Hace falta sitio: sale el más antiguo de los activos.
    if (activos.length >= limite && activos.length > 0) {
      await congelar(tx, [activos[0].id]);
    }

    await descongelar(tx, [profileId]);
    return true;
  });
}

/**
 * Aplica un plan a una cuenta y la deja coherente con él.
 *
 * `plan_since` se actualiza porque la retención de los medios se cuenta desde
 * el plan vigente: al subir a Bóveda, lo que ya estaba deja de tener fecha de
 * caducidad, y al bajar no se le aplica de golpe un plazo que ya habría vencido.
 */
export async function cambiarPlan(db: Db, userId: string, plan: Plan): Promise<ResultadoDeAjuste> {
  await db.query(`UPDATE vistta.users SET plan = $1, plan_since = $2 WHERE id = $3`, [
    plan,
    Date.now(),
    userId,
  ]);
  void limitesDe(plan); // falla pronto si el plan no existe
  return ajustarAlPlan(db, userId);
}

async function congelar(db: Db, ids: readonly string[]): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE vistta.profiles SET status = 'congelado', frozen_at = $1
     WHERE id = ANY($2::text[]) AND status = 'activo'
     RETURNING id`,
    [Date.now(), [...ids]]
  );
  return rows.map((r) => r.id);
}

async function descongelar(db: Db, ids: readonly string[]): Promise<string[]> {
  // `frozen_at` vuelve a NULL: la cuenta atrás no se pausa, se cancela. Si un
  // perfil se rescata y luego se vuelve a congelar, empieza de cero, que es lo
  // que cualquiera esperaría.
  const { rows } = await db.query<{ id: string }>(
    `UPDATE vistta.profiles SET status = 'activo', frozen_at = NULL
     WHERE id = ANY($1::text[]) AND status = 'congelado'
     RETURNING id`,
    [[...ids]]
  );
  return rows.map((r) => r.id);
}
