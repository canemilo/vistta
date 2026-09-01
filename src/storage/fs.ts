import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { StorageError, type Storage } from "./port";

/**
 * Almacenamiento en disco, para desarrollo local.
 *
 * Existe por un motivo práctico: con el adaptador en memoria, sembrar y servir
 * son procesos distintos, así que la siembra deja filas en la base apuntando a
 * bytes que ya no existen. Con esto, `pnpm setup:local` deja una demo que
 * funciona sin necesidad de credenciales de Supabase.
 *
 * No es para producción: no hay réplica, ni versiones, ni CDN delante. Para eso
 * están los otros dos adaptadores del mismo puerto.
 */

export function createFsStorage(directorio: string): Storage {
  const raiz = resolve(directorio);

  /*
   * Aquí, y solo aquí, una clave se convierte en una ruta del sistema de
   * ficheros. Así que aquí es donde se comprueba que no se sale: se resuelve y
   * se exige que el resultado siga colgando de la raíz. Las claves las genera el
   * servidor y hoy son `u/<perfil>/<uuid>`, pero esta función no puede depender
   * de que eso siga siendo verdad dentro de seis meses.
   */
  const rutaDe = (key: string): string => {
    const ruta = resolve(raiz, key);
    if (ruta !== raiz && !ruta.startsWith(raiz + sep)) {
      throw new StorageError("clave fuera del directorio de medios");
    }
    return ruta;
  };

  return {
    async put(key, bytes, contentType) {
      const ruta = rutaDe(key);
      await mkdir(dirname(ruta), { recursive: true });
      await writeFile(ruta, bytes);
      // El tipo va en un fichero al lado: el disco no guarda metadatos y la
      // columna `media.mime` es la que manda, pero así el adaptador cumple el
      // puerto entero y no devuelve un tipo inventado.
      await writeFile(`${ruta}.tipo`, contentType, "utf8");
    },

    async get(key) {
      const ruta = rutaDe(key);
      try {
        const bytes = new Uint8Array(await readFile(ruta));
        const contentType = await readFile(`${ruta}.tipo`, "utf8").catch(
          () => "application/octet-stream"
        );
        return { bytes, contentType };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async delete(key) {
      const ruta = rutaDe(key);
      await rm(ruta, { force: true });
      await rm(`${ruta}.tipo`, { force: true });
    },
  };
}
