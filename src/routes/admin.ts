import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth.js';
import { accountRoutes } from './account.js';
import { messageRoutes } from './messages.js';
import { templateRoutes } from './templates.js';
import { mediaUploadRoutes } from './media.js';
import { userRoutes } from './users.js';
import { historyRoutes } from './history.js';

/** Espace d'administration : /admin/login est public, le reste est protégé. */
export async function adminRoutes(app: FastifyInstance) {
  await app.register(authRoutes);

  await app.register(async (protectedApp) => {
    protectedApp.addHook('preHandler', protectedApp.requireAuth);
    protectedApp.get('/', async (_req, reply) => reply.redirect('/admin/messages'));
  });

  await app.register(accountRoutes);
  await app.register(messageRoutes, { prefix: '/messages' });
  await app.register(templateRoutes, { prefix: '/templates' });
  await app.register(mediaUploadRoutes, { prefix: '/media' });
  await app.register(userRoutes, { prefix: '/users' });
  await app.register(historyRoutes, { prefix: '/history' });
}
