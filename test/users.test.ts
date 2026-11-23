import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { form, loginAs, makeApp, PASSWORD, sessionCookie } from './helpers/app.js';
import { createUser, findUserByUsername, getUserById } from '../src/auth/users.js';

let app: FastifyInstance;
let admin: string;

beforeAll(async () => {
  app = await makeApp();
  admin = await loginAs(app); // matthias, administrateur
});
afterAll(async () => app.close());

function post(url: string, data: Record<string, string>, cookie = admin) {
  const f = form(data);
  return app.inject({ method: 'POST', url, headers: { ...f.headers, cookie }, payload: f.payload });
}
const get = (url: string, cookie = admin) => app.inject({ method: 'GET', url, headers: { cookie } });

async function login(username: string, password: string) {
  const f = form({ username, password });
  return app.inject({ method: 'POST', url: '/admin/login', ...f });
}
const me = () => findUserByUsername(app.db, 'matthias')!;

describe('gestion des utilisateurs', () => {
  it('liste les comptes avec leur rôle', async () => {
    const res = await get('/admin/users');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Administrateur');
    expect(res.body).toContain('matthias');
  });

  it('crée un éditeur avec un mot de passe provisoire à changer', async () => {
    const res = await post('/admin/users', { username: 'marie', display_name: 'Marie Dupont', role: 'editor', password: 'provisoire-123' });
    expect(res.statusCode).toBe(303);
    const marie = findUserByUsername(app.db, 'marie')!;
    expect(marie.role).toBe('editor');
    expect(marie.must_change_password).toBe(1);

    // À la connexion, seul « Mon compte » est accessible
    const cookie = sessionCookie(await login('marie', 'provisoire-123'));
    const blocked = await get('/admin/messages', cookie);
    expect(blocked.statusCode).toBe(302);
    expect(blocked.headers.location).toBe('/admin/account');
    expect((await get('/admin/account', cookie)).body).toContain('mot de passe est provisoire');

    // Elle choisit son mot de passe, puis accède aux messages
    const changed = await post('/admin/account/password', { current: 'provisoire-123', password: 'mon-propre-mdp', confirm: 'mon-propre-mdp' }, cookie);
    expect(changed.statusCode).toBe(200);
    expect(findUserByUsername(app.db, 'marie')!.must_change_password).toBe(0);
    expect((await get('/admin/messages', cookie)).statusCode).toBe(200);
  });

  it('refuse un identifiant déjà pris ou un mot de passe trop court', async () => {
    const dup = await post('/admin/users', { username: 'MARIE', role: 'editor', password: 'provisoire-123' });
    expect(dup.statusCode).toBe(400);
    expect(dup.body).toContain('déjà pris');
    const short = await post('/admin/users', { username: 'paul', role: 'editor', password: 'court' });
    expect(short.statusCode).toBe(400);
    expect(short.body).toContain('10 caractères');
  });

  it('un éditeur gère les messages mais pas les templates ni les comptes', async () => {
    const cookie = sessionCookie(await login('marie', 'mon-propre-mdp'));
    expect((await get('/admin/messages', cookie)).body).not.toContain('href="/admin/templates"');
    expect((await get('/admin/templates', cookie)).statusCode).toBe(403);
    expect((await get('/admin/users', cookie)).statusCode).toBe(403);
    const attempt = await post('/admin/users', { username: 'pirate', role: 'admin', password: 'provisoire-123' }, cookie);
    expect(attempt.statusCode).toBe(403);
    expect(findUserByUsername(app.db, 'pirate')).toBeUndefined();
  });

  it('change le rôle et le nom d’un compte', async () => {
    const marie = findUserByUsername(app.db, 'marie')!;
    const res = await post(`/admin/users/${marie.id}`, { display_name: 'Marie D.', role: 'admin', is_active: 'on' });
    expect(res.statusCode).toBe(303);
    expect(getUserById(app.db, marie.id)).toMatchObject({ display_name: 'Marie D.', role: 'admin' });
    await post(`/admin/users/${marie.id}`, { display_name: 'Marie D.', role: 'editor', is_active: 'on' });
  });

  it('désactiver un compte ferme ses sessions et bloque la connexion', async () => {
    const marie = findUserByUsername(app.db, 'marie')!;
    const cookie = sessionCookie(await login('marie', 'mon-propre-mdp'));
    await post(`/admin/users/${marie.id}`, { display_name: 'Marie D.', role: 'editor' });
    expect(getUserById(app.db, marie.id)!.is_active).toBe(0);
    expect((await get('/admin/messages', cookie)).statusCode).toBe(302);
    const again = await login('marie', 'mon-propre-mdp');
    expect(again.statusCode).toBe(401);
    expect(again.body).toContain('Identifiant ou mot de passe incorrect');
    await post(`/admin/users/${marie.id}`, { display_name: 'Marie D.', role: 'editor', is_active: 'on' });
  });

  it('réinitialise le mot de passe d’un autre compte', async () => {
    const marie = findUserByUsername(app.db, 'marie')!;
    const cookie = sessionCookie(await login('marie', 'mon-propre-mdp'));
    const res = await post(`/admin/users/${marie.id}/password`, { password: 'nouveau-provisoire' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Mot de passe provisoire enregistré');
    expect((await get('/admin/messages', cookie)).statusCode).toBe(302); // sessions fermées
    expect((await login('marie', 'mon-propre-mdp')).statusCode).toBe(401);
    expect(findUserByUsername(app.db, 'marie')!.must_change_password).toBe(1);
  });

  it('protège son propre compte', async () => {
    const id = me().id;
    const demote = await post(`/admin/users/${id}`, { display_name: 'Matthias', role: 'editor', is_active: 'on' });
    expect(demote.statusCode).toBe(400);
    expect(demote.body).toContain('propre rôle');
    const disable = await post(`/admin/users/${id}`, { display_name: 'Matthias', role: 'admin' });
    expect(disable.statusCode).toBe(400);
    const del = await post(`/admin/users/${id}/delete`, {});
    expect(del.statusCode).toBe(400);
    const reset = await post(`/admin/users/${id}/password`, { password: 'autre-mot-de-passe' });
    expect(reset.statusCode).toBe(400);
    expect(me()).toMatchObject({ role: 'admin', is_active: 1 });
  });

  it('garde toujours au moins un administrateur actif', async () => {
    await createUser(app.db, { username: 'chef', password: PASSWORD, role: 'admin' });
    const chef = sessionCookie(await login('chef', PASSWORD));
    // chef rétrograde matthias : autorisé, il reste chef
    const ok = await post(`/admin/users/${me().id}`, { display_name: 'Matthias', role: 'editor', is_active: 'on' }, chef);
    expect(ok.statusCode).toBe(303);
    expect(me().role).toBe('editor');
    // chef est désormais le seul admin actif : il ne peut ni se rétrograder ni se supprimer
    const chefId = findUserByUsername(app.db, 'chef')!.id;
    expect((await post(`/admin/users/${chefId}`, { display_name: 'chef', role: 'editor', is_active: 'on' }, chef)).statusCode).toBe(400);
    expect((await post(`/admin/users/${chefId}/delete`, {}, chef)).statusCode).toBe(400);
    await post(`/admin/users/${me().id}`, { display_name: 'Matthias', role: 'admin', is_active: 'on' }, chef);
    expect(me().role).toBe('admin');
  });

  it('supprime un compte en conservant ses messages', async () => {
    const marie = findUserByUsername(app.db, 'marie')!;
    app.db.prepare("INSERT INTO messages (title, content_html, created_by, updated_by) VALUES ('De Marie', '<p>x</p>', ?, ?)").run(marie.id, marie.id);
    const res = await post(`/admin/users/${marie.id}/delete`, {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('a été supprimé');
    expect(getUserById(app.db, marie.id)).toBeUndefined();
    expect(app.db.prepare("SELECT created_by FROM messages WHERE title = 'De Marie'").get()).toEqual({ created_by: null });
  });
});
