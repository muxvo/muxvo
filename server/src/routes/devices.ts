import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { query } from '../db/index.js';
import { optionalAuthenticate } from '../middleware/auth.js';
import { ValidationError } from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Route schemas
// ---------------------------------------------------------------------------

const heartbeatSchema = {
  body: {
    type: 'object' as const,
    properties: {
      platform: { type: 'string' as const },
      arch: { type: 'string' as const },
      os_version: { type: 'string' as const },
      app_version: { type: 'string' as const },
      hostname: { type: 'string' as const },
    },
    additionalProperties: false,
  },
};

// ---------------------------------------------------------------------------
// Devices routes plugin
// ---------------------------------------------------------------------------

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  // =========================================================================
  // POST /devices/heartbeat — Device heartbeat (optional auth)
  // =========================================================================

  app.post<{
    Body: {
      platform?: string;
      arch?: string;
      os_version?: string;
      app_version?: string;
      hostname?: string;
    };
  }>('/heartbeat', { schema: heartbeatSchema, preHandler: [optionalAuthenticate] }, async (request) => {
    const deviceId = request.headers['x-device-id'] as string | undefined;

    if (!deviceId) {
      throw new ValidationError('X-Device-ID header is required');
    }

    const userId = (request as FastifyRequest & { userId?: string }).userId ?? null;
    const { platform = null, arch = null, os_version = null, app_version = null, hostname = null } = request.body ?? {};

    const result = await query<{ device_id: string; status: string }>(
      `INSERT INTO devices (device_id, user_id, platform, arch, os_version, app_version, hostname, last_ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (device_id) DO UPDATE SET
         user_id = COALESCE($2, devices.user_id),
         platform = $3, arch = $4, os_version = $5, app_version = $6,
         hostname = $7, last_ip = $8, last_seen_at = NOW()
       RETURNING device_id, status`,
      [deviceId, userId, platform, arch, os_version, app_version, hostname, request.ip],
    );

    return { device_id: result.rows[0].device_id, status: result.rows[0].status };
  });

  // =========================================================================
  // GET /devices/status — Check device status
  // =========================================================================

  app.get('/status', async (request) => {
    const deviceId = request.headers['x-device-id'] as string | undefined;

    if (!deviceId) {
      throw new ValidationError('X-Device-ID header is required');
    }

    const result = await query<{ status: string }>(
      `SELECT status FROM devices WHERE device_id = $1`,
      [deviceId],
    );

    if (result.rows.length === 0) {
      return { status: 'active' };
    }

    return { status: result.rows[0].status };
  });
};
