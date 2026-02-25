import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '../../migrations');

/**
 * Ensure the `_migrations` bookkeeping table exists.
 */
async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Return the set of migration file names that have already been applied.
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const { rows } = await pool.query<{ name: string }>(
    'SELECT name FROM _migrations ORDER BY id',
  );
  return new Set(rows.map((r: { name: string }) => r.name));
}

/**
 * Extract the "Up" section from a migration file.
 *
 * Convention: everything between the first `-- Up` marker and the first
 * `-- Down` marker (or end-of-file if no Down marker exists).
 */
function extractUpSection(sql: string): string {
  const upIdx = sql.indexOf('-- Up');
  const downIdx = sql.indexOf('-- Down');

  if (upIdx === -1) {
    // No marker -- treat entire file as the Up section
    return sql;
  }

  const start = sql.indexOf('\n', upIdx);
  if (start === -1) return '';

  const end = downIdx === -1 ? sql.length : downIdx;
  return sql.slice(start, end).trim();
}

/**
 * Run all pending migrations in alphabetical order.
 *
 * Each migration is executed inside its own transaction. If a migration
 * fails the transaction is rolled back and the error is re-thrown so the
 * caller can decide how to handle it (e.g. abort startup).
 */
export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();

  // Read and sort migration files
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log('[migrate] All migrations already applied');
    return;
  }

  for (const file of pending) {
    const filePath = join(MIGRATIONS_DIR, file);
    const content = await readFile(filePath, 'utf-8');
    const upSql = extractUpSection(content);

    if (!upSql) {
      console.warn(`[migrate] Skipping ${file} -- empty Up section`);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(upSql);
      await client.query(
        'INSERT INTO _migrations (name) VALUES ($1)',
        [file],
      );
      await client.query('COMMIT');
      console.log(`[migrate] Applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(`[migrate] Failed: ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  console.log(`[migrate] ${pending.length} migration(s) applied`);
}
