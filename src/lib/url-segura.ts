import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import type { LookupAddress, LookupOptions } from "node:dns";

/**
 * El guardia contra la falsificación de peticiones del lado del servidor (SSRF).
 *
 * ============================================================================
 *  ESTA ES LA PARTE MÁS PELIGROSA DE LA INTEGRACIÓN CON UN CRM.
 * ============================================================================
 *
 * El agente escribe una dirección y NUESTRO servidor le hace una petición, desde
 * dentro de nuestra red. Sin controles, esa dirección puede apuntar a
 * `localhost`, a la base de datos que no publica puerto al exterior, o al
 * servicio de metadatos del proveedor —169.254.169.254—, que en la mayoría de
 * las nubes entrega credenciales de la máquina a quien las pida.
 *
 * Cuatro capas, y ninguna sobra:
 *
 *   1. **Solo `https`, y solo el puerto 443.** Un esquema `file://` o `gopher://`
 *      es un vector conocido, y un puerto raro es casi siempre un servicio
 *      interno: ningún CRM del mercado recibe webhooks fuera del 443.
 *   2. **Sin credenciales en la URL.** `https://usuario:clave@…` las mandaría a
 *      un tercero, y además confunde a los analizadores de URL más de lo que
 *      parece.
 *   3. **Se resuelve el DNS y se miran LAS IP**, no el texto. `interno.ejemplo`
 *      es un nombre perfectamente público que puede resolver a 10.0.0.5. Se
 *      rechaza si CUALQUIERA de las direcciones resueltas es privada, no solo
 *      la primera: un nombre con dos registros A colaría por el segundo.
 *   4. **La resolución se FIJA en el envío** (`lookupSeguro`), y esto es lo que
 *      cierra el DNS rebinding. Comprobar al guardar y volver a resolver al
 *      enviar deja una ventana: el mismo nombre puede contestar una IP pública
 *      cuando se comprueba y 127.0.0.1 medio segundo después. El socket se
 *      conecta a la dirección que este módulo ha validado, no a otra.
 *
 * Y una quinta que vive en quien llama: NO se siguen redirecciones. Un 302 a
 * `http://169.254.169.254` se salta las cuatro de arriba de una sola vez.
 */

/** Lo único que se admite. Ningún CRM recibe webhooks fuera de aquí. */
const PUERTO_UNICO = 443;

export class UrlNoPermitidaError extends Error {
  constructor(readonly motivo: string) {
    super(motivo);
  }
}

/**
 * Comprueba la forma de la URL. No toca la red: es lo que se puede decir al
 * instante mientras alguien teclea.
 */
export function urlBienFormada(valor: string): URL {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new UrlNoPermitidaError("la dirección no es una URL válida");
  }
  if (url.protocol !== "https:") {
    throw new UrlNoPermitidaError("la dirección tiene que empezar por https://");
  }
  if (url.username || url.password) {
    throw new UrlNoPermitidaError("la dirección no puede llevar usuario ni contraseña");
  }
  if (url.port !== "" && url.port !== String(PUERTO_UNICO)) {
    throw new UrlNoPermitidaError("solo se admite el puerto 443");
  }
  return url;
}

/**
 * ¿Es una dirección a la que no debemos llamar nunca?
 *
 * Se escribe sobre los BYTES de la dirección y no sobre su texto: `0177.0.0.1`,
 * `2130706433` y `127.1` son todos 127.0.0.1 escritos de otra manera, y un
 * filtro de cadenas los deja pasar. Aquí llega lo que ya ha resuelto el DNS,
 * así que la forma rara ya no existe.
 */
export function esDireccionInterna(direccion: string, familia: number): boolean {
  if (familia === 4) return esIPv4Interna(direccion);
  return esIPv6Interna(direccion);
}

function esIPv4Interna(ip: string): boolean {
  /*
   * El análisis es ESTRICTO: cuatro grupos de dígitos decimales, sin ceros
   * delante. `Number("0177")` da 177, pero `0177` en notación octal —que es como
   * lo entienden muchas bibliotecas de red— es 127. Aceptarlo sería leer una
   * dirección distinta de la que va a marcar quien se conecte, que es
   * exactamente el hueco por el que se cuelan estos filtros.
   */
  const grupos = ip.split(".");
  const valido =
    grupos.length === 4 && grupos.every((g) => /^(0|[1-9][0-9]{0,2})$/.test(g) && Number(g) <= 255);
  // Si no se entiende, no se llama. Ante la duda, la respuesta es no.
  if (!valido) return true;
  const [a, b] = grupos.map(Number);
  return (
    a === 0 || // «esta red»
    a === 10 || // privada
    a === 127 || // bucle local
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // enlace local: aquí viven los metadatos de la nube
    (a === 172 && b >= 16 && b <= 31) || // privada
    (a === 192 && b === 168) || // privada
    (a === 192 && b === 0) || // documentación y protocolos
    (a === 198 && (b === 18 || b === 19)) || // pruebas de rendimiento
    a >= 224 // multicast y reservadas
  );
}

