import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { query } from '../db/index.js';
import { authenticate } from '../middleware/auth.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { revokeAllUserTokens } from '../services/token.js';
import type { UserRow } from '../services/user.js';

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const updateProfileSchema = {
  body: {
    type: 'object' as const,
    properties: {
      displayName: {
        type: 'string' as const,
        minLength: 1,
        maxLength: 100,
      },
      avatarUrl: {
        type: 'string' as const,
        maxLength: 2048,
      },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Helper to format user response (strip internal fields)
// ---------------------------------------------------------------------------

function formatUserResponse(user: UserRow) {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    avatarUrl: user.avatar_url,
    status: user.status,
    role: user.role,
    createdAt: user.created_at,
  };
}

// ---------------------------------------------------------------------------
// User routes plugin
// ---------------------------------------------------------------------------

export const userRoutes: FastifyPluginAsync = async (app) => {
  // All routes in this plugin require authentication
  app.addHook('preHandler', authenticate);

  // =========================================================================
  // GET /user/me — Get current user's profile
  // =========================================================================

  app.get('/me', async (request) => {
    const userId = (request as FastifyRequest & { userId: string }).userId;

    const result = await query<UserRow>(
      `SELECT * FROM users WHERE id = $1`,
      [userId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    const user = result.rows[0];

    // Fetch linked identities (providers only, no sensitive data)
    const identities = await query<{ provider: string; created_at: Date }>(
      `SELECT provider, created_at FROM user_identities WHERE user_id = $1`,
      [userId],
    );

    return {
      ...formatUserResponse(user),
      identities: identities.rows.map((i) => ({
        provider: i.provider,
        linkedAt: i.created_at,
      })),
    };
  });

  // =========================================================================
  // PATCH /user/me — Update current user's profile
  // =========================================================================

  app.patch<{
    Body: { displayName?: string; avatarUrl?: string };
  }>('/me', { schema: updateProfileSchema }, async (request) => {
    const userId = (request as FastifyRequest & { userId: string }).userId;
    const { displayName, avatarUrl } = request.body;

    // At least one field must be provided
    if (displayName === undefined && avatarUrl === undefined) {
      throw new ValidationError('At least one field must be provided');
    }

    // Build dynamic SET clause
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (displayName !== undefined) {
      setClauses.push(`display_name = $${paramIndex++}`);
      values.push(displayName);
    }

    if (avatarUrl !== undefined) {
      setClauses.push(`avatar_url = $${paramIndex++}`);
      values.push(avatarUrl);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await query<UserRow>(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values,
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    return formatUserResponse(result.rows[0]);
  });

  // =========================================================================
  // DELETE /user/me — Deactivate (soft-delete) current user's account
  // =========================================================================

  app.delete('/me', async (request) => {
    const userId = (request as FastifyRequest & { userId: string }).userId;

    // Soft-delete: set status to 'deleted', clear PII
    const result = await query<UserRow>(
      `UPDATE users
       SET status = 'deleted',
           display_name = NULL,
           avatar_url = NULL,
           updated_at = NOW()
       WHERE id = $1 AND status != 'deleted'
       RETURNING *`,
      [userId],
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('User not found or already deleted');
    }

    // Revoke all tokens so user is logged out everywhere
    await revokeAllUserTokens(userId);

    return { success: true };
  });
};
