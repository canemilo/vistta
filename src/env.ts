export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  /** Coste de PBKDF2 para contraseñas nuevas. Ver src/lib/password.ts. */
  PBKDF2_ITERATIONS?: string;
  /** Clave HMAC para firmar las URLs de medios. Sin ella, los medios quedan deshabilitados. */
  MEDIA_SIGNING_KEY?: string;
  BASE_URL?: string;
}
