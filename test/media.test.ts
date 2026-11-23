import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { form, loginAs, makeApp, messageDefaults } from './helpers/app.js';
import { getMessage, listMessages } from '../src/content/messages.js';
import { MEDIA_MAX_BYTES, purgeOrphanMedia } from '../src/content/media.js';

const PNG = fs.readFileSync(path.resolve('public/img/logo-interfas.png'));

let app: FastifyInstance;
let cookie: string;
let tid = '';

beforeAll(async () => {
  app = await makeApp();
  cookie = await loginAs(app);
  tid = String((app.db.prepare('SELECT id FROM templates WHERE is_default = 1').get() as { id: number }).id);
});
afterAll(async () => app.close());

function upload(body: Buffer, type = 'image/png', headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url: '/admin/media', headers: { 'content-type': type, cookie, ...headers }, payload: body });
}

async function uploaded(): Promise<string> {
  const res = await upload(PNG);
  expect(res.statusCode).toBe(201);
  return res.json().file as string;
}

function postMessage(data: Record<string, string | string[]>, url = '/admin/messages') {
  const f = form({ ...messageDefaults(tid), ...data });
  return app.inject({ method: 'POST', url, headers: { ...f.headers, cookie }, payload: f.payload });
}

describe('téléversement d’images', () => {
  it('exige une connexion', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/media', headers: { 'content-type': 'image/png' }, payload: PNG });
    expect(res.statusCode).toBe(302);
  });

  it('refuse un envoi depuis un autre site', async () => {
    const res = await upload(PNG, 'image/png', { 'sec-fetch-site': 'cross-site' });
    expect(res.statusCode).toBe(403);
  });

  it('enregistre un PNG et le sert publiquement avec un cache long', async () => {
    const file = await uploaded();
    expect(file).toMatch(/^[0-9a-f-]{36}\.png$/);
    expect(fs.existsSync(path.join(app.config.mediaDir, file))).toBe(true);

    const res = await app.inject({ method: 'GET', url: `/media/${file}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.rawPayload.equals(PNG)).toBe(true);
  });

  it('se fie au contenu réel, pas au type annoncé', async () => {
    const res = await upload(Buffer.from('<svg onload="alert(1)"></svg>'), 'image/png');
    expect(res.statusCode).toBe(415);
  });

  it('refuse les types non acceptés (SVG) et les fichiers trop lourds', async () => {
    expect((await upload(Buffer.from('<svg/>'), 'image/svg+xml')).statusCode).toBe(415);
    const big = Buffer.concat([PNG, Buffer.alloc(MEDIA_MAX_BYTES)]);
    expect((await upload(big)).statusCode).toBe(413);
  });

  it('répond 404 pour un nom invalide ou inconnu', async () => {
    expect((await app.inject({ method: 'GET', url: '/media/..%2F..%2Fetc%2Fpasswd' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/media/00000000-0000-0000-0000-000000000000.png' })).statusCode).toBe(404);
  });
});

describe('images dans un message', () => {
  it('enregistre la position, borne les valeurs et ignore les images inconnues', async () => {
    const file = await uploaded();
    const images = JSON.stringify([
      { file, x: 12.345, y: 140, w: 250, layer: 'back' },
      { file: '00000000-0000-0000-0000-000000000000.png', x: 0, y: 0, w: 10 },
      { file: '../secret.png', x: 0, y: 0, w: 10 },
    ]);
    const res = await postMessage({ heading: 'Avec image', images, is_active: 'on' });
    expect(res.statusCode).toBe(303);
    const m = listMessages(app.db).find((x) => x.heading === 'Avec image')!;
    expect(JSON.parse(m.images_json)).toEqual([{ file, x: 12.35, y: 98, w: 100, layer: 'back' }]);

    const slides = await app.inject({ method: 'GET', url: '/display/slides' });
    expect(slides.body).toContain(`src="/media/${file}"`);
    expect(slides.body).toContain('class="slide-image layer-back" style="left:12.35%;top:98%;width:100%"');
  });

  it('accepte un message composé uniquement d’une image', async () => {
    const file = await uploaded();
    const res = await postMessage({ images: JSON.stringify([{ file, x: 10, y: 10, w: 50 }]), title: 'Image seule' });
    expect(res.statusCode).toBe(303);
  });

  it('signale des données d’images illisibles', async () => {
    const res = await postMessage({ heading: 'Cassé', images: '{pas du json' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Les images n’ont pas pu être lues');
  });

  it('conserve les images à la modification et les affiche dans le formulaire', async () => {
    const m = listMessages(app.db).find((x) => x.heading === 'Avec image')!;
    const edit = await app.inject({ method: 'GET', url: `/admin/messages/${m.id}/edit`, headers: { cookie } });
    expect(edit.body).toContain('id="images"');
    expect(edit.body).toContain('slide-image layer-back');
    const res = await postMessage({ heading: 'Avec image', images: '[]' }, `/admin/messages/${m.id}`);
    expect(res.statusCode).toBe(303);
    expect(getMessage(app.db, m.id)!.images_json).toBe('[]');
  });

  it('purge les images orphelines anciennes et garde celles utilisées', async () => {
    const used = await uploaded();
    await postMessage({ heading: 'Gardée', images: JSON.stringify([{ file: used, x: 0, y: 0, w: 20 }]) });
    const orphan = await uploaded();
    app.db.prepare(`UPDATE media SET created_at = datetime('now', '-2 days')`).run();

    const removed = await purgeOrphanMedia(app.db, app.config.mediaDir);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(path.join(app.config.mediaDir, orphan))).toBe(false);
    expect(fs.existsSync(path.join(app.config.mediaDir, used))).toBe(true);
    expect((await app.inject({ method: 'GET', url: `/media/${used}` })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: `/media/${orphan}` })).statusCode).toBe(404);
  });
});
