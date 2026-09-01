import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";
import { crearUsuario } from "../src/lib/auth";

export const ORIGIN = "https://vistta.test";

export async function call(path: string, init?: RequestInit): Promise<Response> {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(ORIGIN + path, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

/** Cada petición con una IP distinta para no chocar con el rate limit. */
export function callAs(ip: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("CF-Connecting-IP", ip);
  return call(path, { ...init, headers });
}

export async function seedProfile(
  id = "pro_1",
  data: unknown = { sections: [] },
  ownerId: string | null = null
): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO profiles (id, display_name, brand_color, data, created_at, owner_id)
     VALUES (?,?,?,?,?,?)`
  )
    .bind(id, "Estudio Demo", "#1f8f7d", JSON.stringify(data), Date.now(), ownerId)
    .run();
  return id;
}

export const CLAVE = "contrasena-de-prueba";

/** Crea una cuenta de prueba (con su perfil) y devuelve su id. */
export async function crearCuenta(id = "marina", displayName = "Estudio Demo"): Promise<string> {
  // Pocas iteraciones: las pruebas no deben pagar el coste real de PBKDF2.
  await crearUsuario(env, { id, password: CLAVE, displayName, iterations: 1000 });
  return id;
}

/** Abre sesión de panel y devuelve el token, para las rutas autenticadas. */
export async function panelSession(userId = "marina", ip = "198.51.100.1"): Promise<string> {
  const res = await callAs(ip, "/api/panel/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, password: CLAVE }),
  });
  const { token } = await res.json<{ token: string }>();
  return token;
}

export async function resetDb(): Promise<void> {
  await env.DB.exec("DELETE FROM passes");
  await env.DB.exec("DELETE FROM profiles");
  await env.DB.exec("DELETE FROM rate_limits");
  await env.DB.exec("DELETE FROM panel_sessions");
  await env.DB.exec("DELETE FROM users");
}