function esIPv6Interna(ip: string): boolean {
  const bajo = ip.toLowerCase().split("%")[0];
  if (bajo === "::" || bajo === "::1") return true; // sin especificar y bucle local
  // Direcciones IPv4 embebidas: se juzgan como lo que son.
  const embebida = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(bajo);
  if (embebida) return esIPv4Interna(embebida[1]);
  return (
    bajo.startsWith("fe8") || // enlace local fe80::/10
    bajo.startsWith("fe9") ||
    bajo.startsWith("fea") ||
    bajo.startsWith("feb") ||
    bajo.startsWith("fc") || // únicas locales fc00::/7
    bajo.startsWith("fd") ||
    bajo.startsWith("ff") // multicast
  );
}

/**
 * Resuelve un nombre y devuelve sus direcciones, o lanza si alguna es interna.
 *
 * TODAS, no la primera: un nombre con dos registros A —uno público y otro
 * privado— pasaría el control por el que se mira y se conectaría por el otro.
 */
export async function direccionesPublicasDe(hostname: string): Promise<LookupAddress[]> {
  const direcciones = await new Promise<LookupAddress[]>((resolver, rechazar) => {
    dnsLookup(hostname, { all: true }, (err, addrs) => {
      if (err) rechazar(new UrlNoPermitidaError("no se ha podido resolver la dirección"));
      else resolver(addrs);
    });
  });

  if (direcciones.length === 0) {
    throw new UrlNoPermitidaError("no se ha podido resolver la dirección");
  }
  for (const { address, family } of direcciones) {
    if (esDireccionInterna(address, family)) {
      // Sin decir CUÁL: el mensaje volvería al panel y sería un escáner de la
      // red interna a base de probar nombres y leer errores.
      throw new UrlNoPermitidaError("la dirección apunta a una red interna");
    }
  }
  return direcciones;
}

/**
 * ¿Es un host al que no debemos conectarnos, sabiéndolo ya sin resolver nada?
 *
 * Existe por una trampa de Node que el `lookup` NO cubre: **cuando el host de la
 * URL es una IP literal, Node no llama al `lookup` en absoluto**. Se conecta
 * directamente. Así que `https://127.0.0.1/hook` se saltaba entero el guardia
 * del envío, y solo lo paraba la comprobación de guardado. Lo encontró la
 * prueba que manda de verdad y mira qué error sale.
 *
 * Para un NOMBRE devuelve false: a ese lo juzga `lookupSeguro`, que es quien
 * puede resolverlo.
 */
export function hostProhibido(hostname: string): boolean {
  // Un IPv6 viene entre corchetes dentro de una URL.
  const limpio = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const familia = isIP(limpio);
  if (familia === 0) return false;
  return esDireccionInterna(limpio, familia);
}

/** Comprobación completa para el momento de guardar: forma y red. */
export async function comprobarDestinoDeWebhook(valor: string): Promise<URL> {
  const url = urlBienFormada(valor);
  await direccionesPublicasDe(url.hostname);
  return url;
}

/**
 * El `lookup` que se le pasa a `https.request`.
 *
 * Aquí está la diferencia entre comprobar y proteger: el socket se conecta a lo
 * que devuelva esta función, así que si valida y devuelve la misma dirección, no
 * hay ventana entre la comprobación y la conexión. Volver a resolver por su
 * cuenta —que es lo que hace Node si no se le pasa nada— sí la deja.
 */
export function lookupSeguro(
  hostname: string,
  opciones: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    direccion: string | LookupAddress[],
    familia?: number
  ) => void
): void {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return callback(new UrlNoPermitidaError("no se ha podido resolver la dirección"), "");
    for (const { address, family } of addrs) {
      if (esDireccionInterna(address, family)) {
        return callback(new UrlNoPermitidaError("la dirección apunta a una red interna"), "");
      }
    }
    // `all` decide la forma de la respuesta, y Node la pide de las dos maneras.
    if (opciones.all) return callback(null, addrs);
    return callback(null, addrs[0].address, addrs[0].family);
  });
}
