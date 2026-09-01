import { StorageError, type Storage } from "./port";

/**
 * Adaptador de Supabase Storage por su API REST. Sin `@supabase/supabase-js`:
 * de esa librería solo se usarían tres llamadas, y el puerto ya aísla lo que
 * importa.
 *
 * El bucket es PRIVADO. Estas llamadas van con la clave secreta, que salta RLS,
 * y nunca se exponen al navegador: el cliente solo recibe URLs firmadas por
 * nosotros contra /m/*, que es donde se comprueba la firma.
 */

export interface OpcionesSupabaseStorage {
  supabaseUrl: string;
  secretKey: string;
  bucket: string;
  /** Inyectable para poder probar el adaptador sin red. */
  fetchImpl?: typeof fetch;
}

export function createSupabaseStorage(opts: OpcionesSupabaseStorage): Storage {
  const http = opts.fetchImpl ?? fetch;
  const base = `${opts.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object`;
  const auth = { Authorization: `Bearer ${opts.secretKey}` };

  // La clave puede llevar barras (u/<perfil>/<archivo>): se codifica segmento a
  // segmento para no convertirlas en %2F, que Supabase trata como otro objeto.
  const url = (key: string) =>
    `${base}/${opts.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;

  return {
    async put(key, bytes, contentType) {
      const res = await http(url(key), {
        method: "POST",
        headers: { ...auth, "content-type": contentType, "x-upsert": "true" },
        body: bytes,
      });
      // El cuerpo del error puede traer detalles del proyecto: no se propaga.
      if (!res.ok) throw new StorageError(`no se pudo guardar el medio (${res.status})`);
    },

    async get(key) {
      const res = await http(url(key), { headers: auth });
      if (res.status === 404) return null;
      if (!res.ok) throw new StorageError(`no se pudo leer el medio (${res.status})`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async delete(key) {
      const res = await http(url(key), { method: "DELETE", headers: auth });
      if (!res.ok && res.status !== 404) {
        throw new StorageError(`no se pudo borrar el medio (${res.status})`);
      }
    },
  };
}
