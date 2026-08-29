import type { MiddlewareHandler } from "hono";

// Cabeceras de seguridad para todas las respuestas de la API.
// La API solo devuelve JSON o medios: la CSP puede ser la más estricta posible.
export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    );
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    // El contenido del pase es privado y de un solo uso: nunca se cachea.
    c.header("Cache-Control", "no-store");
    if (new URL(c.req.url).protocol === "https:") {
      c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
  };
}
