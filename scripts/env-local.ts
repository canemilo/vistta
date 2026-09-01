// Carga .env si existe, sin dependencias: en producción las variables las pone
// el host (Render/VPS) y este archivo no existe, que es justo lo que se quiere.
//
// Lo que ya viene del entorno GANA sobre el archivo. Al revés, un .env olvidado
// en una máquina podría pisar un secreto real del host.
import { readFileSync } from "node:fs";

export function cargarEnvLocal(ruta = ".env"): void {
  let contenido: string;
  try {
    contenido = readFileSync(ruta, "utf8");
  } catch {
    return; // no hay .env: se sigue con el entorno tal cual
  }

  for (const linea of contenido.split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("#")) continue;
    const corte = limpia.indexOf("=");
    if (corte < 1) continue;
    const clave = limpia.slice(0, corte).trim();
    if (clave in process.env) continue;
    const valor = limpia.slice(corte + 1).trim();
    process.env[clave] = valor.replace(/^(['"])(.*)\1$/, "$2");
  }
}
