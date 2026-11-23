import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import ejs from 'ejs';
import type { AppConfig } from './config.js';
import { openDatabase, type Db } from './db/index.js';
import { healthRoutes } from './routes/health.js';
import { displayRoutes } from './routes/display.js';
import { adminRoutes } from './routes/admin.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
  }
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.isProduction ? true : { level: 'info' },
  });

  const db = openDatabase(config.databasePath);
  app.decorate('db', db);
  app.decorate('config', config);
  app.addHook('onClose', async () => db.close());

  await app.register(helmet, {
    // Réseau local en HTTP : on désactive les en-têtes qui forcent le HTTPS.
    hsts: false,
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: null },
    },
  });
  await app.register(fastifyStatic, { root: path.join(rootDir, 'public'), prefix: '/public/' });
  await app.register(fastifyView, {
    engine: { ejs },
    root: path.join(rootDir, 'views'),
  });

  await app.register(healthRoutes);
  await app.register(displayRoutes);
  await app.register(adminRoutes, { prefix: '/admin' });

  app.get('/', async (_req, reply) => reply.redirect('/admin'));

  return app;
}
