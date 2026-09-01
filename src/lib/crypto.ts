// Utilidades criptográficas comunes. Todo comparado en tiempo constante.

export function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(sig));
}

// Comparación en tiempo constante: evita filtrar el secreto por diferencias de tiempo.
export function timingSafeEqual(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  // La longitud sí puede filtrarse; el contenido no.
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

/**
 * WebCrypto pide `BufferSource`, y TypeScript tipa un `Uint8Array` como
 * respaldado por `ArrayBufferLike`, que incluye `SharedArrayBuffer` y no vale.
 * Aquí nunca llega uno compartido —los bytes salen de `fetch`, de `readFile` o
 * de un `TextEncoder`—, así que el ajuste se hace una vez y en un solo sitio.
 */
function comoBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>;
}

/** HMAC-SHA256 con clave y salida en BYTES: SigV4 encadena una firma con otra. */
export async function hmacSha256Bytes(
  secret: Uint8Array | string,
  message: string
): Promise<Uint8Array> {
  const raw = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    comoBuffer(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

/** SHA-256 en hexadecimal de unos bytes cualesquiera (no solo de texto). */
export async function sha256HexDeBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", comoBuffer(bytes));
  return toHex(new Uint8Array(digest));
}
