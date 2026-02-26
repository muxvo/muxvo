import type { FastifyPluginAsync } from 'fastify';
import { query } from '../db/index.js';
import { NotFoundError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillRow {
  id: string;
  name: string;
  description: string;
  author: string;
  category: string;
  installs: number;
  score: number;
  status: string;
  created_at: Date;
  updated_at: Date;
}

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const searchQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      q: { type: 'string' as const, default: '' },
      category: { type: 'string' as const, default: '' },
      page: { type: 'integer' as const, minimum: 1, default: 1 },
      limit: { type: 'integer' as const, minimum: 1, maximum: 50, default: 20 },
      sort: { type: 'string' as const, enum: ['newest', 'popular', 'score'], default: 'popular' },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSkill(row: SkillRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    author: row.author,
    category: row.category,
    installs: row.installs,
    score: Number(row.score),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Marketplace routes plugin
// ---------------------------------------------------------------------------

export const marketplaceRoutes: FastifyPluginAsync = async (app) => {
  // =========================================================================
  // GET /search — Search/list skills (public)
  // =========================================================================

  app.get<{
    Querystring: { q: string; category: string; page: number; limit: number; sort: string };
  }>('/search', { schema: searchQuerySchema }, async (request) => {
    const { q, category, page, limit, sort } = request.query;
    const offset = (page - 1) * limit;

    // Build WHERE clauses
    const conditions: string[] = ["status = 'published'"];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (q) {
      conditions.push(
        `(name ILIKE $${paramIndex} OR description ILIKE $${paramIndex} OR author ILIKE $${paramIndex})`,
      );
      values.push(`%${q}%`);
      paramIndex++;
    }

    if (category && category !== 'All') {
      conditions.push(`category = $${paramIndex}`);
      values.push(category);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Sort
    const orderMap: Record<string, string> = {
      newest: 'created_at DESC',
      popular: 'installs DESC',
      score: 'score DESC',
    };
    const orderBy = orderMap[sort] || 'installs DESC';

    const [itemsResult, countResult] = await Promise.all([
      query<SkillRow>(
        `SELECT * FROM marketplace_skills
         WHERE ${whereClause}
         ORDER BY ${orderBy}
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM marketplace_skills WHERE ${whereClause}`,
        values,
      ),
    ]);

    return {
      items: itemsResult.rows.map(formatSkill),
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  });

  // =========================================================================
  // GET /:id — Get single skill detail (public)
  // =========================================================================

  app.get<{ Params: { id: string } }>('/:id', async (request) => {
    const { id } = request.params;

    const result = await query<SkillRow>(
      `SELECT * FROM marketplace_skills WHERE id = $1 AND status = 'published'`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Skill not found');
    }

    return formatSkill(result.rows[0]);
  });
};
