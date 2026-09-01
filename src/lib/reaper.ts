import type { Db } from "../db";
import type { Storage } from "../storage/port";
import { TTL_RESERVA_MS } from "./media-store";

/**
 * Recogida de medios huérfanos.
 *
 * Hay tres formas de dejar basura, y las tres acaban aquí:
 *
 *   1. reservar y no subir nunca (el usuario cierra la pestaña);
 *   2. subir algo que no pasó la inspección ('failed');
 *   3. subir bien y luego quitar la foto del perfil.
 *
 * Sin esto, la cuota se llena de cosas que nadie ve y el bucket paga por ellas.
 * Va en la cola y no en la petición porque puede tardar y porque no hay ningún
 * usuario esperándola.
 */

/** Margen antes de borrar un medio confirmado que ya no referencia nadie. */
export const GRACIA_SIN_REFERENCIAS_MS = 24 * 60 * 60 * 1000;

export interface ResultadoReaper {
  reservasCaducadas: number;
  fallidos: number;
  sinReferencias: number;
}

interface Huerfano {
  id: string;
  storage_key: string;
}

export async function pasarReaper(
  db: Db,
  storage: Storage,
  ahora = Date.now()
): Promise<ResultadoReaper> {
  // 1. Reservas que nunca recibieron bytes: el usuario cerró la pestaña.
  const reservasCaducadas = await borrar(
    db,
    storage,
    `SELECT id, storage_key FROM vistta.media
     WHERE status = 'pending' AND created_at < $1`,
    [ahora - TTL_RESERVA_MS]
  );

  // 2. Bytes que no pasaron la inspección. Se borra también del almacenamiento
  // aunque no debería haber nada: si el `put` llegó a medias, aquí se limpia.
  const fallidos = await borrar(
    db,
    storage,
    `SELECT id, storage_key FROM vistta.media WHERE status = 'failed'`,
    []
  );

  /*
   * 3. Confirmados que ya no referencia nadie.
   *
   * La comprobación contra el JSON del perfil es a propósito burda: se busca el
   * id como texto dentro de `data`. Un falso positivo solo significa conservar
   * un archivo de más, que es barato; un falso negativo borraría una foto que
   * el cliente sigue enseñando, que no tiene arreglo. Ante la duda, se queda.
   *
   * Y nunca se toca lo que esté en la instantánea de un pase: ese pase ya se
   * envió, y su contenido no puede evaporarse por detrás.
   */
  const sinReferencias = await borrar(
    db,
    storage,
    `SELECT m.id, m.storage_key FROM vistta.media m
     WHERE m.status = 'ready'
       AND m.confirmed_at < $1
       AND NOT EXISTS (SELECT 1 FROM vistta.pass_media pm WHERE pm.media_id = m.id)
       AND NOT EXISTS (
         SELECT 1 FROM vistta.profiles p
         WHERE p.id = m.profile_id AND p.data::text LIKE '%' || m.id || '%'
       )`,
    [ahora - GRACIA_SIN_REFERENCIAS_MS]
  );

  return { reservasCaducadas, fallidos, sinReferencias };
}

async function borrar(
  db: Db,
  storage: Storage,
  consulta: string,
  params: unknown[]
): Promise<number> {
  const { rows } = await db.query<Huerfano>(consulta, params);
  for (const fila of rows) {
    // Primero el objeto y después la fila: al revés, un fallo aquí dejaría
    // bytes en el bucket sin nada que los recuerde, y ya no habría quien los
    // volviera a encontrar.
    await storage.delete(fila.storage_key);
    await db.query(`DELETE FROM vistta.media WHERE id = $1`, [fila.id]);
  }
  return rows.length;
}
