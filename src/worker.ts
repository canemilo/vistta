import type { Db } from "./db";
import type { Storage } from "./storage/port";
import { completar, encolar, fallar, tomarTrabajo, type Trabajo } from "./lib/jobs";
import { pasarReaper } from "./lib/reaper";

/**
 * El trabajador de la cola. Vive en el mismo proceso que la API en el MVP, y
 * podrá salirse a otro sin tocar nada: lo único que comparte es la base, y la
 * toma de trabajos ya está preparada para varios a la vez.
 */

export const TRABAJO_REAPER = "reaper";

/** Cada cuánto se vuelve a encolar la limpieza. */
export const PERIODO_REAPER_MS = 15 * 60 * 1000;

export interface DepsDelTrabajador {
  db: Db;
  storage: Storage;
}

type Manejador = (deps: DepsDelTrabajador, trabajo: Trabajo) => Promise<void>;

const MANEJADORES: Record<string, Manejador> = {
  async [TRABAJO_REAPER]({ db, storage }) {
    const resultado = await pasarReaper(db, storage);
    // Sin PII: solo cuántos, nunca de quién.
    if (resultado.reservasCaducadas + resultado.fallidos + resultado.sinReferencias > 0) {
      console.warn(
        `reaper: ${resultado.reservasCaducadas} reservas, ${resultado.fallidos} fallidos, ` +
          `${resultado.sinReferencias} sin referencias`
      );
    }
    // La limpieza se reencola a sí misma: así el periodo vive en la cola y no
    // en un temporizador de un proceso concreto, que con dos procesos daría dos
    // limpiezas por periodo.
    await encolar(db, TRABAJO_REAPER, {}, Date.now() + PERIODO_REAPER_MS);
  },
};

/**
 * Procesa un trabajo si lo hay. Devuelve false cuando la cola está vacía, para
 * que quien llame sepa que puede dormirse.
 */
export async function procesarUno(deps: DepsDelTrabajador): Promise<boolean> {
  const trabajo = await tomarTrabajo(deps.db);
  if (!trabajo) return false;

  const manejador = MANEJADORES[trabajo.kind];
  if (!manejador) {
    await fallar(deps.db, trabajo, new Error("TrabajoDesconocido"));
    return true;
  }

  try {
    await manejador(deps, trabajo);
    await completar(deps.db, trabajo.id);
  } catch (err) {
    // El error no se propaga: un trabajo roto no puede tumbar al trabajador.
    console.error(`trabajo ${trabajo.kind} : ${err instanceof Error ? err.name : "error"}`);
    await fallar(deps.db, trabajo, err);
  }
  return true;
}

/** Deja encolada la limpieza si no hay ya una esperando. */
export async function asegurarReaper(db: Db): Promise<void> {
  const pendiente = await db.one<{ id: string }>(
    `SELECT id FROM vistta.jobs WHERE kind = $1 AND status IN ('pending', 'running') LIMIT 1`,
    [TRABAJO_REAPER]
  );
  if (!pendiente) await encolar(db, TRABAJO_REAPER);
}

/** Arranca el bucle. Devuelve la función para pararlo. */
export function arrancarTrabajador(deps: DepsDelTrabajador, intervaloMs = 5_000): () => void {
  let parado = false;
  let corriendo = false;

  const tick = async () => {
    // Sin solaparse consigo mismo: si una pasada tarda más que el intervalo, la
    // siguiente espera en vez de acumularse.
    if (parado || corriendo) return;
    corriendo = true;
    try {
      // Vaciar lo que haya antes de volver a dormir.
      while (!parado && (await procesarUno(deps))) {
        /* seguir */
      }
    } catch (err) {
      console.error(`trabajador : ${err instanceof Error ? err.name : "error"}`);
    } finally {
      corriendo = false;
    }
  };

  const temporizador = setInterval(() => void tick(), intervaloMs);
  // No mantiene vivo el proceso: si la API se para, el trabajador no la retiene.
  temporizador.unref?.();
  void tick();

  return () => {
    parado = true;
    clearInterval(temporizador);
  };
}
