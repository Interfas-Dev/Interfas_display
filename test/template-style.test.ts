import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { form, loginAs, makeApp, messageDefaults } from './helpers/app.js';
import { createUser } from '../src/auth/users.js';
import { purgeOrphanMedia } from '../src/content/media.js';
import { effectiveStyle, normalizeStyle, presetStyle, slideLook, styleVars } from '../src/content/style.js';
import { PASSWORD, sessionCookie } from './helpers/app.js';

const PNG = fs.readFileSync(path.resolve('public/img/logo-interfas.png'));
const WOFF2 = fs.readFileSync(path.resolve('public/fonts/inter/inter-latin-400-normal.woff2'));

let app: FastifyInstance;
let cookie: string;
let tid = '';

beforeAll(async () => {
  app = await makeApp();
  cookie = await loginAs(app);
  tid = String((app.db.prepare('SELECT id FROM templates WHERE is_default = 1').get() as { id: number }).id);
  const f = form({ ...messageDefaults(tid), title: 'Essai', heading: 'Bienvenue', content_html: '<p>Bonjour</p>', is_active: 'on' });
  await app.inject({ method: 'POST', url: '/admin/messages', headers: { ...f.headers, cookie }, payload: f.payload });
});
afterAll(async () => app.close());

const post = (url: string, data: Record<string, string>, c = cookie) => {
  const f = form(data);
  return app.inject({ method: 'POST', url, headers: { ...f.headers, cookie: c }, payload: f.payload });
};
const slides = async () => (await app.inject({ method: 'GET', url: '/display/slides' })).body;
const uploadFont = (body: Buffer, name = 'Police maison', c = cookie) =>
  app.inject({
    method: 'POST',
    url: `/admin/templates/fonts?name=${encodeURIComponent(name)}`,
    headers: { 'content-type': 'application/octet-stream', cookie: c },
    payload: body,
  });

/** Formulaire complet d'un template (comme envoyé par la page). */
function templateForm(extra: Record<string, string> = {}) {
  return {
    name: 'Annonce (clair)', theme: 'light', show_logo: 'on', is_default: 'on', s_present: '1',
    s_bg: '#ffffff', s_text: '#111111', s_heading: '#8e1f2f', s_marker: '#8e1f2f', s_muted: '#555555',
    s_bgImage: '', s_frameColor: '#7f776c', s_frameWidth: '0.2',
    s_fontHeading: 'playfair-display', s_fontBody: 'inter',
    s_headingSize: '2.5', s_headingWeight: '400', s_headingAlign: 'center',
    s_bodySize: '1.2', s_bodyAlign: 'center', s_sigSize: '0.9', s_sigAlign: 'left',
    s_logo: 'interfas', s_logoSize: '5', s_logoPos: 'right', s_padX: '3', s_padY: '2',
    ...extra,
  };
}

describe('validation du style', () => {
  it('reprend le thème pour les valeurs absentes ou invalides', () => {
    const base = presetStyle('dark', 'none');
    const s = normalizeStyle({ bg: 'red;}</style>', text: '#abcdef', headingSize: '99', fontBody: 'comic', logo: '../etc/passwd' }, base);
    expect(s.bg).toBe(base.bg);
    expect(s.text).toBe('#ABCDEF');
    expect(s.headingSize).toBe(4);
    expect(s.fontBody).toBe('sora');
    expect(s.logo).toBe('interfas');
  });

  it('un template sans réglages garde le rendu du thème', () => {
    expect(slideLook('{}', 'light', 'greige').css).toBe('');
    expect(effectiveStyle('{}', 'red', 'none').bg).toBe('#DE3619');
  });

  it('produit un dégradé ou une image de fond', () => {
    const s = { ...presetStyle('light', 'none'), bg2: '#000000' };
    expect(styleVars(s)).toContain('--tpl-bg-image:linear-gradient(135deg, #E7E3D8, #000000)');
    expect(styleVars({ ...s, bgImage: '00000000-0000-0000-0000-000000000000.png' })).toContain('url(/media/00000000-0000-0000-0000-000000000000.png)');
  });
});

