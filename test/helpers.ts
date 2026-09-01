import { afterAll } from "vitest";
import sharp from "sharp";
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
  STORAGE_FS_DIR: ".medios-locales",
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
              vistta.panel_sessions, vistta.users, vistta.media,
              vistta.pass_media, vistta.jobs, vistta.admin_audit CASCADE`
  );
}

/**
 * Un JPEG de verdad. Hace falta que lo sea: desde el bloque D el backend mira
 * los bytes, así que un `new File(["foto"], …, { type: "image/jpeg" })` ya no
 * cuela —ni debe—, y además Sharp tiene que poder abrirlo para incrustar la
 * marca.
 */
export async function imagenJpeg(width = 320, height = 200): Promise<Uint8Array> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 180, g: 120, b: 60 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
  return new Uint8Array(buffer);
}

/** Un PDF mínimo, para probar el camino de los documentos. */
export function documentoPdf(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n");
}

export interface MedioSubido {
  mediaId: string;
  bytes: Uint8Array;
}

/**
 * Recorre la subida entera: reserva y confirma. Devuelve el id, que es lo único
 * que el contenido del perfil puede referenciar.
 */
export async function subirMedio(
  sesion: string,
  profileId: string,
  opts: { kind?: "image" | "video" | "doc"; bytes?: Uint8Array; ip?: string } = {}
): Promise<MedioSubido> {
  const kind = opts.kind ?? "image";
  const bytes = opts.bytes ?? (await imagenJpeg());
  const ip = opts.ip ?? "198.51.100.60";
  const auth = { authorization: `Bearer ${sesion}` };

  const reserva = await callAs(ip, "/api/media/presign", {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ profileId, kind, bytes: bytes.byteLength }),
  });
  if (reserva.status !== 201) {
    throw new Error(`presign devolvió ${reserva.status}: ${await reserva.text()}`);
  }
  const { mediaId, uploadUrl } = (await reserva.json()) as { mediaId: string; uploadUrl: string };

  const subida = await callAs(ip, uploadUrl, { method: "PUT", headers: auth, body: bytes });
  if (subida.status !== 201) {
    throw new Error(`confirm devolvió ${subida.status}: ${await subida.text()}`);
  }
  return { mediaId, bytes };
}

/** Una galería de un solo medio, en la forma que guarda el perfil. */
export function galeriaCon(mediaId: string, caption?: string) {
  return { sections: [{ type: "galeria", title: "Selección", items: [{ mediaId, caption }] }] };
}

/** Crea una cuenta y la promueve a administradora, como hace el script. */
export async function crearAdmin(id = "soporte", displayName = "Soporte"): Promise<string> {
  await crearUsuario(db, { id, password: CLAVE, displayName }, COSTE_DE_PRUEBAS);
  await db.query(`UPDATE vistta.users SET role = 'admin' WHERE id = $1`, [id]);
  // Un administrador no gestiona contenido: el perfil vacío que crea la cuenta
  // sobra, igual que lo quita el script de creación.
  await db.query(`DELETE FROM vistta.profiles WHERE owner_id = $1`, [id]);
  return id;
}
