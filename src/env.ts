export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  /** Secreto de servicio para el panel (CI / uso manual). */
  PANEL_TOKEN?: string;
  /** PIN del panel: inicia sesión en POST /api/panel/session. */
  PANEL_PIN?: string;
  /** Clave HMAC para firmar las URLs de medios. Sin ella, los medios quedan deshabilitados. */
  MEDIA_SIGNING_KEY?: string;
  BASE_URL?: string;
}
