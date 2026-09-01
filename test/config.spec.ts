import { describe, it, expect } from "vitest";
import { loadConfig, ConfigError } from "../src/config";

/**
 * La configuración del proceso.
 *
 * El caso de las variables VACÍAS no es hipotético: en un `.env` de despliegue
 * las opcionales se dejan escritas y en blanco, y docker compose las pasa como
 * cadena vacía. Con eso, la API entraba en bucle de reinicio quejándose de una
 * URL de Supabase que nadie había pedido usar. Se descubrió levantando la pila
 * entera, no leyendo el código.
 */

const MINIMO = {
  DATABASE_URL: "postgresql://vistta:vistta@localhost:5433/vistta",
  MEDIA_SIGNING_KEY: "x".repeat(32),
  BASE_URL: "https://vistta.example",
  STORAGE_DRIVER: "memory",
} as NodeJS.ProcessEnv;

describe("configuración", () => {
  it("una variable opcional vacía es una variable que no está", () => {
    const config = loadConfig({
      ...MINIMO,
      SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      R2_BUCKET: "",
      BIZUM_TELEFONO: "",
      PAYPAL_DESTINO: "",
    });
    expect(config.SUPABASE_URL).toBeUndefined();
    expect(config.PAYPAL_DESTINO).toBeUndefined();
  });

  it("una vacía no pisa el valor por defecto de las que lo tienen", () => {
    // Con `""` ganando, el bucket pasaría a ser la cadena vacía y las subidas
    // irían a un sitio que no existe.
    const config = loadConfig({ ...MINIMO, SUPABASE_MEDIA_BUCKET: "", STORAGE_FS_DIR: "" });
    expect(config.SUPABASE_MEDIA_BUCKET).toBe("vistta-media");
    expect(config.STORAGE_FS_DIR).toBe(".medios-locales");
  });

  it("r2 sin credenciales no arranca, en vez de fallar en la primera subida", () => {
    expect(() => loadConfig({ ...MINIMO, STORAGE_DRIVER: "r2" })).toThrow(ConfigError);
    expect(() =>
      loadConfig({
        ...MINIMO,
        STORAGE_DRIVER: "r2",
        R2_ACCOUNT_ID: "cuenta",
        R2_ACCESS_KEY_ID: "llave",
        R2_SECRET_ACCESS_KEY: "secreto",
        R2_BUCKET: "vistta-medios",
      })
    ).not.toThrow();
  });

  it("supabase sin credenciales tampoco", () => {
    expect(() => loadConfig({ ...MINIMO, STORAGE_DRIVER: "supabase" })).toThrow(ConfigError);
  });

  it("una clave de firma corta se rechaza: por debajo de 32 es adivinable", () => {
    expect(() => loadConfig({ ...MINIMO, MEDIA_SIGNING_KEY: "corta" })).toThrow(ConfigError);
  });

  it("TRUST_PROXY solo es cierto con la palabra exacta", () => {
    // `z.coerce.boolean()` daría true con "false", y entonces cualquiera podría
    // fijar su propia identidad por X-Forwarded-For y saltarse el rate limit.
    expect(loadConfig({ ...MINIMO, TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
    expect(loadConfig({ ...MINIMO, TRUST_PROXY: "true" }).TRUST_PROXY).toBe(true);
    expect(loadConfig(MINIMO).TRUST_PROXY).toBe(false);
  });
});
