import type { ObjetoAlmacenado, Storage } from "./port";

/**
 * Adaptador en memoria. Es el que usan las pruebas: los medios no son un
 * invariante de concurrencia, así que aquí un doble no engaña a nadie (a
 * diferencia de la base de datos, que va contra Postgres real).
 */
export function createMemoryStorage(): Storage & { claves(): string[] } {
  const objetos = new Map<string, ObjetoAlmacenado>();

  return {
    async put(key, bytes, contentType) {
      objetos.set(key, { bytes: new Uint8Array(bytes), contentType });
    },
    async get(key) {
      const objeto = objetos.get(key);
      return objeto
        ? { bytes: new Uint8Array(objeto.bytes), contentType: objeto.contentType }
        : null;
    },
    async delete(key) {
      objetos.delete(key);
    },
    claves: () => [...objetos.keys()],
  };
}
