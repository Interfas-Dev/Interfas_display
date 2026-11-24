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
    expect(JSON.parse(m.images_json)).toEqual([{ file, x: 12.35, y: 98, w: 100, layer: 'back', kind: 'image' }]);

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

const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(4000, 7)]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2000, 3)]);

describe('vidéos', () => {
  it('accepte MP4 et WebM, et vérifie le contenu réel', async () => {
    const mp4 = await upload(MP4, 'video/mp4');
    expect(mp4.statusCode).toBe(201);
    expect(mp4.json()).toMatchObject({ kind: 'video' });
    expect(mp4.json().file).toMatch(/\.mp4$/);
    expect((await upload(WEBM, 'video/webm')).json().file).toMatch(/\.webm$/);
    // Une image annoncée comme vidéo (ou l'inverse) est refusée
    expect((await upload(PNG, 'video/mp4')).statusCode).toBe(415);
    expect((await upload(MP4, 'image/png')).statusCode).toBe(415);
    expect((await upload(Buffer.from('pas une vidéo'), 'video/mp4')).statusCode).toBe(415);
  });

  it('limite les images à 5 Mo même si elles sont envoyées comme vidéo autorisée', async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const res = await upload(big, 'image/png');
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toContain('5 Mo');
    expect(fs.readdirSync(app.config.mediaDir).some((n) => n.startsWith('.envoi-'))).toBe(false);
  });

  it('sert les vidéos par morceaux (Range)', async () => {
    const file = (await upload(MP4, 'video/mp4')).json().file;
    const full = await app.inject({ method: 'GET', url: `/media/${file}` });
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(Number(full.headers['content-length'])).toBe(MP4.length);
    const part = await app.inject({ method: 'GET', url: `/media/${file}`, headers: { range: 'bytes=4-11' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 4-11/${MP4.length}`);
    expect(part.body).toBe('ftypisom');
    const tail = await app.inject({ method: 'GET', url: `/media/${file}`, headers: { range: 'bytes=-10' } });
    expect(tail.rawPayload.length).toBe(10);
    const bad = await app.inject({ method: 'GET', url: `/media/${file}`, headers: { range: `bytes=${MP4.length + 5}-` } });
    expect(bad.statusCode).toBe(416);
  });

  it('pose une vidéo avec le son et affiche une vidéo plein écran', async () => {
    const placed = (await upload(MP4, 'video/mp4')).json().file;
    const full = (await upload(WEBM, 'video/webm')).json().file;
    const res = await postMessage({
      title: 'Film sécurité', is_active: 'on', video_file: full, video_sound: 'on',
      images: JSON.stringify([{ file: placed, x: 5, y: 5, w: 40, sound: true }]),
    });
    expect(res.statusCode).toBe(303);
    const m = listMessages(app.db).find((x) => x.title === 'Film sécurité')!;
    expect(m).toMatchObject({ video_file: full, video_sound: 1 });
    expect(JSON.parse(m.images_json)[0]).toMatchObject({ kind: 'video', sound: true });

    const slides = await app.inject({ method: 'GET', url: '/display/slides' });
    expect(slides.body).toMatch(new RegExp(`data-id="${m.id}"[^>]*data-video`));
    expect(slides.body).toContain(`<video src="/media/${placed}#t=0.1" muted loop playsinline preload="metadata" data-sound>`);
    expect(slides.body).toContain(`<video src="/media/${full}#t=0.1" muted playsinline preload="metadata" data-sound>`);
  });

  it('refuse une vidéo plein écran inconnue et garde les vidéos utilisées lors de la purge', async () => {
    const res = await postMessage({ title: 'X', video_file: '00000000-0000-0000-0000-000000000000.mp4' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Vidéo introuvable');

    const m = listMessages(app.db).find((x) => x.title === 'Film sécurité')!;
    app.db.prepare(`UPDATE media SET created_at = datetime('now', '-2 days')`).run();
    await purgeOrphanMedia(app.db, app.config.mediaDir);
    expect(fs.existsSync(path.join(app.config.mediaDir, m.video_file!))).toBe(true);
  });

  it('un message composé seulement d’une vidéo plein écran est valide', async () => {
    const full = (await upload(MP4, 'video/mp4')).json().file;
    expect((await postMessage({ title: 'Vidéo seule', video_file: full })).statusCode).toBe(303);
  });
});

describe('GIF animés', () => {
  // GIF animé minimal de 2 images (1x1 px)
  const GIF = Buffer.from(
    'R0lGODlhAQABAPAAAP8AAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAAQABAAACAkQBACH5BAAKAAAALAAAAAABAAEAAAICTAEAOw==',
    'base64',
  );

  it('accepte un GIF, le sert tel quel et le pose sur la diapo', async () => {
    const res = await upload(GIF, 'image/gif');
    expect(res.statusCode).toBe(201);
    const file = res.json().file as string;
    expect(file).toMatch(/\.gif$/);
    const served = await app.inject({ method: 'GET', url: `/media/${file}` });
    expect(served.headers['content-type']).toBe('image/gif');
    expect(served.rawPayload.equals(GIF)).toBe(true); // pas de conversion : l'animation est conservée

    await postMessage({ title: 'Avec GIF', is_active: 'on', images: JSON.stringify([{ file, x: 10, y: 10, w: 20 }]) });
    const slides = await app.inject({ method: 'GET', url: '/display/slides' });
    expect(slides.body).toContain(`<img src="/media/${file}"`);
  });

  it('limite les GIF à 20 Mo et vérifie le contenu', async () => {
    expect((await upload(PNG, 'image/gif')).statusCode).toBe(201); // une image reste une image : PNG accepté sous son vrai format
    expect((await upload(Buffer.from('GIF00a....'), 'image/gif')).statusCode).toBe(415);
    const big = Buffer.concat([GIF, Buffer.alloc(21 * 1024 * 1024)]);
    const res = await upload(big, 'image/gif');
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toContain('20 Mo');
  });
});
