import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { accountRoutes } from './account.js';

/** Espace d'administration : /admin/login est public, le reste est protégé. */
export async function adminRoutes(app: FastifyInstance) {
  await app.register(authRoutes);

  await app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', protectedApp.requireAuth);
    protectedApp.get('/', async (req, reply) =>
      reply.view('admin/index.ejs', { title: 'Administration', user: req.user }, { layout: 'partials/layout.ejs' }),
    );
  });

  await app.register(accountRoutes);
}
