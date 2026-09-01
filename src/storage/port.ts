/**
 * Puerto de almacenamiento de medios. La API no sabe si detrás hay Supabase
 * Storage, R2 o un Map: solo conoce esta interfaz. Cambiar de proveedor en el
 * bloque H será escribir otro adaptador, no reescribir las rutas.
 *
 * Nota para el bloque D: hoy se mueve el objeto entero en memoria. Con el tope
 * de vídeo en 50 MB eso es asumible, pero cuando entre el streaming de vídeo
 * habrá que cambiar `Uint8Array` por un stream. Queda anotado a propósito.
 */

export interface ObjetoAlmacenado {
  bytes: Uint8Array;
  contentType: string;
}

export interface Storage {
  /** Guarda (o sobrescribe) el objeto. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Devuelve el objeto o null si no existe. */
  get(key: string): Promise<ObjetoAlmacenado | null>;
  /** Borra el objeto. No falla si no existía. */
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {}
