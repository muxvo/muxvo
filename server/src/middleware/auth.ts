import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken } from '../lib/jwt.js';
import { AuthError } from '../lib/errors.js';

/**
 * Fastify preHandler hook that verifies the Bearer access token.
 *
 * On success it decorates `request.userId` with the `sub` claim from the JWT.
 * On failure it throws an AuthError (401).
 *
 * Usage:
 *   app.get('/protected', { preHandler: [authenticate] }, handler);
 */
export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = await verifyAccessToken(token);

    if (!payload.sub) {
      throw new AuthError('Token missing subject claim');
    }

    // Decorate the request with the authenticated user's ID
    (request as FastifyRequest & { userId: string }).userId = payload.sub;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError('Invalid or expired access token');
  }
}

/**
 * Fastify preHandler hook that optionally verifies the Bearer access token.
 *
 * If a valid Bearer token is present, decorates `request.userId` with the `sub` claim.
 * If no token or an invalid token is provided, the request proceeds without error
 * (userId remains unset). This allows mixed authenticated/anonymous access.
 *
 * Usage:
 *   app.post('/mixed', { preHandler: [optionalAuthenticate] }, handler);
 */
export async function optionalAuthenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // No token — allow anonymous access
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = await verifyAccessToken(token);

    if (payload.sub) {
      (request as FastifyRequest & { userId: string }).userId = payload.sub;
    }
  } catch {
    // Invalid token — still allow the request through as anonymous
  }
}
