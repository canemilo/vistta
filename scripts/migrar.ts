#!/usr/bin/env node
// Aplica las migraciones a la base que indique DATABASE_URL.
//   pnpm db:migrate
import { migrar } from "../src/migrate";
import { cargarEnvLocal } from "./env-local";

cargarEnvLocal();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL. Cópiala de .env.example a .env y rellénala.");
  process.exit(1);
}

await migrar(databaseUrl);
console.log("Migraciones al día.");
