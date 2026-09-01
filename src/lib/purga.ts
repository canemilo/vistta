import type { Db } from "../db";
import type { Storage } from "../storage/port";
import { GRACIA_CONGELADO_MS, PLANES, type Plan } from "./planes";

/**
 * La parte irreversible del bloque E: aquí se borra contenido de clientes.
 *
 * Vive separada de `congelado.ts` a propósito. Congelar es reversible y
 * cotidiano; esto no tiene vuelta atrás. Quien venga a tocar este archivo debe
 * verlo desde la primera línea.
 *
 * Se borra por dos razones, y solo por dos:
 *
 *   1. VOLATILIDAD. El contenido de este producto caduca: pasada la retención
 *      del plan (7 días, 14, o nunca en Bóveda), el medio se va. Es la promesa
 *      del producto —enseñar trabajo, no alojarlo—, no un ahorro de disco.
 *   2. GRACIA AGOTADA. Un perfil que lleva congelado todo el plazo sin que nadie
 *      lo rescate se borra entero.
 *
 * Tres cosas que este módulo NO hace, y conviene que sigan así:
 *   - No borra nada de un plan sin retención (Bóveda). Ahí `retencionMs` es
 *     `null`, y `null` no es «cero»: es «nunca».
 *   - No toca un medio que esté en la instantánea de un pase todavía abrible.
 *     Ese enlace ya se envió y tiene que seguir enseñando lo que prometía.
 *   - No cuenta la retención desde antes de que la cuenta tuviera su plan
 *     actual: al bajar de Bóveda a Pro, el contenido no se evapora esa noche.
 */

export interface ResultadoPurga {
  mediosCaducados: number;
  perfilesBorrados: number;
  cuentasBorradas: number;
}

interface FilaMedio {
  id: string;
  storage_key: string;
}

export async function purgar(
  db: Db,
  storage: Storage,
  ahora = Date.now()
): Promise<ResultadoPurga> {
  return {
    mediosCaducados: await purgarMediosCaducados(db, storage, ahora),
    perfilesBorrados: await purgarCongelados(db, storage, ahora),
    cuentasBorradas: await purgarSuspendidas(db, storage, ahora),
  };
}

/**
 * Cuentas suspendidas que han agotado la gracia entera.
 *
 * Mismo criterio que los perfiles congelados y con el mismo plazo: suspender es
 * reversible hasta el último día. Lo que hace irreversible una suspensión es el
 * tiempo, no la decisión de suspender.
 *
 * El borrado inmediato del panel de administración es otra cosa y vive en
 * `lib/admin.ts`: existe para la supresión del art. 17 del RGPD, donde el plazo
 * no es de treinta días sino de ahora.
 */
async function purgarSuspendidas(db: Db, storage: Storage, ahora: number): Promise<number> {
  const { rows: cuentas } = await db.query<{ id: string }>(
    `SELECT id FROM vistta.users
     WHERE status = 'suspendida' AND suspended_at < $1`,
    [ahora - GRACIA_CONGELADO_MS]
  );
  if (cuentas.length === 0) return 0;

  const ids = cuentas.map((c) => c.id);
  // Los objetos antes que las filas: el CASCADE se lleva perfiles y medios, pero
  // el almacenamiento no sabe nada de claves ajenas.
  const { rows: medios } = await db.query<FilaMedio>(
    `SELECT m.id, m.storage_key FROM vistta.media m
     JOIN vistta.profiles p ON p.id = m.profile_id
     WHERE p.owner_id = ANY($1::text[])`,
    [ids]
  );
  await borrarMedios(db, storage, medios);

  const res = await db.query(`DELETE FROM vistta.users WHERE id = ANY($1::text[])`, [ids]);
  return res.rowCount;
}

/**
 * Medios que han pasado de su fecha.
 *
 * La consulta se hace plan a plan en vez de con un CASE sobre los tres: cada
 * plan tiene su fecha límite, y así el plan sin retención simplemente no genera
 * consulta. Un `CASE` que tradujera `null` a un número sería el sitio perfecto
 * para que un día se cuele un cero.
 */
async function purgarMediosCaducados(db: Db, storage: Storage, ahora: number): Promise<number> {
  let borrados = 0;

  for (const [plan, limites] of Object.entries(PLANES) as [Plan, (typeof PLANES)[Plan]][]) {
    if (limites.retencionMs === null) continue; // Bóveda: no caduca. Nunca.

    const limite = ahora - limites.retencionMs;
    const { rows } = await db.query<FilaMedio>(
      `SELECT m.id, m.storage_key
       FROM vistta.media m
       JOIN vistta.profiles p ON p.id = m.profile_id
       JOIN vistta.users u    ON u.id = p.owner_id
       WHERE u.plan = $1
         AND m.status = 'ready'
         AND m.confirmed_at < $2
         -- La retención cuenta desde que la cuenta tiene este plan: quien acaba
         -- de bajar de Bóveda no pierde su archivo esa misma noche.
         AND u.plan_since < $2
         -- Intocable si algún pase sin abrir y sin caducar lo lleva dentro.
         AND NOT EXISTS (
           SELECT 1 FROM vistta.pass_media pm
           JOIN vistta.passes ps ON ps.id = pm.pass_id
           WHERE pm.media_id = m.id
             AND ps.status = 'pending'
             AND ps.expires_at > $3
         )`,
      [plan, limite, ahora]
    );

    borrados += await borrarMedios(db, storage, rows);
  }

  return borrados;
}

/** Perfiles congelados que han agotado la gracia entera. */
async function purgarCongelados(db: Db, storage: Storage, ahora: number): Promise<number> {
  const { rows: perfiles } = await db.query<{ id: string }>(
    `SELECT id FROM vistta.profiles
     WHERE status = 'congelado' AND frozen_at < $1`,
    [ahora - GRACIA_CONGELADO_MS]
  );
  if (perfiles.length === 0) return 0;

  const ids = perfiles.map((p) => p.id);

  // Los objetos primero, uno a uno y por su fila: `ON DELETE CASCADE` se lleva
  // las filas de `media`, pero el almacenamiento no sabe nada de claves ajenas.
  // Si se borrase el perfil primero, los bytes quedarían en el bucket sin nada
  // que los recuerde y ya no habría quien los encontrara.
  const { rows: medios } = await db.query<FilaMedio>(
    `SELECT id, storage_key FROM vistta.media WHERE profile_id = ANY($1::text[])`,
    [ids]
  );
  await borrarMedios(db, storage, medios);

  const res = await db.query(`DELETE FROM vistta.profiles WHERE id = ANY($1::text[])`, [ids]);
  return res.rowCount;
}

async function borrarMedios(db: Db, storage: Storage, filas: FilaMedio[]): Promise<number> {
  for (const fila of filas) {
    await storage.delete(fila.storage_key);
    await db.query(`DELETE FROM vistta.media WHERE id = $1`, [fila.id]);
  }
  return filas.length;
}
