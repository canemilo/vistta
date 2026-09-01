import { migrar } from "../src/migrate";
import { TEST_DATABASE_URL } from "./db-url";

/**
 * Prepara la base de pruebas UNA vez por ejecución.
 *
 * Es Postgres de verdad, no un doble: los dos invariantes del producto (el
 * consumo atómico del pase y, en el bloque E, la reserva de cuota) son de
 * concurrencia, y un motor monohilo los daría por buenos aunque estuvieran mal.
 */
export default async function setup(): Promise<void> {
  await migrar(TEST_DATABASE_URL, { silencioso: true });
}
