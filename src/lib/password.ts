import { timingSafeEqual, toHex } from "./crypto";

/**
 * Coste por defecto de PBKDF2. Se guarda por usuario, así que subirlo solo
 * afecta a las contraseñas nuevas. Ojo: el plan gratuito de Workers limita la
 * CPU por petición; si el login se corta, baja PBKDF2_ITERATIONS.
 */
export const ITERACIONES_POR_DEFECTO = 100_000;

export interface PasswordHash {
  hash: string;
  salt: string;
  iterations: number;
}

export function generarSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function derivar(
  password: string,
  salt: string,
  iterations: number
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexABytes(salt), iterations },
    key,
    256
  );
  return toHex(new Uint8Array(bits));
}

export async function hashPassword(
  password: string,
  iterations = ITERACIONES_POR_DEFECTO
): Promise<PasswordHash> {
  const salt = generarSalt();
  return { hash: await derivar(password, salt, iterations), salt, iterations };
}

export async function verificarPassword(
  password: string,
  guardado: PasswordHash
): Promise<boolean> {
  const calculado = await derivar(password, guardado.salt, guardado.iterations);
  return timingSafeEqual(calculado, guardado.hash);
}

function hexABytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}
