import Fastify from 'fastify';
import { healthRoutes } from './routes/health.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    },
  });

  // Register route plugins
  await app.register(healthRoutes);

  // Future plugins:
  // await app.register(authRoutes, { prefix: '/auth' });
  // await app.register(userRoutes, { prefix: '/user' });
  // await app.register(marketplaceRoutes, { prefix: '/marketplace' });
  // await app.register(showcaseRoutes, { prefix: '/showcase' });
  // await app.register(adminRoutes, { prefix: '/admin' });

  return app;
}
