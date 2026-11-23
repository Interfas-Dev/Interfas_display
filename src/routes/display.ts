import type { FastifyInstance } from 'fastify';

/** Écran de l'atelier : page plein écran publique (réseau local). */
export async function displayRoutes(app: FastifyInstance) {
  app.get('/display', async (_req, reply) =>
    reply.view('display/index.ejs', { title: 'Affichage atelier' }, { layout: 'partials/display-layout.ejs' }),
  );
}
