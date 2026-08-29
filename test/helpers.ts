import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";

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

export async function seedProfile(id = "pro_1", data: unknown = { bio: "demo" }): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO profiles (id, display_name, brand_color, data, created_at) VALUES (?,?,?,?,?)`
  )
    .bind(id, "Estudio Demo", "#1f8f7d", JSON.stringify(data), Date.now())
    .run();
  return id;
}

export async function resetDb(): Promise<void> {
  await env.DB.exec("DELETE FROM passes");
  await env.DB.exec("DELETE FROM profiles");
  await env.DB.exec("DELETE FROM rate_limits");
  await env.DB.exec("DELETE FROM panel_sessions");
}
