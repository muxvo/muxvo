import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { pool } from '../db/index.js';
import { redis } from '../db/redis.js';
import { runMigrations } from '../db/migrate.js';

/**
 * Fastify plugin that:
 *  1. Decorates the instance with `db` (pg Pool) and `redis` (ioredis) clients.
 *  2. Runs pending database migrations on startup.
 *  3. Tears down connections on close.
 */
async function dbPlugin(app: FastifyInstance): Promise<void> {
  // Run pending migrations before the server accepts requests
  await runMigrations();

  // Decorate so routes can access via `app.db` / `app.redis`
  app.decorate('db', pool);
  app.decorate('redis', redis);

  // Graceful shutdown
  app.addHook('onClose', async () => {
    await pool.end();
    redis.disconnect();
    app.log.info('[db] Pool ended, Redis disconnected');
  });
}

export default fp(dbPlugin, {
  name: 'db',
});
