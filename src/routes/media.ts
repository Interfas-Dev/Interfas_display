import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MEDIA_FILE_RE, MEDIA_TYPES, MIME_BY_EXT, MediaError, VIDEO_MAX_BYTES, mediaExists, purgeOrphanMedia, saveMediaStream } from '../content/media.js';

const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;

/** Images et vidéos : lecture publique (l'écran n'est pas connecté), purge des fichiers orphelins. */
export async function mediaRoutes(app: FastifyInstance) {
  const dir = app.config.mediaDir;

  app.get<{ Params: { file: string } }>('/media/:file', async (req, reply) => {
    const { file } = req.params;
    if (!MEDIA_FILE_RE.test(file) || !mediaExists(app.db, file)) return reply.code(404).send('Fichier introuvable');
    const full = path.join(dir, file);
    const stat = await fs.promises.stat(full).catch(() => null);
    if (!stat) return reply.code(404).send('Fichier introuvable');
    const ext = file.split('.').pop()!;
    // Les noms sont uniques et jamais réécrits : mise en cache définitive.
    reply
      .type(MIME_BY_EXT[ext]!)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('accept-ranges', 'bytes');

    // Lecture partielle (Range) : nécessaire aux vidéos pour démarrer vite et boucler.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : stat.size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : stat.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, stat.size - 1);
      if (start > end || start >= stat.size) {
        return reply.code(416).header('content-range', `bytes */${stat.size}`).send();
      }
      return reply
        .code(206)
        .header('content-range', `bytes ${start}-${end}/${stat.size}`)
        .header('content-length', end - start + 1)
        .send(fs.createReadStream(full, { start, end }));
    }
    return reply.header('content-length', stat.size).send(fs.createReadStream(full));
  });

  const purge = () =>
    purgeOrphanMedia(app.db, dir).catch((err) => app.log.warn({ err }, 'purge des médias impossible'));
  const timer = setInterval(purge, PURGE_EVERY_MS);
  timer.unref();
  app.addHook('onReady', async () => void purge());
  app.addHook('onClose', async () => clearInterval(timer));
}

/** Téléversement depuis l'éditeur (corps brut en flux, type image/* ou video/*). Monté sous /admin. */
export async function mediaUploadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  // Le corps n'est pas lu ici : il est écrit directement sur le disque par le handler.
  app.addContentTypeParser([...MEDIA_TYPES], { bodyLimit: VIDEO_MAX_BYTES }, (_req, payload, done) => done(null, payload));

  app.post('/', { bodyLimit: VIDEO_MAX_BYTES }, async (req, reply) => {
    const declared = String(req.headers['content-type'] ?? '').split(';')[0]!.trim();
    // Les polices passent par Paramètres › Templates (administrateurs).
    if (declared.startsWith('font/')) return reply.code(415).send({ error: 'Les polices s\'ajoutent depuis un template.' });
    try {
      const { file, mime } = await saveMediaStream(app.db, app.config.mediaDir, req.body as NodeJS.ReadableStream as never, declared, req.user!.id);
      return reply.code(201).send({ file, url: `/media/${file}`, kind: mime.startsWith('video/') ? 'video' : 'image' });
    } catch (err) {
      if (err instanceof MediaError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });
}
