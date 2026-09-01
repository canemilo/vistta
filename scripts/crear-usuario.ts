#!/usr/bin/env node
// Alta de una cuenta del panel (y su perfil) en PostgreSQL.
//   pnpm user:create <id> "<Nombre visible>" <contraseña>
import { createDb, createPool } from "../src/db";
import { crearUsuario } from "../src/lib/auth";
import { cargarEnvLocal } from "./env-local";

cargarEnvLocal();

const [id, displayName, password] = process.argv.slice(2);

if (!id || !displayName || !password) {
  console.error('Uso: pnpm user:create <id> "<Nombre visible>" <contraseña>');
  process.exit(1);
}
if (password.length < 8) {
  console.error("La contraseña necesita al menos 8 caracteres.");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const pool = createPool(databaseUrl);
try {
  const usuario = await crearUsuario(createDb(pool), { id, displayName, password });
  if (!usuario) {
    console.error(`El id "${id}" ya está cogido.`);
    process.exit(1);
  }
  console.log(`Cuenta lista: ${usuario.id} (perfil p_${usuario.id})`);
} finally {
  await pool.end();
}
