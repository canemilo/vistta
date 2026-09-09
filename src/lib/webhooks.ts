import type { Db } from "../db";
import { generateToken, hashToken } from "./token";

/**
 * Webhooks ENTRANTES: el CRM le pide a Vistta que genere un pase.
 *
 * El token viaja en la URL, y de ahí sale todo lo demás. Un CRM no puede
 * iniciar sesión, así que la única credencial posible es algo que quepa en una
 * dirección; y una dirección acaba, tarde o temprano, en el registro de acceso
 * de un tercero. Por eso se trata igual que el token de un pase:
 *
 *   - en la base vive SOLO el hash (SHA-256), nunca el token;
 *   - se enseña una vez, al crearlo, y no se puede volver a ver;
 *   - se revoca en un clic, y `last_used_at` permite darse cuenta de que hay
 *     que hacerlo.
 *
 * Y revocado responde EXACTAMENTE lo mismo que inexistente. Si se distinguieran,
 * la ruta pública diría cuáles de los tokens probados existieron alguna vez.
 */

export interface ConexionDeEntrada {
  id: string;
  nombre: string;
  profileId: string | null;
  creadoEn: number;
  ultimoUso: number | null;
  revocadoEn: number | null;
}

/**
 * Crea una conexión y devuelve el token EN CLARO. Es la única vez que existe
 * fuera del navegador de quien la crea: quien llame tiene que enseñarlo ya.
 */
export async function crearConexionDeEntrada(
  db: Db,
  userId: string,
  datos: { nombre: string; profileId?: string | null },
  ahora = Date.now()
): Promise<{ conexion: ConexionDeEntrada; token: string }> {
  const token = generateToken();
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO vistta.webhooks_entrada
       (id, owner_id, profile_id, token_hash, nombre, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, datos.profileId ?? null, await hashToken(token), datos.nombre, ahora]
  );
  return {
    token,
    conexion: {
      id,
      nombre: datos.nombre,
      profileId: datos.profileId ?? null,
      creadoEn: ahora,
      ultimoUso: null,
      revocadoEn: null,
    },
  };
}

/** Las conexiones de una cuenta. Sin tokens: en la base no hay ninguno. */
export async function conexionesDeEntrada(db: Db, userId: string): Promise<ConexionDeEntrada[]> {
  const { rows } = await db.query<{
    id: string;
    nombre: string;
    profile_id: string | null;
    created_at: number;
    last_used_at: number | null;
    revoked_at: number | null;
  }>(
    `SELECT id, nombre, profile_id, created_at, last_used_at, revoked_at
     FROM vistta.webhooks_entrada
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return rows.map((r) => ({
    id: r.id,
    nombre: r.nombre,
    profileId: r.profile_id,
    creadoEn: r.created_at,
    ultimoUso: r.last_used_at,
    revocadoEn: r.revoked_at,
  }));
}

/**
 * Revoca. Con el `owner_id` en el WHERE, no comprobado antes: es lo que impide
 * revocar la conexión de otro, y va en la misma sentencia que escribe.
 */
export async function revocarConexionDeEntrada(
  db: Db,
  userId: string,
  id: string,
  ahora = Date.now()
): Promise<boolean> {
  const { rowCount } = await db.query(
    `UPDATE vistta.webhooks_entrada SET revoked_at = $3
     WHERE id = $2 AND owner_id = $1 AND revoked_at IS NULL`,
    [userId, id, ahora]
  );
  return rowCount > 0;
}

export interface ConexionResuelta {
  id: string;
  ownerId: string;
  profileId: string | null;
}

/**
 * De un token a la conexión que representa, o `null`.
 *
 * El token se busca POR SU HASH, y eso ya es la comparación en tiempo constante
 * que pedía el encargo: el índice único compara treinta y dos bytes de digest,
 * no el secreto, y una diferencia de tiempo sobre un hash no dice nada del
 * original. Comparar el token en claro dentro de la aplicación sí habría hecho
 * falta protegerlo.
 *
 * Devuelve `null` igual para «no existe» y para «revocada». Quien pregunta no
 * tiene por qué averiguar en cuál de los dos casos está.
 */
export async function resolverConexionDeEntrada(
  db: Db,
  token: string,
  ahora = Date.now()
): Promise<ConexionResuelta | null> {
  const fila = await db.one<{ id: string; owner_id: string; profile_id: string | null }>(
    // El UPDATE hace de SELECT: deja constancia del uso y devuelve la fila en
    // la misma sentencia. `last_used_at` es lo primero que mira quien dice que
    // «no le funciona», y separarlo en dos consultas era una de más por aviso.
    `UPDATE vistta.webhooks_entrada SET last_used_at = $2
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING id, owner_id, profile_id`,
    [await hashToken(token), ahora]
  );
  if (!fila) return null;
  return { id: fila.id, ownerId: fila.owner_id, profileId: fila.profile_id };
}
