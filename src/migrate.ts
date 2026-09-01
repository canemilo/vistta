import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runner } from "node-pg-migrate";

/**
 * Aplica las migraciones. Vive aquí, y no solo en un script de npm, porque el
 * arnés de pruebas necesita exactamente el mismo camino: si las pruebas usaran
 * otra vía para crear el esquema, no estarían probando el esquema que se
 * despliega.
 */

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function migrar(
  databaseUrl: string,
  opciones: { silencioso?: boolean } = {}
): Promise<void> {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    // La tabla de control vive con el resto del esquema, fuera de `public`.
    migrationsSchema: "vistta",
    createMigrationsSchema: true,
    schema: "vistta",
    createSchema: true,
    migrationsTable: "pgmigrations",
    log: opciones.silencioso ? () => undefined : console.log,
  });
}
