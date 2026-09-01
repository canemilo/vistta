import type { Db } from "../db";
import { generateToken, hashToken } from "./token";
import { COSTE_POR_DEFECTO, hashPassword, verificarPassword, type CosteArgon2 } from "./password";

export const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 h de trabajo en el panel

/** Bloqueo del login: 5 intentos por ventana de 15 min y 15 min de castigo. */
export const LOGIN_RULE = {
  scope: "panel-login",
  max: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 15 * 60 * 1000,
} as const;

export interface Usuario {
  id: string;
  displayName: string;
  /** 'admin' solo se concede por script; ninguna ruta lo otorga. Ver lib/admin.ts. */
  role: "cliente" | "admin";
}

/** Crea la cuenta y su perfil vacío. Devuelve null si el id ya existe. */
export async function crearUsuario(
  db: Db,
  datos: { id: string; password: string; displayName: string },
  coste: CosteArgon2 = COSTE_POR_DEFECTO
): Promise<Usuario | null> {
  const hash = await hashPassword(datos.password, coste);
  const ahora = Date.now();

  // Cuenta y perfil van juntos o no van: una cuenta sin perfil no puede hacer
  // nada, y un perfil sin dueño no lo puede reclamar nadie.
  return db.tx(async (tx) => {
    const insertado = await tx.query(
      `INSERT INTO vistta.users (id, display_name, password_hash, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [datos.id, datos.displayName, hash, ahora]
    );
    if (insertado.rowCount === 0) return null; // el id ya estaba cogido

    await tx.query(
      `INSERT INTO vistta.profiles (id, display_name, brand_color, data, created_at, owner_id)
       VALUES ($1, $2, NULL, $3::jsonb, $4, $5)`,
      [`p_${datos.id}`, datos.displayName, JSON.stringify({ sections: [] }), ahora, datos.id]
    );

    return { id: datos.id, displayName: datos.displayName, role: "cliente" };
  });
}

/** Comprueba id + contraseña. Devuelve el usuario o null, sin decir cuál falló. */
export async function verificarCredenciales(
  db: Db,
  id: string,
  password: string
): Promise<Usuario | null> {
  const fila = await db.one<{
    id: string;
    display_name: string;
    password_hash: string;
    role: "cliente" | "admin";
    status: string;
  }>(`SELECT id, display_name, password_hash, role, status FROM vistta.users WHERE id = $1`, [id]);
  if (!fila) return null;

  const ok = await verificarPassword(password, fila.password_hash);
  if (!ok) return null;

  /*
   * Una cuenta suspendida no entra, y se entera con el mismo mensaje que quien
   * se equivoca de contraseña. Podría decírsele —«tu cuenta está suspendida»—
   * pero la comprobación se hace DESPUÉS de verificar la contraseña a
   * propósito: si respondiera antes, cualquiera podría averiguar qué cuentas
   * existen y cuáles están suspendidas sin saber ninguna contraseña.
   */
  if (fila.status !== "activa") return null;

  return { id: fila.id, displayName: fila.display_name, role: fila.role };
}

/** Abre sesión para un usuario y devuelve el token en claro (solo se ve aquí). */
export async function createSession(
  db: Db,
  userId: string
): Promise<{ token: string; expiresAt: number }> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await db.query(
    `INSERT INTO vistta.panel_sessions (id, token_hash, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [crypto.randomUUID(), tokenHash, userId, now, expiresAt]
  );
  return { token, expiresAt };
}

/** Usuario dueño de una sesión, o null si el token no vale o ya caducó. */
export async function usuarioDeLaSesion(db: Db, token: string | null): Promise<Usuario | null> {
  if (!token) return null;

  const tokenHash = await hashToken(token);
  // El estado se comprueba aquí y no solo al entrar: suspender una cuenta borra
  // sus sesiones, pero si alguna vez se suspendiera por otra vía, un token vivo
  // no puede seguir sirviendo.
  const fila = await db.one<{ id: string; display_name: string; role: "cliente" | "admin" }>(
    `SELECT u.id, u.display_name, u.role
     FROM vistta.panel_sessions s JOIN vistta.users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > $2 AND u.status = 'activa'`,
    [tokenHash, Date.now()]
  );

  return fila ? { id: fila.id, displayName: fila.display_name, role: fila.role } : null;
}

/**
 * El propio cliente cambia su contraseña.
 *
 * Existe porque sin ella la contraseña temporal que entrega el administrador es
 * una trampa: se le dice «cámbiala al entrar» y no hay dónde. Exige la actual
 * —tener la sesión abierta no basta: un ordenador sin bloquear no puede
 * convertirse en un cambio de credenciales— y devuelve false sin decir si falló
 * por la contraseña o por la cuenta.
 *
 * Cierra TODAS las demás sesiones y deja viva la de quien la cambia. Si se
 * cambia porque la cuenta estaba comprometida, dejar dentro al que entró no
 * arregla nada; y echar de paso al legítimo sería castigarle por protegerse.
 *
 * Devuelve cuántas cerró, o null si la contraseña actual no era correcta. El
 * número no es un adorno: enterarse de que había tres sesiones abiertas es
 * justo lo que quiere saber quien cambia la contraseña porque sospecha algo.
 */
export async function cambiarPasswordPropia(
  db: Db,
  userId: string,
  actual: string,
  nueva: string,
  tokenDeLaSesion: string | null,
  coste: CosteArgon2 = COSTE_POR_DEFECTO
): Promise<number | null> {
  const usuario = await verificarCredenciales(db, userId, actual);
  if (!usuario) return null;

  const hash = await hashPassword(nueva, coste);
  await db.query(`UPDATE vistta.users SET password_hash = $1 WHERE id = $2`, [hash, userId]);

  const hashSesion = tokenDeLaSesion ? await hashToken(tokenDeLaSesion) : null;
  const cerradas = await db.query(
    `DELETE FROM vistta.panel_sessions
     WHERE user_id = $1 AND ($2::text IS NULL OR token_hash <> $2)`,
    [userId, hashSesion]
  );
  return cerradas.rowCount;
}

/** Cierra la sesión que trae ese token. */
export async function cerrarSesion(db: Db, token: string | null): Promise<void> {
  if (!token) return;
  await db.query(`DELETE FROM vistta.panel_sessions WHERE token_hash = $1`, [
    await hashToken(token),
  ]);
}

/** Extrae el token de una cabecera Authorization: Bearer. */
export function bearer(header: string | undefined): string | null {
  const valor = header ?? "";
  return valor.startsWith("Bearer ") ? valor.slice(7) : null;
}
