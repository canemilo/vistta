import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig, ConfigError } from "./config";
import { createDb, createPool } from "./db";
import { createMemoryStorage } from "./storage/memory";
import { createFsStorage } from "./storage/fs";
import { createSupabaseStorage } from "./storage/supabase";
import type { Storage } from "./storage/port";
import type { Config } from "./config";
import { cargarEnvLocal } from "../scripts/env-local";
import { arrancarTrabajador, asegurarPeriodicos } from "./worker";

/** Punto de entrada del proceso: lo único que habla con process.env y la red. */

function construirStorage(config: Config): Storage {
  if (config.STORAGE_DRIVER === "memory") {
    console.warn("STORAGE_DRIVER=memory: los medios se pierden al reiniciar. Solo para pruebas.");
    return createMemoryStorage();
  }
  if (config.STORAGE_DRIVER === "fs") {
    console.warn(
      `STORAGE_DRIVER=fs: los medios van a ${config.STORAGE_FS_DIR}. Solo para desarrollo.`
    );
    return createFsStorage(config.STORAGE_FS_DIR);
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
const db = createDb(pool);
const storage = construirStorage(config);
const app = createApp({ config, db, storage });

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => {
  console.log(`Vistta escuchando en http://localhost:${info.port}`);
});

// El trabajador va en el mismo proceso en el MVP. Comparte la base y nada más,
// así que sacarlo a otro proceso (o a varios) en el bloque H no toca la API:
// la toma de trabajos ya salta las filas que otro tenga cogidas.
await asegurarPeriodicos(db);
const pararTrabajador = arrancarTrabajador({ db, storage });

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    pararTrabajador();
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
