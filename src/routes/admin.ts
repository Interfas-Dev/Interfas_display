import type { FastifyInstance } from 'fastify';

/** Espace d'administration. La connexion sera ajoutée à l'étape 2. */
export async function adminRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => reply.view('admin/index.ejs', { title: 'Administration' }, { layout: 'partials/layout.ejs' }));
}
