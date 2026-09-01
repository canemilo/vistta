import { afterAll } from "vitest";
import type { Hono } from "hono";
import { createApp } from "../src/app";
import { createDb, createPool } from "../src/db";
import { createMemoryStorage } from "../src/storage/memory";
import { crearUsuario } from "../src/lib/auth";
import { COSTE_DE_PRUEBAS } from "../src/lib/password";
import type { Config } from "../src/config";
import type { Db } from "../src/db";
import type { AppEnv } from "../src/deps";
import { TEST_DATABASE_URL } from "./db-url";

export const ORIGIN = "https://vistta.test";

/**
 * Configuración de pruebas. TRUST_PROXY va en true para poder simular clientes
 * distintos con X-Forwarded-For; que la cabecera se ignore cuando NO hay proxy
 * de confianza lo comprueba test/client-ip.spec.ts, que es donde toca.
 */
const CONFIG_DE_PRUEBAS: Config = Object.freeze({
  DATABASE_URL: TEST_DATABASE_URL,
  MEDIA_SIGNING_KEY: "clave-de-firma-de-pruebas-con-longitud-suficiente",
  BASE_URL: "https://vistta.test",
  PORT: 8787,
  TRUST_PROXY: true,
  STORAGE_DRIVER: "memory",
  SUPABASE_URL: undefined,
  SUPABASE_SECRET_KEY: undefined,
  SUPABASE_MEDIA_BUCKET: "vistta-media",
});

const pool = createPool(TEST_DATABASE_URL);
export const db: Db = createDb(pool);
export const storage = createMemoryStorage();
export const app: Hono<AppEnv> = createApp({ config: CONFIG_DE_PRUEBAS, db, storage });

afterAll(async () => {
  await pool.end();
});

export async function call(path: string, init?: RequestInit): Promise<Response> {
  return app.fetch(new Request(ORIGIN + path, init));
}

/** Cada petición con una IP distinta para no chocar con el rate limit. */
export function callAs(ip: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Forwarded-For", ip);
  return call(path, { ...init, headers });
}

export async function seedProfile(
  id = "pro_1",
  data: unknown = { sections: [] },
  ownerId: string | null = null
): Promise<string> {
  await db.query(
    `INSERT INTO vistta.profiles (id, display_name, brand_color, data, created_at, owner_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [id, "Estudio Demo", "#1f8f7d", JSON.stringify(data), Date.now(), ownerId]
  );
  return id;
}

export const CLAVE = "contrasena-de-prueba";

/** Crea una cuenta de prueba (con su perfil) y devuelve su id. */
export async function crearCuenta(id = "marina", displayName = "Estudio Demo"): Promise<string> {
  // Coste mínimo: las pruebas no deben pagar el coste real de Argon2id.
  await crearUsuario(db, { id, password: CLAVE, displayName }, COSTE_DE_PRUEBAS);
  return id;
}

/** Abre sesión de panel y devuelve el token, para las rutas autenticadas. */
export async function panelSession(userId = "marina", ip = "198.51.100.1"): Promise<string> {
  const res = await callAs(ip, "/api/panel/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId, password: CLAVE }),
  });
  const { token } = (await res.json()) as { token: string };
  return token;
}

export async function resetDb(): Promise<void> {
  // TRUNCATE con CASCADE: una sola sentencia, y el orden de las claves ajenas
  // deja de importar.
  await db.query(
    `TRUNCATE vistta.passes, vistta.profiles, vistta.rate_limits,
              vistta.panel_sessions, vistta.users CASCADE`
  );
}
