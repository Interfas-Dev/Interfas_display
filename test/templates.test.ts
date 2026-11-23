import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { form, loginAs, makeApp } from './helpers/app.js';
import { listTemplates } from '../src/content/templates.js';
import { getMessage } from '../src/content/messages.js';

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
const byName = (n: string) => listTemplates(app.db).find((t) => t.name === n)!;

describe('templates', () => {
  it('crée 3 templates de base, dont un par défaut', () => {
    const ts = listTemplates(app.db);
    expect(ts.map((t) => t.theme).sort()).toEqual(['dark', 'light', 'red']);
    expect(ts.filter((t) => t.is_default)).toHaveLength(1);
  });

  it('exige une connexion', async () => {
    expect((await app.inject({ method: 'GET', url: '/admin/templates' })).statusCode).toBe(302);
  });

  it('liste les templates avec un aperçu', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/templates', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Annonce (clair)');
    expect(res.body).toContain('slide-frame theme-red');
  });

  it('crée un template et le met par défaut', async () => {
    const res = await post('/admin/templates', {
      name: 'RH', theme: 'dark', frame: 'red', show_logo: 'on', is_default: 'on',
      default_signature_name: 'Prénom NOM', default_signature_role: 'Responsable RH',
    });
    expect(res.statusCode).toBe(303);
    const t = byName('RH');
    expect(t).toMatchObject({ theme: 'dark', frame: 'red', show_logo: 1, is_default: 1 });
    expect(listTemplates(app.db).filter((x) => x.is_default)).toHaveLength(1);
  });

  it('refuse un nom en double ou vide', async () => {
    expect((await post('/admin/templates', { name: 'rh', theme: 'light', frame: 'none' })).statusCode).toBe(400);
    expect((await post('/admin/templates', { name: ' ', theme: 'light', frame: 'none' })).statusCode).toBe(400);
  });

  it('ignore un thème inconnu', async () => {
    await post('/admin/templates', { name: 'Bizarre', theme: 'rose', frame: 'pois' });
    expect(byName('Bizarre')).toMatchObject({ theme: 'light', frame: 'none' });
  });

  it('applique la signature par défaut et suit les modifications du template', async () => {
    const t = byName('RH');
    await post('/admin/messages', { template_id: String(t.id), heading: 'Info', content: '<p>x</p>', is_active: 'on' });
    const id = (app.db.prepare("SELECT id FROM messages WHERE heading = 'Info'").get() as { id: number }).id;
    expect(getMessage(app.db, id)).toMatchObject({ sig_name: 'Prénom NOM', sig_role: 'Responsable RH', theme: 'dark' });

    await post(`/admin/templates/${t.id}`, { name: 'RH', theme: 'red', frame: 'none', default_signature_name: 'Autre', default_signature_role: 'DRH' });
    expect(getMessage(app.db, id)).toMatchObject({ sig_name: 'Autre', sig_role: 'DRH', theme: 'red' });
    // Le template par défaut est conservé même si la case est décochée (il en faut un).
    expect(byName('RH').is_default).toBe(1);

    // Une signature propre au message l'emporte.
    await post(`/admin/messages/${id}`, { template_id: String(t.id), heading: 'Info', content: '<p>x</p>', signature_name: 'Moi', is_active: 'on' });
    expect(getMessage(app.db, id)).toMatchObject({ sig_name: 'Moi', sig_role: '' });
  });

  it('refuse de supprimer un template utilisé', async () => {
    const res = await post(`/admin/templates/${byName('RH').id}/delete`, {});
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('utilisé par 1 message');
  });

  it('supprime un template inutilisé', async () => {
    const res = await post(`/admin/templates/${byName('Bizarre').id}/delete`, {});
    expect(res.statusCode).toBe(303);
    expect(listTemplates(app.db).some((t) => t.name === 'Bizarre')).toBe(false);
  });
});
