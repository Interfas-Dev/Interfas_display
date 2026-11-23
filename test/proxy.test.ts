import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createUser } from '../src/auth/users.js';
import { PASSWORD, form } from './helpers/app.js';

describe('derrière Traefik (COOKIE_SECURE / TRUST_PROXY)', () => {
  let app: FastifyInstance;
  let seen: { ip: string; protocol: string } | undefined;

  beforeAll(async () => {
    const config = loadConfig({ COOKIE_SECURE: 'true', TRUST_PROXY: 'true' });
    expect(config.cookieSecure).toBe(true);
    expect(config.trustProxy).toBe(true);
    app = await buildApp({ ...config, databasePath: ':memory:', logLevel: 'silent' });
    await createUser(app.db, { username: 'matthias', password: PASSWORD });
    app.addHook('onRequest', async (req) => {
      if (req.url === '/health') seen = { ip: req.ip, protocol: req.protocol };
    });
  });
  afterAll(async () => app.close());

  it('pose un cookie de session Secure', async () => {
    const { headers, payload } = form({ username: 'matthias', password: PASSWORD });
    const res = await app.inject({ method: 'POST', url: '/admin/login', headers, payload });
    expect(res.statusCode).toBe(303);
    const sc = res.cookies.find((c) => c.name === 'interfas_session')!;
    expect(sc.secure).toBe(true);
    expect(sc.httpOnly).toBe(true);
  });

  it('lit la vraie IP du client et le protocole transmis par Traefik', async () => {
    await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-forwarded-for': '192.168.1.42', 'x-forwarded-proto': 'https' },
    });
    expect(seen).toEqual({ ip: '192.168.1.42', protocol: 'https' });
  });
});

describe('par défaut (hors proxy)', () => {
  it('pas de cookie Secure ni de confiance aux en-têtes X-Forwarded-*', () => {
    const config = loadConfig({});
    expect(config.cookieSecure).toBe(false);
    expect(config.trustProxy).toBe(false);
  });
});
