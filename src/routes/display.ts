import type { FastifyInstance } from 'fastify';
import { listLiveMessages } from '../content/messages.js';
import { localNow } from '../content/schedule.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WIDGET_NAME, buildWidget, ssspConfig, validHost } from '../content/tizen.js';

const ICON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/img/logo-interfas.png');

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

  /*
   * Télés Samsung (« URL Launcher ») : adresse à saisir http://<serveur>/display.
   * La télé lit sssp_config.xml puis installe le paquet .wgt, qui ouvre /display.
   */
  const widgets = new Map<string, Buffer>();
  const widgetFor = (req: { protocol: string; host: string }) => {
    const host = validHost(req.host) ? req.host : null;
    if (!host) return null;
    const target = `${req.protocol}://${host}/display`;
    let wgt = widgets.get(target);
    if (!wgt) {
      if (widgets.size > 20) widgets.clear();
      wgt = buildWidget(target, fs.readFileSync(ICON));
      widgets.set(target, wgt);
    }
    return wgt;
  };

  /** Image 1x1 lisible depuis l'application de la télé (autre origine) : test de présence du serveur. */
  const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  app.get('/display/ping.gif', async (_req, reply) =>
    reply.header('cache-control', 'no-store').header('cross-origin-resource-policy', 'cross-origin').type('image/gif').send(PIXEL),
  );

  app.get('/display/sssp_config.xml', async (req, reply) => {
    const wgt = widgetFor(req);
    if (!wgt) return reply.code(400).send('Adresse invalide');
    return reply.header('cache-control', 'no-store').type('application/xml; charset=utf-8').send(ssspConfig(wgt.length));
  });

  app.get(`/display/${WIDGET_NAME}.wgt`, async (req, reply) => {
    const wgt = widgetFor(req);
    if (!wgt) return reply.code(400).send('Adresse invalide');
    return reply.header('cache-control', 'no-store').type('application/widget').send(wgt);
  });

  /** Flux d'événements (Server-Sent Events) : « change » quand l'écran doit se mettre à jour. */
  app.get('/display/events', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
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
