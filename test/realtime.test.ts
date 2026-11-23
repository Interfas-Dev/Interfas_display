import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { form, loginAs, makeApp, messageDefaults } from './helpers/app.js';

let app: FastifyInstance;
let cookie: string;
let tid: string;

beforeAll(async () => {
  app = await makeApp();
  cookie = await loginAs(app);
  tid = String((app.db.prepare('SELECT id FROM templates WHERE is_default = 1').get() as { id: number }).id);
});
afterAll(async () => app.close());

async function post(url: string, data: Record<string, string | string[]>) {
  const f = form(data);
  return app.inject({ method: 'POST', url, headers: { ...f.headers, cookie }, payload: f.payload });
}

function nextChange(): Promise<string> {
  return new Promise((resolve) => app.displayBus.once('change', resolve));
}

describe('temps réel', () => {
  it('prévient les écrans quand un message est créé', async () => {
    const changed = nextChange();
    await post('/admin/messages', { ...messageDefaults(tid), heading: 'Direct', content: '<p>x</p>', is_active: 'on' });
    expect(await changed).toBe('/admin/messages');
  });

  it('ne prévient pas sur une saisie refusée', async () => {
    let fired = false;
    const listener = () => (fired = true);
    app.displayBus.on('change', listener);
    const res = await post('/admin/messages', { ...messageDefaults(tid), heading: '', content: '' });
    app.displayBus.off('change', listener);
    expect(res.statusCode).toBe(400);
    expect(fired).toBe(false);
  });

  it('prévient quand un template change', async () => {
    const changed = nextChange();
    await post(`/admin/templates/${tid}`, { name: 'Annonce (clair)', theme: 'dark', frame: 'none' });
    expect(await changed).toMatch(/^\/admin\/templates\//);
  });

  it('sert le contenu seul de l’écran', async () => {
    const res = await app.inject({ method: 'GET', url: '/display/slides' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('Direct');
    expect(res.body).not.toContain('<html');
  });

  it('envoie un événement « change » sur le flux SSE', async () => {
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const ctrl = new AbortController();
    const res = await fetch(`${address}/display/events`, { signal: ctrl.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain('retry: 3000');

    app.notifyDisplays('test');
    while (!text.includes('event: change')) text += decoder.decode((await reader.read()).value);
    expect(text).toContain('event: change');
    ctrl.abort();
  });

  it('montre l’écran en direct dans l’admin', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/messages', headers: { cookie } });
    expect(res.body).toContain('<iframe src="/display"');
  });
});