describe('templates personnalisés', () => {
  it('les messages existants gardent le rendu du thème', async () => {
    const html = await slides();
    expect(html).toContain('Bienvenue');
    expect(html).not.toContain('--slide-bg');
  });

  it('enregistre les réglages et les applique à l’écran', async () => {
    const res = await post(`/admin/templates/${tid}`, templateForm());
    expect(res.statusCode).toBe(303);
    const html = await slides();
    expect(html).toContain('--slide-bg:#FFFFFF');
    expect(html).toContain('--tpl-font-heading:&#39;Playfair Display&#39;');
    expect(html).toContain('--tpl-heading-transform:none'); // case décochée
    expect(html).toContain('--tpl-heading-weight:400');
    expect(html).toContain('--frame-w:0.2em');
    expect(html).toContain('logo-right');

    const last = app.db.prepare('SELECT details FROM audit_log ORDER BY id DESC LIMIT 1').get() as { details: string };
    expect(JSON.parse(last.details)).toContain('Police du titre : Sora (charte) → Playfair Display (élégante)');
  });

  it('accepte un logo et une image de fond envoyés, gardés par la purge', async () => {
    const up = await app.inject({ method: 'POST', url: '/admin/media', headers: { 'content-type': 'image/png', cookie }, payload: PNG });
    const file = up.json().file as string;
    expect((await post(`/admin/templates/${tid}`, templateForm({ s_logo: file, s_bgImage: file }))).statusCode).toBe(303);
    const html = await slides();
    expect(html).toContain(`src="/media/${file}"`);
    expect(html).toContain(`url(/media/${file})`);
    expect(html).toContain('logo-custom');

    app.db.prepare(`UPDATE media SET created_at = datetime('now', '-2 days')`).run();
    await purgeOrphanMedia(app.db, app.config.mediaDir);
    expect(app.db.prepare('SELECT 1 FROM media WHERE file = ?').get(file)).toBeTruthy();
  });

  it('refuse un fichier inconnu comme logo', async () => {
    await post(`/admin/templates/${tid}`, templateForm({ s_logo: '11111111-1111-1111-1111-111111111111.png' }));
    expect(await slides()).toContain('src="/public/img/logo-interfas.png"');
  });

  it('duplique un template', async () => {
    const res = await post(`/admin/templates/${tid}/duplicate`, {});
    expect(res.statusCode).toBe(303);
    const copy = app.db.prepare("SELECT * FROM templates WHERE name = 'Annonce (clair) (copie)'").get() as { style_json: string; is_default: number };
    expect(copy.is_default).toBe(0);
    expect(JSON.parse(copy.style_json).fontHeading).toBe('playfair-display');
  });
});

describe('polices envoyées', () => {
  let key = '';

  it('accepte une police WOFF2 et la propose aux templates', async () => {
    const res = await uploadFont(WOFF2);
    expect(res.statusCode).toBe(201);
    key = res.json().key;
    expect(key).toMatch(/^custom-\d+$/);
    expect((await post(`/admin/templates/${tid}`, templateForm({ s_fontBody: key }))).statusCode).toBe(303);
    const html = await slides();
    expect(html).toContain(`@font-face{font-family:'tpl-font-${key.slice(7)}'`);
    expect(html).toContain(`--tpl-font-body:&#39;tpl-font-${key.slice(7)}&#39;`);
  });

  it('refuse un faux fichier, un nom invalide, et les éditeurs', async () => {
    expect((await uploadFont(PNG)).statusCode).toBe(415);
    expect((await uploadFont(WOFF2, '<script>')).statusCode).toBe(400);
    await createUser(app.db, { username: 'eve', password: PASSWORD, role: 'editor' });
    const f = form({ username: 'eve', password: PASSWORD });
    const eve = sessionCookie(await app.inject({ method: 'POST', url: '/admin/login', ...f }));
    expect((await uploadFont(WOFF2, 'Test', eve)).statusCode).toBe(403);
    // Les polices ne passent pas par l'envoi de médias des messages.
    const m = await app.inject({ method: 'POST', url: '/admin/media', headers: { 'content-type': 'font/woff2', cookie }, payload: WOFF2 });
    expect(m.statusCode).toBe(415);
  });

  it('refuse de supprimer une police utilisée', async () => {
    const id = key.slice(7);
    expect((await post(`/admin/templates/fonts/${id}/delete`, {})).statusCode).toBe(400);
    await post(`/admin/templates/${tid}`, templateForm());
    // La copie du template utilise encore Playfair, pas la police envoyée.
    expect((await post(`/admin/templates/fonts/${id}/delete`, {})).statusCode).toBe(303);
  });

  it('affiche le formulaire avec les réglages', async () => {
    const page = await app.inject({ method: 'GET', url: `/admin/templates/${tid}/edit`, headers: { cookie } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('name="s_fontHeading"');
    expect(page.body).toContain('Playfair Display (élégante)');
  });
});
