import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import { query } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShowcaseRow {
  id: string;
  user_id: string;
  skill_name: string;
  title: string;
  description: string;
  score_data: Record<string, unknown>;
  html_content: string;
  template_id: string;
  status: string;
  slug: string;
  view_count: number;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface CommentRow {
  id: string;
  user_id: string;
  showcase_id: string;
  content: string;
  created_at: Date;
}

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const createShowcaseSchema = {
  body: {
    type: 'object' as const,
    required: ['skillName', 'title', 'description', 'scoreData', 'htmlContent', 'templateId'],
    properties: {
      skillName: { type: 'string' as const, minLength: 1, maxLength: 200 },
      title: { type: 'string' as const, minLength: 1, maxLength: 300 },
      description: { type: 'string' as const, minLength: 1 },
      scoreData: { type: 'object' as const },
      htmlContent: { type: 'string' as const, minLength: 1 },
      templateId: { type: 'string' as const, minLength: 1, maxLength: 50 },
    },
    additionalProperties: false,
  },
};

const updateShowcaseSchema = {
  body: {
    type: 'object' as const,
    properties: {
      title: { type: 'string' as const, minLength: 1, maxLength: 300 },
      description: { type: 'string' as const, minLength: 1 },
      htmlContent: { type: 'string' as const, minLength: 1 },
      templateId: { type: 'string' as const, minLength: 1, maxLength: 50 },
    },
    additionalProperties: false,
  },
};

const listQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      page: { type: 'integer' as const, minimum: 1, default: 1 },
      limit: { type: 'integer' as const, minimum: 1, maximum: 50, default: 20 },
      sort: { type: 'string' as const, enum: ['newest', 'popular'], default: 'newest' },
    },
    additionalProperties: false,
  },
};

const paginationQuerySchema = {
  querystring: {
    type: 'object' as const,
    properties: {
      page: { type: 'integer' as const, minimum: 1, default: 1 },
      limit: { type: 'integer' as const, minimum: 1, maximum: 50, default: 20 },
    },
    additionalProperties: false,
  },
};

