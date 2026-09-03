import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { loadConfig, ConfigError } from "./config";
import { createDb, createPool } from "./db";
import { createMemoryStorage } from "./storage/memory";
import { createFsStorage } from "./storage/fs";
import { createSupabaseStorage } from "./storage/supabase";
import { createR2Storage } from "./storage/r2";
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
    // Vale para desarrollo y para estrenar un despliegue antes de tener cuenta
    // de almacenamiento, pero hay que decir lo que implica: `backup.sh` vuelca
    // la BASE, no estos bytes. Si se pierde el disco, se pierden las fotos.
    console.warn(
      `STORAGE_DRIVER=fs: los medios van a ${config.STORAGE_FS_DIR}, ` +
        `en el disco de esta máquina, y NO entran en las copias de seguridad.`
    );
    return createFsStorage(config.STORAGE_FS_DIR);
  }
  if (config.STORAGE_DRIVER === "r2") {
    // loadConfig ya ha garantizado que las cuatro existen con este driver.
    return createR2Storage({
      accountId: config.R2_ACCOUNT_ID!,
      accessKeyId: config.R2_ACCESS_KEY_ID!,
      secretAccessKey: config.R2_SECRET_ACCESS_KEY!,
      bucket: config.R2_BUCKET!,
      // Sin poner, el adaptador usa el endpoint estándar de la cuenta.
      endpoint: config.R2_ENDPOINT,
    });
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
//
// Si la base no está, el proceso se cae, y así debe ser: una API que no llega a
// su base no sirve para nada y el orquestador la reintentará. Lo que no vale es
// caerse con un volcado de pila de `pg`, que no dice qué hacer: el motivo se
// imprime y se sale con código de error, como con la configuración inválida.
try {
  await asegurarPeriodicos(db);
} catch (err) {
  console.error(
    "No se pudo preparar la cola de trabajos. ¿Está la base accesible y migrada?\n" +
      (err instanceof Error ? err.message : String(err))
  );
  process.exit(1);
}
const pararTrabajador = arrancarTrabajador({ db, storage });

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.on(senal, () => {
    pararTrabajador();
    server.close(() => {
      void pool.end().then(() => process.exit(0));
    });
  });
}
