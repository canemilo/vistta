import pg from "pg";

/**
 * Acceso a PostgreSQL. Todo lo que toca la base recibe un `Db`, no un Pool:
 * así una transacción y el pool son intercambiables, y las pruebas no necesitan
 * dobles (corren contra Postgres de verdad, que es donde viven los invariantes).
 */

// Los timestamps son bigint de milisegundos. `pg` devuelve int8 como string para
// no perder precisión, pero en milisegundos un number llega hasta el año 275760.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export interface Db {
  /** Una consulta. `rowCount` es la puerta del consumo atómico del pase. */
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: R[]; rowCount: number }>;

  /** Una fila o null. Azúcar sobre `query` para el caso más común. */
  one<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<R | null>;

  /** Ejecuta el bloque dentro de una transacción; revierte si lanza. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

class PgDb implements Db {
  constructor(private readonly ejecutor: pg.Pool | pg.PoolClient) {}

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: R[]; rowCount: number }> {
    const res = await this.ejecutor.query<R>(text, params as unknown[]);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  }

  async one<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    params?: readonly unknown[]
  ): Promise<R | null> {
    const { rows } = await this.query<R>(text, params);
    return rows[0] ?? null;
  }

  async tx<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    // Anidar transacciones no está soportado a propósito: si hiciera falta,
    // sería con savepoints y con un test que lo demuestre.
    if (!(this.ejecutor instanceof pg.Pool)) {
      throw new Error("ya se está dentro de una transacción");
    }
    const client = await this.ejecutor.connect();
    try {
      await client.query("BEGIN");
      const resultado = await fn(new PgDb(client));
      await client.query("COMMIT");
      return resultado;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    // El pooler de Supabase corta las conexiones ociosas: mejor pocas y frescas.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function createDb(pool: pg.Pool): Db {
  return new PgDb(pool);
}
