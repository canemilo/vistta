#!/usr/bin/env node
// Contenido de demostración para desarrollo local. No usar en producción.
//   pnpm db:seed:local
//
// Crea las dos cuentas de demo si no existen y les pone contenido. Las fotos no
// se suben aquí: con STORAGE_DRIVER=memory se pierden al reiniciar, y con
// Supabase van al bucket de verdad, que es una decisión del que siembra.
import { readFile } from "node:fs/promises";
import { createDb, createPool } from "../src/db";
import { crearUsuario } from "../src/lib/auth";
import { cargarEnvLocal } from "./env-local";

cargarEnvLocal();

const CLAVE_DEMO = "demo-vistta-2026";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL.");
  process.exit(1);
}

const contenido = JSON.parse(await readFile(new URL("../seed/demo.json", import.meta.url), "utf8"));

const pool = createPool(databaseUrl);
const db = createDb(pool);
try {
  for (const [userId, perfil] of Object.entries(contenido) as [string, Record<string, unknown>][]) {
    // Devuelve null si la cuenta ya existía: entonces NO se toca su contraseña,
    // y por eso el mensaje de abajo no la anuncia.
    const creada = await crearUsuario(db, {
      id: userId,
      displayName: String(perfil.displayName),
      password: CLAVE_DEMO,
    });
    await db.query(
      `UPDATE vistta.profiles SET display_name = $1, brand_color = $2, data = $3::jsonb
       WHERE id = $4`,
      [perfil.displayName, perfil.brandColor, JSON.stringify(perfil.data), `p_${userId}`]
    );
    console.log(
      creada
        ? `Perfil p_${userId} sembrado (usuario ${userId} / ${CLAVE_DEMO})`
        : `Perfil p_${userId} sembrado (usuario ${userId} ya existía: contraseña sin tocar)`
    );
  }
} finally {
  await pool.end();
}
