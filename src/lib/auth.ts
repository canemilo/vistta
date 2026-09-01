import type { Env } from "../env";
import { generateToken, hashToken } from "./token";
import { ITERACIONES_POR_DEFECTO, hashPassword, verificarPassword } from "./password";

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
}

interface FilaUsuario {
  id: string;
  display_name: string;
  password_hash: string;
  salt: string;
  iterations: number;
}

/** Crea la cuenta y su perfil vacío. Devuelve null si el id ya existe. */
export async function crearUsuario(
  env: Env,
  datos: { id: string; password: string; displayName: string; iterations?: number }
): Promise<Usuario | null> {
  const existe = await env.DB.prepare(`SELECT id FROM users WHERE id = ?1`)
    .bind(datos.id)
    .first<{ id: string }>();
  if (existe) return null;

  const iteraciones =
    datos.iterations ?? (Number(env.PBKDF2_ITERATIONS) || ITERACIONES_POR_DEFECTO);
  const { hash, salt, iterations } = await hashPassword(datos.password, iteraciones);
  const ahora = Date.now();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, display_name, password_hash, salt, iterations, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(datos.id, datos.displayName, hash, salt, iterations, ahora),
    env.DB.prepare(
      `INSERT INTO profiles (id, display_name, brand_color, data, created_at, owner_id)
       VALUES (?1, ?2, NULL, '{"sections":[]}', ?3, ?4)`
    ).bind(`p_${datos.id}`, datos.displayName, ahora, datos.id),
  ]);

  return { id: datos.id, displayName: datos.displayName };
}

/** Comprueba id + contraseña. Devuelve el usuario o null, sin decir cuál falló. */
export async function verificarCredenciales(
  env: Env,
  id: string,
  password: string
): Promise<Usuario | null> {
  const fila = await env.DB.prepare(
    `SELECT id, display_name, password_hash, salt, iterations FROM users WHERE id = ?1`
  )
    .bind(id)
    .first<FilaUsuario>();
  if (!fila) return null;

  const ok = await verificarPassword(password, {
    hash: fila.password_hash,
    salt: fila.salt,
    iterations: fila.iterations,
  });
  return ok ? { id: fila.id, displayName: fila.display_name } : null;
}

/** Abre sesión para un usuario y devuelve el token en claro (solo se ve aquí). */
export async function createSession(
  env: Env,
  userId: string
): Promise<{ token: string; expiresAt: number }> {
  const token = generateToken();
  const tokenHash = await hashToken(token);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  await env.DB.prepare(
    `INSERT INTO panel_sessions (id, token_hash, created_at, expires_at, user_id)
     VALUES (?1, ?2, ?3, ?4, ?5)`
  )
    .bind(crypto.randomUUID(), tokenHash, now, expiresAt, userId)
    .run();
  return { token, expiresAt };
}

/** Lo mínimo que necesita esta capa de una petición: sirve para cualquier ruta. */
interface Peticion {
  req: { header(nombre: string): string | undefined };
  env: Env;
}

function bearer(c: Peticion): string | null {
  const header = c.req.header("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/** Usuario dueño de la sesión que trae la petición, o null si no hay sesión válida. */
export async function usuarioDeLaSesion(c: Peticion): Promise<Usuario | null> {
  const presentado = bearer(c);
  if (!presentado) return null;

  const tokenHash = await hashToken(presentado);
  const fila = await c.env.DB.prepare(
    `SELECT u.id, u.display_name
     FROM panel_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?1 AND s.expires_at > ?2`
  )
    .bind(tokenHash, Date.now())
    .first<{ id: string; display_name: string }>();

  return fila ? { id: fila.id, displayName: fila.display_name } : null;
}

/** Cierra la sesión actual. */
export async function cerrarSesion(c: Peticion): Promise<void> {
  const presentado = bearer(c);
  if (!presentado) return;
  await c.env.DB.prepare(`DELETE FROM panel_sessions WHERE token_hash = ?1`)
    .bind(await hashToken(presentado))
    .run();
}
