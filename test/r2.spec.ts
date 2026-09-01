import { describe, it, expect } from "vitest";
import { createR2Storage } from "../src/storage/r2";
import { StorageError } from "../src/storage/port";
import { sha256HexDeBytes } from "../src/lib/crypto";

/**
 * El adaptador de R2.
 *
 * Estas pruebas miran la petición que sale, con un `fetch` de mentira. Lo que
 * NO pueden demostrar es que la firma sea correcta: para eso hace falta alguien
 * que la valide. Se ha verificado a mano contra MinIO (que valida SigV4 igual
 * que R2) y por mutación: saltarse un paso de la derivación de la clave da 403,
 * y firmar un cuerpo vacío mandando bytes de verdad da 400. Queda escrito aquí
 * porque un servidor S3 en la suite pesaría más de lo que aporta.
 */

const CREDENCIALES = {
  accountId: "cuenta",
  accessKeyId: "AKIAEJEMPLO",
  secretAccessKey: "secreto-de-ejemplo-largo",
  bucket: "vistta-medios",
  // Fija: sin esto la firma cambiaría cada día y no se podría comparar nada.
  ahora: () => new Date("2026-09-01T10:15:00.000Z"),
};

interface Capturada {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Uint8Array | null;
}

function espia(respuesta: Response): { llamadas: Capturada[]; fetchImpl: typeof fetch } {
  const llamadas: Capturada[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    llamadas.push({
      url: String(url),
      method: init.method ?? "GET",
      headers: (init.headers ?? {}) as Record<string, string>,
      body: (init.body as Uint8Array | undefined) ?? null,
    });
    return respuesta;
  }) as unknown as typeof fetch;
  return { llamadas, fetchImpl };
}

const ok = (cuerpo: string | null = null, init: ResponseInit = {}) => new Response(cuerpo, init);

describe("adaptador de R2", () => {
  it("firma con el hash de los BYTES REALES, no con UNSIGNED-PAYLOAD", async () => {
    const { llamadas, fetchImpl } = espia(ok());
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    await createR2Storage({ ...CREDENCIALES, fetchImpl }).put("u/p1/a.webp", bytes, "image/webp");

    // Si la firma no cubriera el cuerpo, un intermediario podría cambiar lo que
    // se sube dejando la firma válida.
    expect(llamadas[0].headers["x-amz-content-sha256"]).toBe(await sha256HexDeBytes(bytes));
  });

  it("la barra de la clave separa segmentos y no se convierte en %2F", async () => {
    const { llamadas, fetchImpl } = espia(ok());
    await createR2Storage({ ...CREDENCIALES, fetchImpl }).put(
      "u/p_marina/foto con espacios.webp",
      new Uint8Array([1]),
      "image/webp"
    );

    // Con %2F sería otro objeto distinto, y el espacio SÍ tiene que codificarse.
    expect(llamadas[0].url).toBe(
      "https://cuenta.r2.cloudflarestorage.com/vistta-medios/u/p_marina/foto%20con%20espacios.webp"
    );
  });

  it("la cabecera Authorization lleva el alcance del día, la región y el servicio", async () => {
    const { llamadas, fetchImpl } = espia(ok());
    await createR2Storage({ ...CREDENCIALES, fetchImpl }).get("u/p1/a.webp");

    const auth = llamadas[0].headers["Authorization"];
    expect(auth).toContain("Credential=AKIAEJEMPLO/20260901/auto/s3/aws4_request");
    // Las firmadas van ordenadas: el servidor rehace la misma cadena y compara.
    expect(auth).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it("un medio que no existe es null, no un error", async () => {
    const { fetchImpl } = espia(ok(null, { status: 404 }));
    expect(await createR2Storage({ ...CREDENCIALES, fetchImpl }).get("u/p1/no.webp")).toBeNull();
  });

  it("un error del proveedor no propaga su cuerpo", async () => {
    // El XML de error de S3 nombra el bucket y la cuenta: eso no sube a la API.
    const { fetchImpl } = espia(
      ok("<Error><BucketName>vistta-medios</BucketName></Error>", { status: 500 })
    );
    const s = createR2Storage({ ...CREDENCIALES, fetchImpl });
    await expect(s.get("u/p1/a.webp")).rejects.toBeInstanceOf(StorageError);
    await expect(s.get("u/p1/a.webp")).rejects.toThrow(/^no se pudo leer el medio \(500\)$/);
  });

  it("borrar algo que ya no está no es un error", async () => {
    const { fetchImpl } = espia(ok(null, { status: 404 }));
    await expect(
      createR2Storage({ ...CREDENCIALES, fetchImpl }).delete("u/p1/no.webp")
    ).resolves.toBeUndefined();
  });

  it("la misma petición firmada dos veces da la misma firma", async () => {
    // La firma es determinista dado el mismo instante: si no lo fuera, no se
    // podría comparar nada de lo de arriba y las pruebas serían humo.
    const uno = espia(ok());
    const dos = espia(ok());
    await createR2Storage({ ...CREDENCIALES, fetchImpl: uno.fetchImpl }).get("u/p1/a.webp");
    await createR2Storage({ ...CREDENCIALES, fetchImpl: dos.fetchImpl }).get("u/p1/a.webp");
    expect(uno.llamadas[0].headers["Authorization"]).toBe(dos.llamadas[0].headers["Authorization"]);
  });

  it("cambiar un solo byte del cuerpo cambia la firma", async () => {
    const uno = espia(ok());
    const dos = espia(ok());
    await createR2Storage({ ...CREDENCIALES, fetchImpl: uno.fetchImpl }).put(
      "u/p1/a.webp",
      new Uint8Array([1, 2, 3]),
      "image/webp"
    );
    await createR2Storage({ ...CREDENCIALES, fetchImpl: dos.fetchImpl }).put(
      "u/p1/a.webp",
      new Uint8Array([1, 2, 4]),
      "image/webp"
    );
    expect(uno.llamadas[0].headers["Authorization"]).not.toBe(
      dos.llamadas[0].headers["Authorization"]
    );
  });
});
