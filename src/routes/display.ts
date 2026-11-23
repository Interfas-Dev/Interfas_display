import type { FastifyInstance } from 'fastify';
import { listActiveMessages } from '../content/messages.js';

/** Écran de l'atelier : page plein écran publique (réseau local). */
export async function displayRoutes(app: FastifyInstance) {
  app.get('/display', async (_req, reply) =>
    reply.view(
      'display/index.ejs',
      { title: 'Affichage atelier', messages: listActiveMessages(app.db) },
      { layout: 'partials/display-layout.ejs' },
    ),
  );
}
