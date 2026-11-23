import type { FastifyInstance } from 'fastify';
import { listLiveMessages } from '../content/messages.js';
import { localNow } from '../content/schedule.js';

/** Écran de l'atelier : page plein écran publique (réseau local). */
export async function displayRoutes(app: FastifyInstance) {
  app.get('/display', async (_req, reply) =>
    reply.view(
      'display/index.ejs',
      { title: 'Affichage atelier', messages: listLiveMessages(app.db, localNow(new Date(), app.config.timezone)) },
      { layout: 'partials/display-layout.ejs' },
    ),
  );
}
