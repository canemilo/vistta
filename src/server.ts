import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig, ConfigError } from "./config";
import { createDb, createPool } from "./db";
import { createMemoryStorage } from "./storage/memory";
import { createSupabaseStorage } from "./storage/supabase";
import type { Storage } from "./storage/port";
import type { Config } from "./config";
import { cargarEnvLocal } from "../scripts/env-local";

/** Punto de entrada del proceso: lo único que habla con process.env y la red. */

function construirStorage(config: Config): Storage {
  if (config.STORAGE_DRIVER === "memory") {
    console.warn("STORAGE_DRIVER=memory: los medios se pierden al reiniciar. Solo para pruebas.");
    return createMemoryStorage();
  }
  // loadConfig ya ha garantizado que estas dos existen con este driver.
  return createSupabaseStorage({
    supabaseUrl: config.SUPABASE_URL!,
    secretKey: config.SUPABASE_SECRET_KEY!,
    bucket: config.SUPABASE_MEDIA_BUCKET,
  });
}

// En local, .env; en producción no existe y manda el entorno del host.
cargarEnvLocal();

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  // El motivo sí se imprime (nombres de variables, no valores); el stack no aporta.
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}

const pool = createPool(config.DATABASE_URL);
const app = createApp({ config, db: createDb(pool), storage: construirStorage(config) });

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`Vistta escuchando en http://localhost:${info.port}`);
});

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
