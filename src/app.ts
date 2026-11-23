import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import ejs from 'ejs';
import type { AppConfig } from './config.js';
import { openDatabase, type Db } from './db/index.js';
import { healthRoutes } from './routes/health.js';
import { displayRoutes } from './routes/display.js';
import { adminRoutes } from './routes/admin.js';
import authPlugin from './auth/plugin.js';
import realtimePlugin from './realtime.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: AppConfig;
  }
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: config.trustProxy,
  });

  const db = openDatabase(config.databasePath);
  app.decorate('db', db);
  app.decorate('config', config);
  app.addHook('onClose', async () => db.close());

  await app.register(helmet, {
    // Réseau local en HTTP : on désactive les en-têtes qui forcent le HTTPS.
    hsts: false,
    // « no-referrer » (défaut) fait envoyer Origin: null sur les formulaires.
    referrerPolicy: { policy: 'same-origin' },
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: null },
    },
  });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(formbody);
  await app.register(authPlugin);
  await app.register(realtimePlugin);
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
