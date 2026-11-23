import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { MEDIA_FILE_RE, MEDIA_MAX_BYTES, MEDIA_TYPES, MIME_BY_EXT, mediaExists, purgeOrphanMedia, saveMedia } from '../content/media.js';

const PURGE_EVERY_MS = 6 * 60 * 60 * 1000;

/** Images : lecture publique (l'écran n'est pas connecté), purge des images orphelines. */
export async function mediaRoutes(app: FastifyInstance) {
  const dir = app.config.mediaDir;

  app.get<{ Params: { file: string } }>('/media/:file', async (req, reply) => {
    const { file } = req.params;
    if (!MEDIA_FILE_RE.test(file) || !mediaExists(app.db, file)) return reply.code(404).send('Image introuvable');
    const ext = file.split('.').pop()!;
    const stream = fs.createReadStream(path.join(dir, file));
    // Les noms sont uniques et jamais réécrits : mise en cache définitive.
    return reply
      .type(MIME_BY_EXT[ext]!)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .send(stream);
  });

  const purge = () =>
    purgeOrphanMedia(app.db, dir).catch((err) => app.log.warn({ err }, 'purge des images impossible'));
  const timer = setInterval(purge, PURGE_EVERY_MS);
  timer.unref();
  app.addHook('onReady', async () => void purge());
  app.addHook('onClose', async () => clearInterval(timer));
}

/** Téléversement depuis l'éditeur (corps brut, type image/*). Monté sous /admin. */
export async function mediaUploadRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  app.addContentTypeParser([...MEDIA_TYPES], { parseAs: 'buffer', bodyLimit: MEDIA_MAX_BYTES }, (_req, body, done) =>
    done(null, body),
  );

  app.post('/', { bodyLimit: MEDIA_MAX_BYTES }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) return reply.code(400).send({ error: 'Fichier vide.' });
    const file = await saveMedia(app.db, app.config.mediaDir, req.body, req.user!.id);
    if (!file) return reply.code(415).send({ error: 'Format non reconnu : PNG, JPG ou WebP uniquement.' });
    return reply.code(201).send({ file, url: `/media/${file}` });
  });
}
