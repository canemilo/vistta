import type { Context } from "hono";

/**
 * Identidad del cliente para el rate limit.
 *
 * En Workers, `CF-Connecting-IP` la ponía Cloudflare y era de fiar. En Node no
 * hay nada equivalente: `X-Forwarded-For` la escribe quien quiera. Si se hiciera
 * caso a ciegas, bastaría con mandar una cabecera distinta en cada intento para
 * saltarse el límite del login. Por eso solo se mira si TRUST_PROXY está activo,
 * es decir, si delante hay un proxy propio que la reescribe.
 */

export interface EntradaIp {
  /** Dirección del socket, o null si no la hay (pruebas, sockets Unix). */
  socketAddress: string | null;
  forwardedFor: string | undefined;
  trustProxy: boolean;
}

export function resolverIp({ socketAddress, forwardedFor, trustProxy }: EntradaIp): string {
  if (trustProxy && forwardedFor) {
    // Con un proxy de confianza delante, la entrada que vale es la ÚLTIMA: es la
    // que ha añadido él. Las de la izquierda las puede haber escrito el cliente.
    const ultima = forwardedFor.split(",").at(-1)?.trim();
    if (ultima) return ultima;
  }
  return socketAddress ?? "desconocido";
}

/** Dirección del socket subyacente, si el adaptador de Node la expone. */
export function direccionDelSocket(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}
