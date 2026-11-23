import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { form, loginAs, makeApp } from './helpers/app.js';
import { listMessages } from '../src/content/messages.js';
import { sanitizeContent } from '../src/content/sanitize.js';

let app: FastifyInstance;
let cookie: string;

beforeAll(async () => {
  app = await makeApp();
  cookie = await loginAs(app);
});
afterAll(async () => app.close());

async function post(url: string, data: Record<string, string>) {
  const f = form(data);
  return app.inject({ method: 'POST', url, headers: { ...f.headers, cookie }, payload: f.payload });
}

describe('messages', () => {
  it('exige une connexion', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/messages' });
    expect(res.statusCode).toBe(302);
    const create = await app.inject({ method: 'POST', url: '/admin/messages', ...form({ title: 'x', content: '<p>x</p>' }) });
    expect(create.statusCode).toBe(302);
    expect(listMessages(app.db)).toHaveLength(0);
  });

  it('redirige /admin vers la liste', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    expect(res.headers.location).toBe('/admin/messages');
  });

  it('crée un message et l’affiche dans la liste et à l’écran', async () => {
    const res = await post('/admin/messages', {
      title: 'Bienvenue',
      content: '<h1 style="text-align: center">Bienvenue</h1><p><span style="color: #ff0000; font-size: 2em">Sécurité</span></p>',
      is_active: 'on',
    });
    expect(res.statusCode).toBe(303);

    const list = await app.inject({ method: 'GET', url: '/admin/messages', headers: { cookie } });
    expect(list.body).toContain('Bienvenue');
    expect(list.body).toContain('En diffusion');
    expect(list.body).toContain('par Matthias');

    const display = await app.inject({ method: 'GET', url: '/display' });
    expect(display.body).toContain('color:#ff0000');
    expect(display.body).not.toContain('Aucun message');
  });

  it('refuse un titre ou un contenu vide', async () => {
    const res = await post('/admin/messages', { title: '', content: '<p>   </p>' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Le titre est obligatoire');
    expect(res.body).toContain('ne peut pas être vide');
  });

  it('modifie un message', async () => {
    const [m] = listMessages(app.db);
    const res = await post(`/admin/messages/${m!.id}`, { title: 'Bienvenue modifié', content: '<p>Nouveau</p>', is_active: 'on' });
    expect(res.statusCode).toBe(303);
    expect(listMessages(app.db)[0]!.title).toBe('Bienvenue modifié');
  });

  it('désactive un message : il disparaît de l’écran', async () => {
    const [m] = listMessages(app.db);
    await post(`/admin/messages/${m!.id}/toggle`, { active: '0' });
    const display = await app.inject({ method: 'GET', url: '/display' });
    expect(display.body).toContain('Aucun message');
  });

  it('réordonne les messages', async () => {
    await post('/admin/messages', { title: 'Deuxième', content: '<p>2</p>', is_active: 'on' });
    const before = listMessages(app.db).map((m) => m.title);
    expect(before).toEqual(['Bienvenue modifié', 'Deuxième']);
    await post(`/admin/messages/${listMessages(app.db)[1]!.id}/move`, { direction: 'up' });
    expect(listMessages(app.db).map((m) => m.title)).toEqual(['Deuxième', 'Bienvenue modifié']);
  });

  it('supprime un message', async () => {
    const [m] = listMessages(app.db);
    const res = await post(`/admin/messages/${m!.id}/delete`, {});
    expect(res.statusCode).toBe(303);
    expect(listMessages(app.db).map((x) => x.title)).toEqual(['Bienvenue modifié']);
  });

  it('renvoie 404 pour un message inexistant', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/messages/999/edit', headers: { cookie } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/admin/messages/abc/edit', headers: { cookie } })).statusCode).toBe(404);
    expect((await post('/admin/messages/999/delete', {})).statusCode).toBe(404);
  });
});

describe('nettoyage du HTML', () => {
  it('retire scripts, attributs dangereux et styles non autorisés', () => {
    const out = sanitizeContent(
      '<p onclick="x()" style="color: red; position: fixed; font-size: 999px">a</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:x">b</a>',
    );
    expect(out).not.toMatch(/script|onclick|onerror|img|javascript|position|999px|<a/);
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('garde la mise en forme de l’éditeur', () => {
    const html =
      '<h2 style="text-align: center">T</h2><p><strong>g</strong><em>i</em><u>s</u><s>b</s><span style="color: #00ff00; background-color: #f5c518; font-size: 1.5em">c</span></p><ul><li><p>x</p></li></ul>';
    // sanitize-html normalise les styles (sans espaces).
    expect(sanitizeContent(html)).toBe(html.replace(/: /g, ':').replace(/; /g, ';'));
  });
});
