import { hmacSha256Bytes, sha256HexDeBytes, toHex } from "../lib/crypto";
import { StorageError, type Storage } from "./port";

/**
 * Adaptador de Cloudflare R2, por su API compatible con S3.
 *
 * Es la implementación del puerto `Storage` para producción, y el motivo de
 * mudarse desde Supabase Storage es el egreso: R2 no cobra por los bytes que
 * salen, y aquí CADA visita a una foto vuelve a leer el original para
 * incrustarle su marca. Con un proveedor que cobre tráfico de salida, ese
 * mismo diseño se paga dos veces.
 *
 * Sin SDK de AWS. De él se usarían tres llamadas, arrastra decenas de
 * dependencias transitivas a una imagen que se despliega, y lo único que hace
 * falta —firmar SigV4— cabe abajo. Es la misma decisión que se tomó con
 * `@supabase/supabase-js`.
 */

const SERVICIO = "s3";
const PAYLOAD_VACIO = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export interface OpcionesR2 {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * R2 solo entiende `auto`. Se puede cambiar para poder probar el firmado
   * contra otro servidor compatible con S3 (MinIO), que sí exige una región.
   */
  region?: string;
  /** Endpoint completo. Por defecto, el de la cuenta de R2. */
  endpoint?: string;
  /** Inyectable para probar sin red. */
  fetchImpl?: typeof fetch;
  /** Inyectable para que la firma sea reproducible en las pruebas. */
  ahora?: () => Date;
}

/**
 * Codificación de una ruta para la firma.
 *
 * Cada segmento por separado: la barra separa segmentos y NO puede convertirse
 * en %2F, o la clave `u/perfil/foto.webp` pasaría a ser un objeto distinto.
 * Y hay que codificar igual aquí y en la URL que se manda, o la firma cubre un
 * mensaje distinto del que viaja y R2 la rechaza.
 */
function rutaCodificada(key: string): string {
  return key
    .split("/")
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
      )
    )
    .join("/");
}

/** `20260901T101500Z` y `20260901`, que es lo que pide SigV4. */
function marcasDeTiempo(fecha: Date): { largo: string; corto: string } {
  const largo = fecha
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  return { largo, corto: largo.slice(0, 8) };
}

export function createR2Storage(opts: OpcionesR2): Storage {
  const http = opts.fetchImpl ?? fetch;
  const ahora = opts.ahora ?? (() => new Date());
  const region = opts.region ?? "auto";
  const endpoint = (opts.endpoint ?? `https://${opts.accountId}.r2.cloudflarestorage.com`).replace(
    /\/+$/,
    ""
  );
  const host = new URL(endpoint).host;

  /**
   * Firma la petición con AWS SigV4 y devuelve las cabeceras.
   *
   * `x-amz-content-sha256` lleva el hash de los BYTES REALES del cuerpo, no un
   * `UNSIGNED-PAYLOAD`: así la firma cubre también el contenido, y un
   * intermediario no puede cambiar lo que se sube dejando la firma válida.
   */
  async function firmar(
    metodo: string,
    key: string,
    cuerpo: Uint8Array | null,
    extra: Record<string, string> = {}
  ): Promise<Record<string, string>> {
    const { largo, corto } = marcasDeTiempo(ahora());
    const hashCuerpo = cuerpo ? await sha256HexDeBytes(cuerpo) : PAYLOAD_VACIO;
    const ruta = `/${opts.bucket}/${rutaCodificada(key)}`;

    const cabeceras: Record<string, string> = {
      host,
      "x-amz-content-sha256": hashCuerpo,
      "x-amz-date": largo,
      ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v])),
    };

    // Las cabeceras firmadas van ordenadas y en minúscula: el servidor rehace
    // esta misma cadena por su cuenta y la compara.
    const nombres = Object.keys(cabeceras).sort();
    const canonicas = nombres.map((n) => `${n}:${cabeceras[n].trim()}\n`).join("");
    const firmadas = nombres.join(";");

    const peticionCanonica = [
      metodo,
      ruta,
      "", // sin query
      canonicas,
      firmadas,
      hashCuerpo,
    ].join("\n");

    const alcance = `${corto}/${region}/${SERVICIO}/aws4_request`;
    const porFirmar = [
      "AWS4-HMAC-SHA256",
      largo,
      alcance,
      await sha256HexDeBytes(new TextEncoder().encode(peticionCanonica)),
    ].join("\n");

    // La clave de firma se deriva en cascada: fecha, región, servicio y sufijo.
    // Así una firma solo sirve para ese día, esa región y ese servicio.
    let clave = await hmacSha256Bytes(`AWS4${opts.secretAccessKey}`, corto);
    clave = await hmacSha256Bytes(clave, region);
    clave = await hmacSha256Bytes(clave, SERVICIO);
    clave = await hmacSha256Bytes(clave, "aws4_request");
    const firma = toHex(await hmacSha256Bytes(clave, porFirmar));

    return {
      ...cabeceras,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${alcance}, ` +
        `SignedHeaders=${firmadas}, Signature=${firma}`,
    };
  }

  const url = (key: string) => `${endpoint}/${opts.bucket}/${rutaCodificada(key)}`;

  return {
    async put(key, bytes, contentType) {
      const cabeceras = await firmar("PUT", key, bytes, { "content-type": contentType });
      const res = await http(url(key), { method: "PUT", headers: cabeceras, body: bytes });
      // El cuerpo del error de S3 nombra el bucket y la cuenta: no se propaga.
      if (!res.ok) throw new StorageError(`no se pudo guardar el medio (${res.status})`);
    },

    async get(key) {
      const cabeceras = await firmar("GET", key, null);
      const res = await http(url(key), { headers: cabeceras });
      if (res.status === 404) return null;
      if (!res.ok) throw new StorageError(`no se pudo leer el medio (${res.status})`);
      return {
        bytes: new Uint8Array(await res.arrayBuffer()),
        contentType: res.headers.get("content-type") ?? "application/octet-stream",
      };
    },

    async delete(key) {
      const cabeceras = await firmar("DELETE", key, null);
      const res = await http(url(key), { method: "DELETE", headers: cabeceras });
      // S3 responde 204 al borrar algo que no existía: no es un error.
      if (!res.ok && res.status !== 404) {
        throw new StorageError(`no se pudo borrar el medio (${res.status})`);
      }
    },
  };
}
