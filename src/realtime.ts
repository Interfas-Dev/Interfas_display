import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { listLiveMessages } from './content/messages.js';
import { localNow } from './content/schedule.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Prévient les écrans connectés que le contenu à afficher a changé. */
    displayBus: EventEmitter;
    notifyDisplays: (reason: string) => void;
  }
}

/** Intervalle de vérification des changements dus à la planification. */
export const SCHEDULE_CHECK_MS = 15_000;

/**
 * Temps réel de l'écran :
 * - toute modification réussie dans l'admin (messages, templates) prévient les écrans ;
 * - un contrôle régulier détecte les messages qui entrent ou sortent de leur planification.
 */
async function realtimePlugin(app: FastifyInstance) {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  app.decorate('displayBus', bus);
  app.decorate('notifyDisplays', (reason: string) => {
    app.log.debug({ reason }, 'mise à jour des écrans');
    bus.emit('change', reason);
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.method !== 'POST' || reply.statusCode !== 303) return;
    if (/^\/admin\/(messages|templates)(\/|$)/.test(req.url)) app.notifyDisplays(req.url);
  });

  // Empreinte de ce qui doit être à l'écran : ne change que si la liste diffusée change.
  const fingerprint = () =>
    listLiveMessages(app.db, localNow(new Date(), app.config.timezone))
      .map((m) => m.id)
      .join(',');
  let last = fingerprint();
  const timer = setInterval(() => {
    const now = fingerprint();
    if (now !== last) {
      last = now;
      app.notifyDisplays('planification');
    }
  }, SCHEDULE_CHECK_MS);
  timer.unref();
  bus.on('change', () => {
    last = fingerprint();
  });
  app.addHook('onClose', async () => {
    clearInterval(timer);
    bus.emit('close');
  });
}

export default fp(realtimePlugin, { name: 'realtime' });
