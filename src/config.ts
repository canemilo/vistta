import { z } from "zod";

/**
 * Configuración del proceso. Se valida una vez al arrancar y se inyecta: nadie
 * lee `process.env` por su cuenta. En Node no hay bindings del runtime, así que
 * esto es lo único que separa "configurado" de "roto en producción".
 */

/**
 * Una variable de entorno VACÍA es una variable que no está.
 *
 * No es una preferencia de estilo: en un `.env` de despliegue las opcionales se
 * dejan escritas y sin valor (`PAYPAL_DESTINO=`), y docker compose las pasa
 * como cadena vacía. Para Zod, `""` no es `undefined`: falla el `.min(1)` y el
 * proceso no arranca. Se descubrió levantando la pila entera, no leyendo el
 * código: con las cuatro opcionales en blanco, la API entraba en bucle de
 * reinicio quejándose de una URL de Supabase que nadie había pedido usar.
 */
function opcional<T extends z.ZodTypeAny>(esquema: T) {
  return z.preprocess((v) => (v === "" ? undefined : v), esquema.optional());
}

/** "true"/"false" explícitos. `z.coerce.boolean()` no vale: "false" es truthy. */
const booleano = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

const ConfigSchema = z.object({
  DATABASE_URL: z.string().min(1, "hace falta la cadena de conexión a Postgres"),

  /**
   * Clave HMAC de las URLs de medios. Mínimo 32 caracteres: por debajo de eso
   * la firma es adivinable y las URLs firmadas dejan de significar nada.
   */
  MEDIA_SIGNING_KEY: z.string().min(32, "la clave de firma necesita 32 caracteres o más"),

  /** Origen público del viewer: es la base de los enlaces /v/:token. */
  BASE_URL: z.string().url(),

  PORT: z.coerce.number().int().positive().max(65535).default(8787),

  /**
   * Solo se hace caso a `X-Forwarded-For` si delante hay un proxy de confianza
   * (Caddy, Cloudflare). Con esto en false, la cabecera se ignora: si no,
   * cualquiera se salta el límite del login mandándola falseada.
   */
  TRUST_PROXY: booleano,

  /**
   * De dónde salen los bytes de los medios.
   *   r2       — producción: Cloudflare R2, que no cobra el tráfico de salida.
   *   supabase — el del MVP, mientras no hubo tarjeta.
   *   fs       — disco local, para desarrollo: sobrevive a reiniciar el proceso.
   *   memory   — solo pruebas; los medios mueren con el proceso.
   */
  STORAGE_DRIVER: z.enum(["r2", "supabase", "fs", "memory"]).default("supabase"),

  /** Dónde deja los medios el driver `fs`. */
  STORAGE_FS_DIR: opcional(z.string().min(1)).pipe(z.string().default(".medios-locales")),

  /*
   * Cloudflare R2. Se elige para producción por el EGRESO: cada visita a una
   * foto vuelve a leer el original para incrustarle su marca, así que un
   * proveedor que cobre los bytes de salida cobra ese diseño dos veces.
   *
   * La clave secreta no sale del proceso Node: el navegador solo recibe URLs
   * firmadas por nosotros contra /m/*.
   */
  R2_ACCOUNT_ID: opcional(z.string().min(1)),
  R2_ACCESS_KEY_ID: opcional(z.string().min(1)),
  R2_SECRET_ACCESS_KEY: opcional(z.string().min(1)),
  R2_BUCKET: opcional(z.string().min(1)),

  SUPABASE_URL: opcional(z.string().url()),
  /** Salta RLS: nunca sale del proceso Node, nunca a un log, nunca al navegador. */
  SUPABASE_SECRET_KEY: opcional(z.string().min(1)),
  SUPABASE_MEDIA_BUCKET: opcional(z.string().min(1)).pipe(z.string().default("vistta-media")),

  /*
   * Datos de cobro. No hay pasarela: el cliente paga por Bizum o PayPal y una
   * persona concilia. Estos dos van en la configuración y no en el código
   * porque son datos de contacto del negocio, cambian sin que cambie el
   * software, y en un despliegue de otro no tienen por qué ser los mismos.
   *
   * Se los enseña el backend al cliente que pide mejorar de plan, así que son
   * públicos por definición: no son un secreto, son un número de teléfono.
   */
  BIZUM_TELEFONO: opcional(z.string().min(1)),
  PAYPAL_DESTINO: opcional(z.string().min(1)),
});

export type Config = Readonly<z.infer<typeof ConfigSchema>>;

export class ConfigError extends Error {}

/** Valida el entorno y devuelve la configuración, o explota con el motivo. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const detalle = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(raíz)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Configuración no válida:\n${detalle}`);
  }

  const config = parsed.data;
  // Un driver sin credenciales arranca y falla en la primera subida, que es el
  // peor momento posible para enterarse. Se comprueba aquí, al arrancar.
  if (
    config.STORAGE_DRIVER === "supabase" &&
    !(config.SUPABASE_URL && config.SUPABASE_SECRET_KEY)
  ) {
    throw new ConfigError("STORAGE_DRIVER=supabase necesita SUPABASE_URL y SUPABASE_SECRET_KEY.");
  }
  if (
    config.STORAGE_DRIVER === "r2" &&
    !(
      config.R2_ACCOUNT_ID &&
      config.R2_ACCESS_KEY_ID &&
      config.R2_SECRET_ACCESS_KEY &&
      config.R2_BUCKET
    )
  ) {
    throw new ConfigError(
      "STORAGE_DRIVER=r2 necesita R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY y R2_BUCKET."
    );
  }

  return Object.freeze(config);
}
