import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db/index.js';
import { authenticateAdmin } from '../middleware/admin.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRow {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  status: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const usersListSchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      page: { type: 'integer' as const, minimum: 1, default: 1 },
      limit: { type: 'integer' as const, minimum: 1, maximum: 100, default: 20 },
      q: { type: 'string' as const, default: '' },
      status: { type: 'string' as const, default: '' },
      sort: { type: 'string' as const, enum: ['newest', 'oldest', 'name'], default: 'newest' },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUser(row: UserRow) {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    status: row.status,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Admin routes plugin
// ---------------------------------------------------------------------------

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // All admin routes require admin role
  app.addHook('preHandler', authenticateAdmin);

  // =========================================================================
  // GET /admin/stats — Dashboard statistics
  // =========================================================================

  app.get('/stats', async () => {
    const [usersCount, activeCount, showcaseCount, skillCount] = await Promise.all([
      query<{ count: string }>(`SELECT COUNT(*) as count FROM users`),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM users WHERE status = 'active'`),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM showcases WHERE status = 'published'`),
      query<{ count: string }>(`SELECT COUNT(*) as count FROM marketplace_skills WHERE status = 'published'`),
    ]);

    // Signups per day (last 30 days)
    const signupTrend = await query<{ date: string; count: string }>(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM users
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date`,
    );

    return {
      totalUsers: parseInt(usersCount.rows[0].count, 10),
      activeUsers: parseInt(activeCount.rows[0].count, 10),
      publishedShowcases: parseInt(showcaseCount.rows[0].count, 10),
      publishedSkills: parseInt(skillCount.rows[0].count, 10),
      signupTrend: signupTrend.rows.map((r) => ({
        date: r.date,
        count: parseInt(r.count, 10),
      })),
    };
  });

  // =========================================================================
  // GET /admin/users — Paginated user list with search
  // =========================================================================

  app.get<{
    Querystring: { page: number; limit: number; q: string; status: string; sort: string };
  }>('/users', { schema: usersListSchema }, async (request) => {
    const { page, limit, q, status, sort } = request.query;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (q) {
      conditions.push(
        `(display_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`,
      );
      values.push(`%${q}%`);
      paramIndex++;
    }

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const orderMap: Record<string, string> = {
      newest: 'created_at DESC',
      oldest: 'created_at ASC',
      name: 'display_name ASC NULLS LAST',
    };
    const orderBy = orderMap[sort] || 'created_at DESC';

    const [itemsResult, countResult] = await Promise.all([
      query<UserRow>(
        `SELECT * FROM users ${whereClause} ORDER BY ${orderBy} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM users ${whereClause}`,
        values,
      ),
    ]);

    return {
      items: itemsResult.rows.map(formatUser),
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  });

  // =========================================================================
  // PATCH /admin/users/:id/role — Update user role
  // =========================================================================

  app.patch<{
    Params: { id: string };
    Body: { role: string };
  }>(
    '/users/:id/role',
    {
      schema: {
        body: {
          type: 'object' as const,
          required: ['role'],
          properties: {
            role: { type: 'string' as const, enum: ['user', 'admin'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { role } = request.body;

      const result = await query<UserRow>(
        `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [role, id],
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      return formatUser(result.rows[0]);
    },
  );

  // =========================================================================
  // GET /admin/analytics/dau — Daily active users
  // =========================================================================

  app.get<{
    Querystring: { from?: string; to?: string; source?: 'web' | 'app' };
  }>('/analytics/dau', async (request) => {
    const {
      from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      source,
    } = request.query;

    let sql = `SELECT date,
              COUNT(DISTINCT device_id) AS dau,
              COUNT(DISTINCT user_id) AS registered_users
       FROM analytics_events
       WHERE date >= $1 AND date <= $2`;
    const params: unknown[] = [from, to];

    if (source === 'web') {
      sql += ` AND metric LIKE 'web:%'`;
    } else if (source === 'app') {
      sql += ` AND metric NOT LIKE 'web:%'`;
    }

    sql += ` GROUP BY date ORDER BY date`;

    const result = await query<{ date: string; dau: string; registered_users: string }>(
      sql, params,
    );

    return {
      from, to,
      data: result.rows.map(r => ({
        date: r.date,
        dau: Number(r.dau),
        registered_users: Number(r.registered_users),
      })),
    };
  });

  // =========================================================================
  // GET /admin/analytics/events — Event metrics
  // =========================================================================

  app.get<{
    Querystring: { from?: string; to?: string; metric?: string; source?: 'web' | 'app' };
  }>('/analytics/events', async (request) => {
    const {
      from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to = new Date().toISOString().slice(0, 10),
      metric,
      source,
    } = request.query;

    let sql = `SELECT date, metric, SUM(value) AS total
               FROM analytics_events
               WHERE date >= $1 AND date <= $2`;
    const params: unknown[] = [from, to];

    if (source === 'web') {
      sql += ` AND metric LIKE 'web:%'`;
    } else if (source === 'app') {
      sql += ` AND metric NOT LIKE 'web:%'`;
    }

    if (metric) {
      sql += ` AND metric = $${params.length + 1}`;
      params.push(metric);
    }

    sql += ` GROUP BY date, metric ORDER BY date, metric`;

    const result = await query<{ date: string; metric: string; total: string }>(sql, params);

    return {
      from, to,
      data: result.rows.map(r => ({
        date: r.date,
        metric: r.metric,
        total: Number(r.total),
      })),
    };
  });

  // =========================================================================
  // GET /admin/analytics/retention — Retention rates + cohort matrix
  // =========================================================================

  app.get<{
    Querystring: { granularity?: 'week' | 'month' };
  }>('/analytics/retention', {
    schema: {
      querystring: {
        type: 'object' as const,
        properties: {
          granularity: { type: 'string' as const, enum: ['week', 'month'], default: 'week' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const granularity = request.query.granularity ?? 'week';

    // --- a) Overall retention rates (D1 / D7 / D30) ---
    // Based on devices first seen in the last 60 days
    const retentionResult = await query<{
      period: string;
      total_new: string;
      retained: string;
    }>(
      `WITH new_devices AS (
        SELECT device_id, DATE(first_seen_at) AS first_date
        FROM devices
        WHERE first_seen_at >= NOW() - INTERVAL '60 days'
      ),
      retention_check AS (
        SELECT
          nd.device_id,
          nd.first_date,
          CASE WHEN EXISTS (
            SELECT 1 FROM analytics_events ae
            WHERE ae.device_id = nd.device_id
              AND ae.date = nd.first_date + 1
          ) THEN 1 ELSE 0 END AS d1,
          CASE WHEN EXISTS (
            SELECT 1 FROM analytics_events ae
            WHERE ae.device_id = nd.device_id
              AND ae.date = nd.first_date + 7
          ) THEN 1 ELSE 0 END AS d7,
          CASE WHEN EXISTS (
            SELECT 1 FROM analytics_events ae
            WHERE ae.device_id = nd.device_id
              AND ae.date = nd.first_date + 30
          ) THEN 1 ELSE 0 END AS d30
        FROM new_devices nd
        WHERE nd.first_date <= CURRENT_DATE - 1
      )
      SELECT 'D1' AS period,
             COUNT(*)::text AS total_new,
             SUM(d1)::text AS retained
      FROM retention_check
      WHERE first_date <= CURRENT_DATE - 1
      UNION ALL
      SELECT 'D7',
             COUNT(*)::text,
             SUM(d7)::text
      FROM retention_check
      WHERE first_date <= CURRENT_DATE - 7
      UNION ALL
      SELECT 'D30',
             COUNT(*)::text,
             SUM(d30)::text
      FROM retention_check
      WHERE first_date <= CURRENT_DATE - 30`,
    );

    const rates: Record<string, { total: number; retained: number; rate: number }> = {};
    for (const row of retentionResult.rows) {
      const total = Number(row.total_new);
      const retained = Number(row.retained);
      rates[row.period] = {
        total,
        retained,
        rate: total > 0 ? Math.round((retained / total) * 1000) / 10 : 0,
      };
    }

    // --- b) Cohort matrix ---
    const truncFn = granularity === 'week' ? `DATE_TRUNC('week', first_seen_at)` : `DATE_TRUNC('month', first_seen_at)`;
    const intervalUnit = granularity === 'week' ? 'weeks' : 'months';
    const maxPeriods = granularity === 'week' ? 12 : 6;

    const cohortResult = await query<{
      cohort: string;
      cohort_size: string;
      period_offset: string;
      active_count: string;
    }>(
      `WITH cohorts AS (
        SELECT
          device_id,
          ${truncFn}::date AS cohort
        FROM devices
        WHERE first_seen_at >= NOW() - INTERVAL '${maxPeriods} ${intervalUnit}'
      ),
      cohort_sizes AS (
        SELECT cohort, COUNT(DISTINCT device_id) AS cohort_size
        FROM cohorts
        GROUP BY cohort
      ),
      periods AS (
        SELECT generate_series(0, ${maxPeriods - 1}) AS period_offset
      ),
      activity AS (
        SELECT
          c.cohort,
          p.period_offset,
          COUNT(DISTINCT ae.device_id) AS active_count
        FROM cohorts c
        CROSS JOIN periods p
        JOIN analytics_events ae ON ae.device_id = c.device_id
          AND ae.date >= (c.cohort + (p.period_offset || ' ${intervalUnit}')::interval)::date
          AND ae.date < (c.cohort + ((p.period_offset + 1) || ' ${intervalUnit}')::interval)::date
        GROUP BY c.cohort, p.period_offset
      )
      SELECT
        cs.cohort::text,
        cs.cohort_size::text,
        a.period_offset::text,
        COALESCE(a.active_count, 0)::text AS active_count
      FROM cohort_sizes cs
      CROSS JOIN periods p
      LEFT JOIN activity a ON a.cohort = cs.cohort AND a.period_offset = p.period_offset
      ORDER BY cs.cohort, p.period_offset`,
    );

    // Group by cohort
    const cohortMap = new Map<string, { size: number; retention: number[] }>();
    for (const row of cohortResult.rows) {
      if (!cohortMap.has(row.cohort)) {
        cohortMap.set(row.cohort, {
          size: Number(row.cohort_size),
          retention: [],
        });
      }
      const entry = cohortMap.get(row.cohort)!;
      const activeCount = Number(row.active_count);
      entry.retention.push(
        entry.size > 0 ? Math.round((activeCount / entry.size) * 1000) / 10 : 0,
      );
    }

    const cohorts = Array.from(cohortMap.entries()).map(([cohort, data]) => ({
      cohort,
      size: data.size,
      retention: data.retention,
    }));

    return { rates, cohorts, granularity };
  });

  // =========================================================================
  // GET /admin/devices — Paginated device list with search
  // =========================================================================

  app.get<{
    Querystring: { page: number; limit: number; q: string; status: string };
  }>('/devices', {
    schema: {
      querystring: {
        type: 'object' as const,
        properties: {
          page: { type: 'integer' as const, minimum: 1, default: 1 },
          limit: { type: 'integer' as const, minimum: 1, maximum: 100, default: 20 },
          q: { type: 'string' as const, default: '' },
          status: { type: 'string' as const, default: '' },
        },
        additionalProperties: false,
      },
    },
  }, async (request) => {
    const { page, limit, q, status } = request.query;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (q) {
      conditions.push(
        `(d.hostname ILIKE $${paramIndex} OR d.device_id ILIKE $${paramIndex})`,
      );
      values.push(`%${q}%`);
      paramIndex++;
    }

    if (status) {
      conditions.push(`d.status = $${paramIndex}`);
      values.push(status);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [itemsResult, countResult] = await Promise.all([
      query<{
        id: string;
        device_id: string;
        user_id: string | null;
        name: string | null;
        platform: string | null;
        arch: string | null;
        os_version: string | null;
        app_version: string | null;
        hostname: string | null;
        last_ip: string | null;
        status: string;
        first_seen_at: Date;
        last_seen_at: Date;
        user_email: string | null;
        user_display_name: string | null;
      }>(
        `SELECT d.*, u.email as user_email, u.display_name as user_display_name
         FROM devices d
         LEFT JOIN users u ON d.user_id = u.id
         ${whereClause}
         ORDER BY d.last_seen_at DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM devices d ${whereClause}`,
        values,
      ),
    ]);

    return {
      items: itemsResult.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  });

  // =========================================================================
  // PATCH /admin/devices/:id/status — Block/unblock device
  // =========================================================================

  app.patch<{
    Params: { id: string };
    Body: { status: string };
  }>(
    '/devices/:id/status',
    {
      schema: {
        body: {
          type: 'object' as const,
          required: ['status'],
          properties: {
            status: { type: 'string' as const, enum: ['active', 'blocked'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { status } = request.body;

      const result = await query(
        `UPDATE devices SET status = $1 WHERE id = $2 RETURNING *`,
        [status, id],
      );

      if (result.rows.length === 0) {
        throw new Error('Device not found');
      }

      // When blocking a device, also revoke its refresh tokens
      if (status === 'blocked') {
        await query(
          `DELETE FROM refresh_tokens WHERE device_info->>'device_id' = (SELECT device_id FROM devices WHERE id = $1)`,
          [id],
        );
      }

      return result.rows[0];
    },
  );

  // =========================================================================
  // PATCH /admin/users/:id/status — Update user status (ban/activate)
  // =========================================================================

  app.patch<{
    Params: { id: string };
    Body: { status: string };
  }>(
    '/users/:id/status',
    {
      schema: {
        body: {
          type: 'object' as const,
          required: ['status'],
          properties: {
            status: { type: 'string' as const, enum: ['active', 'suspended', 'deleted'] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { status } = request.body;

      const result = await query<UserRow>(
        `UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [status, id],
      );

      if (result.rows.length === 0) {
        throw new Error('User not found');
      }

      return formatUser(result.rows[0]);
    },
  );
};
