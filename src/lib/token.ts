// Token opaco de 128 bits. La URL lleva el token en claro; la BD guarda solo su hash.
import { sha256Hex } from "./crypto";

export function generateToken(): string {
  const bytes = new Uint8Array(16); // 128 bits
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export function hashToken(token: string): Promise<string> {
  return sha256Hex(token);
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
