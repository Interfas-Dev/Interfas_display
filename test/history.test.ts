import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { form, loginAs, makeApp, messageDefaults, PASSWORD, sessionCookie } from './helpers/app.js';
import { listAudit, purgeAudit } from '../src/audit.js';
import { createUser } from '../src/auth/users.js';

let app: FastifyInstance;
let admin: string;
let tid = '';

beforeAll(async () => {
  app = await makeApp();
  admin = await loginAs(app);
  tid = String((app.db.prepare('SELECT id FROM templates WHERE is_default = 1').get() as { id: number }).id);
});
afterAll(async () => app.close());

function post(url: string, data: Record<string, string | string[]>, cookie = admin) {
  const f = form(data);
  return app.inject({ method: 'POST', url, headers: { ...f.headers, cookie }, payload: f.payload });
}
const last = () => listAudit(app.db).entries[0]!;

describe('historique', () => {
  it('trace la connexion réussie et l’échec avec l’identifiant tenté', async () => {
    const logins = listAudit(app.db, { entity: 'session' }).entries;
    expect(logins[0]).toMatchObject({ action: 'login', username: 'Matthias', label: 'matthias' });
    await app.inject({ method: 'POST', url: '/admin/login', ...form({ username: 'matthias', password: 'faux-mot-de-passe' }) });
    expect(last()).toMatchObject({ action: 'login_failed', label: 'matthias', user_id: expect.any(Number) });
    await app.inject({ method: 'POST', url: '/admin/login', ...form({ username: 'inconnu', password: 'x' }) });
    expect(last()).toMatchObject({ action: 'login_failed', label: 'inconnu', user_id: null });
  });

  it('trace la création, les champs modifiés, l’activation et la suppression d’un message', async () => {
    await post('/admin/messages', { ...messageDefaults(tid), heading: 'Réunion', content: '<p>A</p>', duration_seconds: '10' });
    const created = last();
    expect(created).toMatchObject({ action: 'create', entity: 'message', label: 'Réunion', username: 'Matthias' });
    const id = created.entity_id!;

    await post(`/admin/messages/${id}`, { ...messageDefaults(tid), heading: 'Réunion CSE', content: '<p>B</p>', duration_seconds: '20', days: ['0', '1'] });
    const upd = last();
    expect(upd.action).toBe('update');
    expect(JSON.parse(upd.details)).toEqual([
      'Titre affiché : Réunion → Réunion CSE',
      'Titre interne : Réunion → Réunion CSE',
      'Texte modifié',
      'Durée : 10 s → 20 s',
      'Jours : tous les jours → Lun, Mar',
    ]);

    // Enregistrer sans rien changer n'ajoute pas de ligne
    const before = listAudit(app.db).entries.length;
    await post(`/admin/messages/${id}`, { ...messageDefaults(tid), heading: 'Réunion CSE', content: '<p>B</p>', duration_seconds: '20', days: ['0', '1'] });
    expect(listAudit(app.db).entries.length).toBe(before);

    await post(`/admin/messages/${id}/toggle`, { active: '1' });
    expect(last()).toMatchObject({ action: 'enable', label: 'Réunion CSE' });
    await post(`/admin/messages/${id}/delete`, {});
    expect(last()).toMatchObject({ action: 'delete', entity: 'message', label: 'Réunion CSE' });
  });

  it('trace les templates et les comptes', async () => {
    await post(`/admin/templates/${tid}`, { name: 'Annonce claire', theme: 'dark', frame: 'none', show_logo: 'on', is_default: 'on' });
    expect(JSON.parse(last().details)).toEqual([
      'Nom : Annonce (clair) → Annonce claire',
      'Thème : Clair → Sombre',
      'Couleur de fond : #E7E3D8 → #221B13',
      'Couleur du texte : #221B13 → #FFFFFF',
      'Couleur du titre : #DE3619 → #FFFFFF',
      'Couleur de la fonction : #5C574F → #E7E3D8',
      'Épaisseur du filet : 0,45 em → 0 em',
    ]);

    await post('/admin/users', { username: 'marie', display_name: 'Marie', role: 'editor', password: 'provisoire-123' });
    expect(last()).toMatchObject({ action: 'create', entity: 'user', label: 'Marie (marie)' });
    expect(JSON.parse(last().details)).toEqual(['Rôle : Éditeur']);
  });

  it('page réservée aux admins, avec filtres', async () => {
    const page = await app.inject({ method: 'GET', url: '/admin/history', headers: { cookie: admin } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Échec de connexion');
    expect(page.body).toContain('Durée : 10 s → 20 s');

    const onlyUsers = await app.inject({ method: 'GET', url: '/admin/history?entity=user', headers: { cookie: admin } });
    expect(onlyUsers.body).toContain('Marie (marie)');
    expect(onlyUsers.body).not.toContain('Réunion CSE');

    await createUser(app.db, { username: 'paul', password: PASSWORD, role: 'editor' });
    const paul = sessionCookie(await app.inject({ method: 'POST', url: '/admin/login', ...form({ username: 'paul', password: PASSWORD }) }));
    expect((await app.inject({ method: 'GET', url: '/admin/history', headers: { cookie: paul } })).statusCode).toBe(403);
  });

  it('purge les entrées de plus d’un an', () => {
    app.db.prepare(`UPDATE audit_log SET at = datetime('now', '-400 days') WHERE id = (SELECT MIN(id) FROM audit_log)`).run();
    expect(purgeAudit(app.db)).toBe(1);
  });
});
