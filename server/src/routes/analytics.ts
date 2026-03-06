import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { query } from '../db/index.js';
import { authenticate, optionalAuthenticate } from '../middleware/auth.js';
import { ValidationError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const singleEventSchema = {
  type: 'object' as const,
  required: ['metric'] as const,
  properties: {
    metric: { type: 'string' as const, minLength: 1, maxLength: 100 },
    value: { type: 'number' as const },
    metadata: { type: 'object' as const },
  },
  additionalProperties: false,
};

const trackSchema = {
  body: {
    oneOf: [
      // Single event: { metric, value?, metadata? }
      singleEventSchema,
      // Batch events: { events: [{ metric, value?, metadata? }] }
      {
        type: 'object' as const,
        required: ['events'] as const,
        properties: {
          events: {
            type: 'array' as const,
            items: singleEventSchema,
            minItems: 1,
            maxItems: 100,
          },
        },
        additionalProperties: false,
      },
    ],
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

const dauQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      from: { type: 'string' as const },
      to: { type: 'string' as const },
      source: { type: 'string' as const, enum: ['app', 'web', 'all'] },
    },
    additionalProperties: false,
  },
};

const eventsQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      from: { type: 'string' as const },
      to: { type: 'string' as const },
      metric: { type: 'string' as const },
      source: { type: 'string' as const, enum: ['app', 'web', 'all'] },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

interface TrackEvent {
  metric: string;
  value?: number;
  metadata?: object;
}

type TrackBody =
  | TrackEvent
  | { events: TrackEvent[] };

// ---------------------------------------------------------------------------
// Analytics routes plugin
// ---------------------------------------------------------------------------

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  // =========================================================================
  // POST /analytics/track — Record analytics event(s)
  //   Mixed auth: X-Device-ID required + Bearer token optional
  // =========================================================================

  app.post<{
    Body: TrackBody;
  }>('/track', { schema: trackSchema, preHandler: [optionalAuthenticate] }, async (request) => {
    const deviceId = request.headers['x-device-id'] as string | undefined;

    if (!deviceId) {
      throw new ValidationError('X-Device-ID header is required');
    }

    const userId = (request as FastifyRequest & { userId?: string }).userId ?? null;

    // Normalise to array
    const events: TrackEvent[] =
      'events' in request.body ? request.body.events : [request.body];

    for (const event of events) {
      const { metric, value = 1, metadata = {} } = event;

      await query(
        `INSERT INTO analytics_events (date, device_id, user_id, metric, value, metadata)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5)`,
        [deviceId, userId, metric, value, JSON.stringify(metadata)],
      );
    }

    // Piggyback: refresh device last_seen_at (~every 60s from tracker flush)
    await query(
      `UPDATE devices SET last_seen_at = NOW() WHERE device_id = $1`,
      [deviceId],
    );

    return { success: true, tracked: events.length };
  });

  // =========================================================================
  // GET /analytics/dau — Daily active users (admin)
  // =========================================================================

  app.get<{
    Querystring: { from?: string; to?: string; source?: 'web' | 'app' | 'all' };
  }>('/dau', { schema: dauQuerySchema, preHandler: [authenticate] }, async (request) => {
    const {
      from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      source = 'app',
    } = request.query;

    let sql = `SELECT date,
              COUNT(DISTINCT device_id) AS dau,
              COUNT(DISTINCT user_id)   AS registered_users
       FROM analytics_events
       WHERE date >= $1 AND date <= $2`;
    const params: unknown[] = [from, to];

    if (source === 'app') {
      sql += ` AND metric NOT LIKE 'web:%'`;
    } else if (source === 'web') {
      sql += ` AND metric LIKE 'web:%'`;
    }
    // source === 'all': no filter

    sql += ` GROUP BY date ORDER BY date`;

    const result = await query<{
      date: string;
      dau: string;
      registered_users: string;
    }>(sql, params);

    return {
      from,
      to,
      data: result.rows.map((r) => ({
        date: r.date,
        dau: Number(r.dau),
        registered_users: Number(r.registered_users),
      })),
    };
  });

  // =========================================================================
  // GET /analytics/events — Event aggregation (admin)
  // =========================================================================

  app.get<{
    Querystring: { from?: string; to?: string; metric?: string; source?: 'web' | 'app' | 'all' };
  }>('/events', { schema: eventsQuerySchema, preHandler: [authenticate] }, async (request) => {
    const {
      from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      metric,
      source = 'app',
    } = request.query;

    let sql = `SELECT date, metric, SUM(value) AS total
               FROM analytics_events
               WHERE date >= $1 AND date <= $2`;
    const params: unknown[] = [from, to];

    if (source === 'app') {
      sql += ` AND metric NOT LIKE 'web:%'`;
    } else if (source === 'web') {
      sql += ` AND metric LIKE 'web:%'`;
    }
    // source === 'all': no filter

    if (metric) {
      sql += ` AND metric = $${params.length + 1}`;
      params.push(metric);
    }

    sql += ` GROUP BY date, metric ORDER BY date, metric`;

    const result = await query<{
      date: string;
      metric: string;
      total: string;
    }>(sql, params);

    return {
      from,
      to,
      data: result.rows.map((r) => ({
        date: r.date,
        metric: r.metric,
        total: Number(r.total),
      })),
    };
  });

  // =========================================================================
  // GET /analytics/summary — Get analytics summary (legacy, analytics_daily)
  // =========================================================================

  app.get<{
    Querystring: { from?: string; to?: string; metrics?: string };
  }>('/summary', { schema: summaryQuerySchema, preHandler: [authenticate] }, async (request) => {
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
  // DELETE /analytics/ — Clear analytics data before a given date (legacy)
  // =========================================================================

  app.delete<{
    Querystring: { before: string };
  }>('/', { schema: clearQuerySchema, preHandler: [authenticate] }, async (request) => {
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
  // GET /analytics/metrics — List all recorded metric names (legacy)
  // =========================================================================

  app.get('/metrics', { preHandler: [authenticate] }, async () => {
    const result = await query<{ metric: string }>(
      `SELECT DISTINCT metric FROM analytics_daily ORDER BY metric`,
    );

    return { metrics: result.rows.map((r) => r.metric) };
  });
};
