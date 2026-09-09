/**
 * El periodo de un informe, leído de la URL.
 *
 * Vive aparte porque lo usan el informe de una propiedad y la comparativa entre
 * varias, y las dos tienen que entender lo mismo por «desde» y «hasta». Dos
 * lecturas distintas de un rango dan dos números distintos para la misma
 * pregunta, y uno de los dos acaba en una reunión con el propietario.
 */

/** Tope del rango. Más allá, la consulta recorre historia que ya no se enseña. */
export const PERIODO_MAXIMO_MS = 366 * 24 * 60 * 60 * 1000;

export type PeriodoPedido =
  { ok: true; valor: { desde?: number; hasta?: number } } | { ok: false; error: string };

export function periodoDeLaConsulta(desde?: string, hasta?: string): PeriodoPedido {
  const d = numero(desde);
  const h = numero(hasta);
  if (d === "malo" || h === "malo") return { ok: false, error: "el periodo no es válido" };
  if (d !== undefined && h !== undefined) {
    if (h <= d) return { ok: false, error: "el periodo no es válido" };
    if (h - d > PERIODO_MAXIMO_MS) return { ok: false, error: "el periodo es demasiado largo" };
  }
  return { ok: true, valor: { desde: d, hasta: h } };
}

/** Un entero positivo, `undefined` si no viene, `"malo"` si viene y no lo es. */
function numero(v?: string): number | undefined | "malo" {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : "malo";
}
