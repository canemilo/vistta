#!/usr/bin/env node
// Alta de una cuenta del panel (y su perfil) en D1.
//   pnpm user:create <id> "<Nombre visible>" <contraseña> [--remote]
// El hash se calcula aquí con los mismos parámetros que usa el Worker
// (PBKDF2-HMAC-SHA256, 256 bits), así que el login los verifica sin más.
import { execFileSync } from "node:child_process";
import { pbkdf2Sync, randomBytes } from "node:crypto";

const [id, displayName, password, ...resto] = process.argv.slice(2);
const remoto = resto.includes("--remote");
const iteraciones = Number(process.env.PBKDF2_ITERATIONS) || 100_000;

if (!id || !displayName || !password) {
  console.error('Uso: pnpm user:create <id> "<Nombre visible>" <contraseña> [--remote]');
  process.exit(1);
}
if (password.length < 8) {
  console.error("La contraseña necesita al menos 8 caracteres.");
  process.exit(1);
}

const salt = randomBytes(16).toString("hex");
const hash = pbkdf2Sync(password, Buffer.from(salt, "hex"), iteraciones, 32, "sha256").toString(
  "hex"
);
const ahora = Date.now();
const esc = (v) => String(v).replace(/'/g, "''");

const sql = `
INSERT OR IGNORE INTO users (id, display_name, password_hash, salt, iterations, created_at)
VALUES ('${esc(id)}', '${esc(displayName)}', '${hash}', '${salt}', ${iteraciones}, ${ahora});
INSERT OR IGNORE INTO profiles (id, display_name, brand_color, data, created_at, owner_id)
VALUES ('p_${esc(id)}', '${esc(displayName)}', NULL, '{"sections":[]}', ${ahora}, '${esc(id)}');
`.trim();

execFileSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "vistta",
    remoto ? "--remote" : "--local",
    "--command",
    sql,
  ],
  { stdio: ["ignore", "ignore", "inherit"] }
);

console.log(`Cuenta lista: ${id} (perfil p_${id})`);
