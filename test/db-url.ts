/**
 * Base de datos de pruebas. Por defecto, la del docker-compose del repo; se
 * puede apuntar a cualquier Postgres con TEST_DATABASE_URL (en el CI la pone el
 * servicio de contenedor).
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://vistta:vistta@127.0.0.1:5433/vistta_test";
