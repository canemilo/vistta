import type { Db } from "../db";
import type { Storage } from "../storage/port";
import { GRACIA_CONGELADO_MS, PLANES, RETENCION_EVENTOS_MS, type Plan } from "./planes";
import { pasAbribleSql } from "./pass";
import { purgarEventos } from "./eventos";

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
  eventosBorrados: number;
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
    // Los eventos de lectura ya se van con su pase (clave ajena en cascada);
    // esto es el OTRO plazo, el que declara `legal/rat.md`: aunque el pase siga
    // ahí, la actividad de lectura de una persona no se guarda para siempre.
    eventosBorrados: await purgarEventos(db, RETENCION_EVENTOS_MS, ahora),
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
         -- Intocable si algún pase que TODAVÍA SE PUEDE ABRIR lo lleva dentro.
         --
         -- La condición sale de pasAbribleSql y no se escribe aquí, porque
         -- tiene que decir exactamente lo mismo que el consumo. Si divergen, el
         -- que se equivoca es este SELECT, y equivocarse aquí es borrar una foto
         -- que un pase vivo todavía puede pedir: el cliente abre su enlace y no
         -- hay nada dentro. Con los modos nuevos ya no basta expires_at, que
         -- solo gobierna la primera apertura.
         AND NOT EXISTS (
           SELECT 1 FROM vistta.pass_media pm
           JOIN vistta.passes ps ON ps.id = pm.pass_id
           WHERE pm.media_id = m.id
             AND ${pasAbribleSql("ps", "$3")}
         )`,
      [plan, limite, ahora]
    );

    borrados += await borrarMedios(db, storage, rows);
  }

  return borrados;
}

/**
 * Cuándo le toca la próxima limpieza a una cuenta, y a cuánto contenido.
 *
 * Vive AQUÍ, pegado al SELECT que borra, y no en el módulo del panel: si el
 * aviso se calculara por su cuenta acabaría diciendo un día y la purga borrando
 * otro, y el cliente perdería trabajo justo el día que el panel le decía que
 * estaba a salvo. Las dos condiciones que se comparten son las que más se
 * olvidan: la retención cuenta desde `plan_since`, y un medio que lleva dentro
 * un pase todavía abrible no se toca.
 *
 * Devuelve `null` en `cuando` si no hay nada que caduque: o el plan no caduca
 * —Bóveda—, o la cuenta no tiene contenido.
 */
export interface ProximaLimpieza {
  /** Cuándo caduca el medio más antiguo. `null` = nada que caduque. */
  cuando: number | null;
  /** Cuántos medios caducan en los próximos `avisoMs`. */
  enRiesgo: number;
  /** Cuántos medios hay en total sujetos a esta retención. */
  total: number;
}

export async function proximaLimpieza(
  db: Db,
  userId: string,
  avisoMs: number,
  ahora = Date.now()
): Promise<ProximaLimpieza> {
  const cuenta = await db.one<{ plan: Plan; plan_since: number }>(
    `SELECT plan, plan_since FROM vistta.users WHERE id = $1`,
    [userId]
  );
  const retencion = cuenta ? PLANES[cuenta.plan].retencionMs : null;
  // Bóveda: no caduca. No es un plazo muy largo, es la ausencia de plazo.
  if (!cuenta || retencion === null) return { cuando: null, enRiesgo: 0, total: 0 };

  const fila = await db.one<{ primero: number | null; en_riesgo: number; total: number }>(
    `SELECT min(m.confirmed_at) + $2 AS primero,
            count(*) FILTER (WHERE m.confirmed_at + $2 <= $3)::int AS en_riesgo,
            count(*)::int AS total
     FROM vistta.media m
     JOIN vistta.profiles p ON p.id = m.profile_id
     WHERE p.owner_id = $1
       AND m.status = 'ready'
       -- Las mismas dos excepciones que aplica el borrado, palabra por palabra.
       AND $4 > (SELECT plan_since FROM vistta.users WHERE id = $1)
       AND NOT EXISTS (
         SELECT 1 FROM vistta.pass_media pm
         JOIN vistta.passes ps ON ps.id = pm.pass_id
         WHERE pm.media_id = m.id
           AND ${pasAbribleSql("ps", "$4")}
       )`,
    [userId, retencion, ahora + avisoMs, ahora]
  );

  return {
    cuando: fila?.primero === null || fila?.primero === undefined ? null : Number(fila.primero),
    enRiesgo: fila?.en_riesgo ?? 0,
    total: fila?.total ?? 0,
  };
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
