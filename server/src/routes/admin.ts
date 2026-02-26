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
