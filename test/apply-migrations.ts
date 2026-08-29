import { applyD1Migrations, env } from "cloudflare:test";
// Aplica las migraciones a la BD de prueba antes de los tests.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
