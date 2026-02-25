import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { query } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { ValidationError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const trackSchema = {
  body: {
    type: 'object' as const,
    required: ['metric'] as const,
    properties: {
      metric: { type: 'string' as const, minLength: 1, maxLength: 100 },
      value: { type: 'number' as const },
      metadata: { type: 'object' as const },
    },
    additionalProperties: false,
  },
};

const summaryQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      from: { type: 'string' as const },
      to: { type: 'string' as const },
      metrics: { type: 'string' as const },
    },
    additionalProperties: false,
  },
};

const clearQuerySchema = {
  querystring: {
    type: 'object' as const,
    required: ['before'] as const,
    properties: {
      before: { type: 'string' as const },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Analytics routes plugin
// ---------------------------------------------------------------------------

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  // All routes in this plugin require authentication
  app.addHook('preHandler', authenticate);

  // =========================================================================
  // POST /analytics/track — Record an analytics event
  // =========================================================================

  app.post<{
    Body: { metric: string; value?: number; metadata?: object };
  }>('/track', { schema: trackSchema }, async (request) => {
    const { metric, value = 1, metadata = {} } = request.body;

    await query(
      `INSERT INTO analytics_daily (date, metric, value, metadata)
       VALUES (CURRENT_DATE, $1, $2, $3)
       ON CONFLICT (date, metric)
       DO UPDATE SET value = analytics_daily.value + EXCLUDED.value,
                     metadata = EXCLUDED.metadata`,
      [metric, value, JSON.stringify(metadata)],
    );

    return { success: true };
  });

  // =========================================================================
  // GET /analytics/summary — Get analytics summary
  // =========================================================================

  app.get<{
    Querystring: { from?: string; to?: string; metrics?: string };
  }>('/summary', { schema: summaryQuerySchema }, async (request) => {
    const {
      from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      metrics,
    } = request.query;

    let sql = `SELECT date, metric, value, metadata
               FROM analytics_daily
               WHERE date >= $1 AND date <= $2`;
    const params: unknown[] = [from, to];

    if (metrics) {
      const metricList = metrics.split(',').map((m) => m.trim());
      sql += ` AND metric = ANY($3)`;
      params.push(metricList);
    }

    sql += ` ORDER BY date, metric`;

    const result = await query<{
      date: string;
      metric: string;
      value: number;
      metadata: object;
    }>(sql, params);

    return {
      from,
      to,
      data: result.rows,
    };
  });

  // =========================================================================
  // DELETE /analytics/ — Clear analytics data before a given date
  // =========================================================================

  app.delete<{
    Querystring: { before: string };
  }>('/', { schema: clearQuerySchema }, async (request) => {
    const { before } = request.query;

    if (!before) {
      throw new ValidationError(
        'Parameter "before" is required to prevent accidental deletion',
      );
    }

    const result = await query(
      `DELETE FROM analytics_daily WHERE date < $1`,
      [before],
    );

    return { success: true, deletedCount: result.rowCount ?? 0 };
  });

  // =========================================================================
  // GET /analytics/metrics — List all recorded metric names
  // =========================================================================

  app.get('/metrics', async () => {
    const result = await query<{ metric: string }>(
      `SELECT DISTINCT metric FROM analytics_daily ORDER BY metric`,
    );

    return { metrics: result.rows.map((r) => r.metric) };
  });
};
