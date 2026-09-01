import type { Config } from "./config";
import type { Db } from "./db";
import type { Storage } from "./storage/port";
import type { Usuario } from "./lib/auth";

/**
 * Lo que la app necesita del mundo exterior. En Workers esto lo daba el runtime
 * en `c.env`; en Node no existe tal cosa, así que se construye en el arranque
 * (o en el arnés de pruebas) y se inyecta al crear la app.
 */
export interface Deps {
  config: Config;
  db: Db;
  storage: Storage;
}

/** Variables que los middlewares dejan en el contexto de la petición. */
export interface Variables {
  /** Identidad del cliente para el rate limit. Ver lib/client-ip.ts. */
  ip: string;
  /** Solo en las rutas del panel, tras exigir sesión. */
  usuario: Usuario;
}

export type AppEnv = { Variables: Variables };
