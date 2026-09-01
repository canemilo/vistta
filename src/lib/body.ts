/**
 * Lectura del cuerpo con tope duro.
 *
 * `Content-Length` lo escribe el cliente: no sirve para decidir cuánto leer,
 * solo para rechazar pronto lo que ya se sabe que sobra. El tope de verdad se
 * aplica contando los bytes según llegan y cortando en cuanto se pasan; si no,
 * basta una petición sin `Content-Length` para que el proceso se coma toda la
 * memoria que quiera el que sube.
 */

export class CuerpoDemasiadoGrandeError extends Error {}

export async function leerCuerpoConTope(req: Request, tope: number): Promise<Uint8Array> {
  // Atajo barato: si ya lo declara más grande, no hace falta leer nada.
  const declarado = Number(req.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > tope) {
    throw new CuerpoDemasiadoGrandeError(`declarados ${declarado} > ${tope}`);
  }

  const stream = req.body;
  if (!stream) return new Uint8Array(0);

  const trozos: Uint8Array[] = [];
  let total = 0;
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > tope) {
        // Cortar la lectura: sin esto se seguirían recibiendo bytes que ya
        // sabemos que no vamos a usar.
        await reader.cancel().catch(() => undefined);
        throw new CuerpoDemasiadoGrandeError(`${total} > ${tope}`);
      }
      trozos.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const trozo of trozos) {
    bytes.set(trozo, offset);
    offset += trozo.byteLength;
  }
  return bytes;
}
