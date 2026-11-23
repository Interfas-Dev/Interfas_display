import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createUser } from '../src/auth/users.js';

let app: FastifyInstance;
const PASSWORD = 'motdepasse-solide';

beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), databasePath: ':memory:', logLevel: 'silent' });
  await createUser(app.db, { username: 'matthias', displayName: 'Matthias', password: PASSWORD });
});
afterAll(async () => app.close());

function form(data: Record<string, string>) {
  return { 'content-type': 'application/x-www-form-urlencoded', payload: new URLSearchParams(data).toString() };
}

async function login(username = 'matthias', password = PASSWORD, next = '/admin') {
  const { payload, ...headers } = form({ username, password, next });
  return app.inject({ method: 'POST', url: '/admin/login', headers, payload });
}

function sessionCookie(res: Awaited<ReturnType<typeof login>>) {
  const c = res.cookies.find((c) => c.name === 'interfas_session');
  return c ? `interfas_session=${c.value}` : '';
}

describe('connexion', () => {
  it('affiche le formulaire', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/login' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Se connecter');
  });

  it('refuse un mauvais mot de passe', async () => {
    const res = await login('matthias', 'mauvais');
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('incorrect');
    expect(sessionCookie(res)).toBe('');
  });

  it('refuse un utilisateur inconnu avec le même message', async () => {
    const res = await login('inconnu', PASSWORD);
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Identifiant ou mot de passe incorrect');
  });

  it('connecte, donne accès à l’admin, puis déconnecte', async () => {
    const res = await login();
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/admin');
    const cookie = sessionCookie(res);
    const sc = res.cookies.find((c) => c.name === 'interfas_session')!;
    expect(sc.httpOnly).toBe(true);
    expect(sc.sameSite).toBe('Strict');

    const admin = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    expect(admin.statusCode).toBe(200);
    expect(admin.body).toContain('Bonjour Matthias');

    const out = await app.inject({ method: 'POST', url: '/admin/logout', headers: { cookie } });
    expect(out.statusCode).toBe(303);

    const after = await app.inject({ method: 'GET', url: '/admin', headers: { cookie } });
    expect(after.statusCode).toBe(302);
  });

  it('ignore un cookie de session falsifié', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin', headers: { cookie: 'interfas_session=abc.def' } });
    expect(res.statusCode).toBe(302);
  });

  it('ne redirige pas vers un site externe après connexion', async () => {
    const res = await login('matthias', PASSWORD, '//evil.example.com');
    expect(res.headers.location).toBe('/admin');
  });

  it('refuse les POST venant d’une autre origine', async () => {
    const { payload, ...headers } = form({ username: 'matthias', password: PASSWORD });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { ...headers, origin: 'http://evil.example.com' },
      payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuse un POST cross-site signalé par Sec-Fetch-Site', async () => {
    const { payload, ...headers } = form({ username: 'matthias', password: PASSWORD });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { ...headers, 'sec-fetch-site': 'cross-site' },
      payload,
    });
    expect(res.statusCode).toBe(403);
  });

  it('accepte un POST same-origin même avec Origin: null', async () => {
    const { payload, ...headers } = form({ username: 'matthias', password: PASSWORD });
    const res = await app.inject({
      method: 'POST',
      url: '/admin/login',
      headers: { ...headers, origin: 'null', 'sec-fetch-site': 'same-origin' },
      payload,
    });
    expect(res.statusCode).toBe(303);
  });
});

describe('mon compte', () => {
  it('change le mot de passe', async () => {
    await createUser(app.db, { username: 'alice', password: 'ancien-mot-de-passe' });
    const cookie = sessionCookie(await login('alice', 'ancien-mot-de-passe'));
    const { payload, ...headers } = form({
      current: 'ancien-mot-de-passe',
      password: 'nouveau-mot-de-passe',
      confirm: 'nouveau-mot-de-passe',
    });
    const res = await app.inject({ method: 'POST', url: '/admin/account/password', headers: { ...headers, cookie }, payload });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Mot de passe modifié');

    expect((await login('alice', 'ancien-mot-de-passe')).statusCode).toBe(401);
    expect((await login('alice', 'nouveau-mot-de-passe')).statusCode).toBe(303);
  });

  it('refuse si le mot de passe actuel est faux', async () => {
    const cookie = sessionCookie(await login());
    const { payload, ...headers } = form({ current: 'faux', password: 'xxxxxxxxxxxx', confirm: 'xxxxxxxxxxxx' });
    const res = await app.inject({ method: 'POST', url: '/admin/account/password', headers: { ...headers, cookie }, payload });
    expect(res.statusCode).toBe(400);
  });
});

describe('création d’utilisateur', () => {
  it('refuse un mot de passe trop court', async () => {
    await expect(createUser(app.db, { username: 'bob', password: 'court' })).rejects.toThrow(/10 caractères/);
  });
  it('refuse un doublon (insensible à la casse)', async () => {
    await expect(createUser(app.db, { username: 'MATTHIAS', password: PASSWORD })).rejects.toThrow(/existe déjà/);
  });
});
