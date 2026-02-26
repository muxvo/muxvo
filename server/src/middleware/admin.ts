import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../lib/jwt.js';
import { AuthError } from '../lib/errors.js';
import { query } from '../db/index.js';

/**
 * Fastify preHandler hook that verifies the Bearer token AND checks
 * that the user has the 'admin' role.
 */
export async function authenticateAdmin(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  let userId: string;
  try {
    const payload = await verifyAccessToken(token);
    if (!payload.sub) throw new AuthError('Token missing subject claim');
    userId = payload.sub;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Invalid or expired access token');
  }

  // Check admin role
  const result = await query<{ role: string }>(
    `SELECT role FROM users WHERE id = $1 AND status = 'active'`,
    [userId],
  );

  if (result.rows.length === 0 || result.rows[0].role !== 'admin') {
    throw new AuthError('Admin access required', 'FORBIDDEN');
  }

  (request as FastifyRequest & { userId: string }).userId = userId;
}