const createCommentSchema = {
  body: {
    type: 'object' as const,
    required: ['content'],
    properties: {
      content: { type: 'string' as const, minLength: 1, maxLength: 2000 },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUserId(request: FastifyRequest): string {
  return (request as FastifyRequest & { userId: string }).userId;
}

function generateSlug(skillName: string): string {
  return (
    skillName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') +
    '-' +
    randomBytes(2).toString('hex')
  );
}

function formatShowcase(row: ShowcaseRow) {
  return {
    id: row.id,
    userId: row.user_id,
    skillName: row.skill_name,
    title: row.title,
    description: row.description,
    scoreData: row.score_data,
    htmlContent: row.html_content,
    templateId: row.template_id,
    status: row.status,
    slug: row.slug,
    viewCount: row.view_count,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Showcase routes plugin
// ---------------------------------------------------------------------------

export const showcaseRoutes: FastifyPluginAsync = async (app) => {
  // =========================================================================
  // POST / — Create showcase (authenticated)
  // =========================================================================

  app.post<{
    Body: {
      skillName: string;
      title: string;
      description: string;
      scoreData: Record<string, unknown>;
      htmlContent: string;
      templateId: string;
    };
  }>('/', { schema: createShowcaseSchema, preHandler: [authenticate] }, async (request, reply) => {
    const userId = getUserId(request);
    const { skillName, title, description, scoreData, htmlContent, templateId } = request.body;
    const slug = generateSlug(skillName);

    const result = await query<ShowcaseRow>(
      `INSERT INTO showcases (user_id, skill_name, title, description, score_data, html_content, template_id, slug)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, skillName, title, description, JSON.stringify(scoreData), htmlContent, templateId, slug],
    );

    return reply.status(201).send(formatShowcase(result.rows[0]));
  });

  // =========================================================================
  // GET / — List published showcases (public)
  // =========================================================================

  app.get<{
    Querystring: { page: number; limit: number; sort: string };
  }>('/', { schema: listQuerySchema }, async (request) => {
    const { page, limit, sort } = request.query;
    const offset = (page - 1) * limit;

    const orderBy = sort === 'popular' ? 'view_count DESC' : 'published_at DESC';

    const [itemsResult, countResult] = await Promise.all([
      query<ShowcaseRow>(
        `SELECT * FROM showcases
         WHERE status = 'published'
         ORDER BY ${orderBy}
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM showcases WHERE status = 'published'`,
      ),
    ]);

    return {
      items: itemsResult.rows.map(formatShowcase),
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  });

  // =========================================================================
  // GET /:slug — Get single showcase by slug (public)
  // =========================================================================

  app.get<{ Params: { slug: string } }>('/:slug', async (request) => {
    const { slug } = request.params;

    // Increment view count and fetch in one query
    const result = await query<
      ShowcaseRow & { author_display_name: string | null; author_avatar_url: string | null }
    >(
      `UPDATE showcases SET view_count = view_count + 1
       WHERE slug = $1 AND status = 'published'
       RETURNING *,
         (SELECT display_name FROM users WHERE id = showcases.user_id) as author_display_name,
         (SELECT avatar_url FROM users WHERE id = showcases.user_id) as author_avatar_url`,
      [slug],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Showcase not found');
    }

    const row = result.rows[0];
    return {
      ...formatShowcase(row),
      author: {
        id: row.user_id,
        displayName: row.author_display_name,
        avatarUrl: row.author_avatar_url,
      },
    };
  });

  // =========================================================================
  // PATCH /:id — Update showcase (authenticated, owner only)
  // =========================================================================

  app.patch<{
    Params: { id: string };
    Body: { title?: string; description?: string; htmlContent?: string; templateId?: string };
  }>('/:id', { schema: updateShowcaseSchema, preHandler: [authenticate] }, async (request) => {
    const userId = getUserId(request);
    const { id } = request.params;
    const { title, description, htmlContent, templateId } = request.body;

    if (
      title === undefined &&
      description === undefined &&
      htmlContent === undefined &&
      templateId === undefined
    ) {
      throw new ValidationError('At least one field must be provided');
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      setClauses.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (htmlContent !== undefined) {
      setClauses.push(`html_content = $${paramIndex++}`);
      values.push(htmlContent);
    }
    if (templateId !== undefined) {
      setClauses.push(`template_id = $${paramIndex++}`);
      values.push(templateId);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(id, userId);

    const result = await query<ShowcaseRow>(
      `UPDATE showcases SET ${setClauses.join(', ')}
       WHERE id = $${paramIndex++} AND user_id = $${paramIndex}
       RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Showcase not found or not owned by you');
    }

    return formatShowcase(result.rows[0]);
  });

  // =========================================================================
  // POST /:id/publish — Publish showcase (authenticated, owner only)
  // =========================================================================

  app.post<{ Params: { id: string } }>(
    '/:id/publish',
    { preHandler: [authenticate] },
    async (request) => {
      const userId = getUserId(request);
      const { id } = request.params;

      const result = await query<ShowcaseRow>(
        `UPDATE showcases SET status = 'published', published_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId],
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Showcase not found or not owned by you');
      }

      return formatShowcase(result.rows[0]);
    },
  );

  // =========================================================================
  // POST /:id/unpublish — Unpublish showcase (authenticated, owner only)
  // =========================================================================

  app.post<{ Params: { id: string } }>(
    '/:id/unpublish',
    { preHandler: [authenticate] },
    async (request) => {
      const userId = getUserId(request);
      const { id } = request.params;

      const result = await query<ShowcaseRow>(
        `UPDATE showcases SET status = 'draft', published_at = NULL, updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId],
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Showcase not found or not owned by you');
      }

      return formatShowcase(result.rows[0]);
    },
  );

  // =========================================================================
  // DELETE /:id — Delete showcase (authenticated, owner only)
  // =========================================================================

  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [authenticate] },
    async (request) => {
      const userId = getUserId(request);
      const { id } = request.params;

      const result = await query(
        `DELETE FROM showcases WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, userId],
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Showcase not found or not owned by you');
      }

      return { success: true };
    },
  );

  // =========================================================================
  // POST /:id/like — Toggle like (authenticated)
  // =========================================================================

  app.post<{ Params: { id: string } }>(
    '/:id/like',
    { preHandler: [authenticate] },
    async (request) => {
      const userId = getUserId(request);
      const { id } = request.params;

      // Check showcase exists
      const showcase = await query(
        `SELECT id FROM showcases WHERE id = $1`,
        [id],
      );
      if (showcase.rows.length === 0) {
        throw new NotFoundError('Showcase not found');
      }

      // Check if already liked
      const existing = await query(
        `SELECT 1 FROM showcase_likes WHERE user_id = $1 AND showcase_id = $2`,
        [userId, id],
      );

      if (existing.rows.length > 0) {
        // Unlike
        await query(
          `DELETE FROM showcase_likes WHERE user_id = $1 AND showcase_id = $2`,
          [userId, id],
        );
        return { liked: false };
      } else {
        // Like
        await query(
          `INSERT INTO showcase_likes (user_id, showcase_id) VALUES ($1, $2)`,
          [userId, id],
        );
        return { liked: true };
      }
    },
  );

  // =========================================================================
  // GET /:id/comments — List comments (public)
  // =========================================================================

  app.get<{
    Params: { id: string };
    Querystring: { page: number; limit: number };
  }>('/:id/comments', { schema: paginationQuerySchema }, async (request) => {
    const { id } = request.params;
    const { page, limit } = request.query;
    const offset = (page - 1) * limit;

    // Check showcase exists
    const showcase = await query(`SELECT id FROM showcases WHERE id = $1`, [id]);
    if (showcase.rows.length === 0) {
      throw new NotFoundError('Showcase not found');
    }

    const [itemsResult, countResult] = await Promise.all([
      query<CommentRow & { author_display_name: string | null; author_avatar_url: string | null }>(
        `SELECT c.*, u.display_name as author_display_name, u.avatar_url as author_avatar_url
         FROM showcase_comments c
         JOIN users u ON u.id = c.user_id
         WHERE c.showcase_id = $1
         ORDER BY c.created_at ASC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      ),
      query<{ count: string }>(
        `SELECT COUNT(*) as count FROM showcase_comments WHERE showcase_id = $1`,
        [id],
      ),
    ]);

    return {
      items: itemsResult.rows.map((row) => ({
        id: row.id,
        showcaseId: row.showcase_id,
        content: row.content,
        createdAt: row.created_at,
        author: {
          id: row.user_id,
          displayName: row.author_display_name,
          avatarUrl: row.author_avatar_url,
        },
      })),
      total: parseInt(countResult.rows[0].count, 10),
      page,
      limit,
    };
  });

  // =========================================================================
  // POST /:id/comments — Create comment (authenticated)
  // =========================================================================

  app.post<{
    Params: { id: string };
    Body: { content: string };
  }>('/:id/comments', { schema: createCommentSchema, preHandler: [authenticate] }, async (request, reply) => {
    const userId = getUserId(request);
    const { id } = request.params;
    const { content } = request.body;

    // Check showcase exists
    const showcase = await query(`SELECT id FROM showcases WHERE id = $1`, [id]);
    if (showcase.rows.length === 0) {
      throw new NotFoundError('Showcase not found');
    }

    const result = await query<CommentRow>(
      `INSERT INTO showcase_comments (user_id, showcase_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [userId, id, content],
    );

    const comment = result.rows[0];
    return reply.status(201).send({
      id: comment.id,
      showcaseId: comment.showcase_id,
      content: comment.content,
      createdAt: comment.created_at,
      author: { id: userId },
    });
  });
};
