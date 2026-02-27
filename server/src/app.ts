import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import dbPlugin from './plugins/db.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/user.js';
import { showcaseRoutes } from './routes/showcase.js';
import { analyticsRoutes } from './routes/analytics.js';
import { marketplaceRoutes } from './routes/marketplace.js';
import { adminRoutes } from './routes/admin.js';
import { loadKeys } from './lib/jwt.js';
import { AppError } from './lib/errors.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Global error handler for AppError instances
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    // Fastify validation errors (schema validation)
    if (error.validation) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
      });
    }

    // Unexpected errors
    request.log.error(error, 'Unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'production'
          ? 'Internal server error'
          : error.message,
    });
  });

  // Load JWT keys before registering routes that need them
  await loadKeys();

  // Infrastructure plugins
  await app.register(cors, {
    origin: [
      'https://admin.muxvo.com',
      'https://muxvo.com',
      'https://www.muxvo.com',
      ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:5174'] : []),
    ],
    credentials: true,
  });
  await app.register(dbPlugin);

  // Register route plugins
  await app.register(healthRoutes);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(userRoutes, { prefix: '/user' });

  await app.register(showcaseRoutes, { prefix: '/showcase' });
  await app.register(analyticsRoutes, { prefix: '/analytics' });

  await app.register(marketplaceRoutes, { prefix: '/marketplace' });

  await app.register(adminRoutes, { prefix: '/admin' });

  return app;
}
