import type { FastifyInstance } from 'fastify';
import { listLiveMessages } from '../content/messages.js';
import { localNow } from '../content/schedule.js';

const HEARTBEAT_MS = 25_000;

/** Écran de l'atelier : page plein écran publique (réseau local). */
export async function displayRoutes(app: FastifyInstance) {
  const liveMessages = () => listLiveMessages(app.db, localNow(new Date(), app.config.timezone));

  app.get('/display', async (_req, reply) =>
    reply.view(
      'display/index.ejs',
      { title: 'Affichage atelier', messages: liveMessages() },
      { layout: 'partials/display-layout.ejs' },
    ),
  );

  /** Contenu de l'écran seul, rechargé par la page quand il change. */
  app.get('/display/slides', async (_req, reply) =>
    reply.header('cache-control', 'no-store').view('display/slides.ejs', { messages: liveMessages() }),
  );

  /** Flux d'événements (Server-Sent Events) : « change » quand l'écran doit se mettre à jour. */
  app.get('/display/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 3000\n\n');

    const onChange = () => res.write('event: change\ndata: {}\n\n');
    const onClose = () => res.end();
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    app.displayBus.on('change', onChange);
    app.displayBus.once('close', onClose);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      app.displayBus.off('change', onChange);
      app.displayBus.off('close', onClose);
    });
  });
}
