import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings instead of Date objects
pg.types.setTypeParser(1082, (val: string) => val);

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err: Error) => {
  console.error('[pg] Unexpected error on idle client:', err.message);
});

/**
 * Execute a parameterised SQL query against the connection pool.
 *
 * Usage:
 *   const { rows } = await query('SELECT * FROM users WHERE id = $1', [id]);
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}
