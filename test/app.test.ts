import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ ...loadConfig({}), databasePath: ':memory:', logLevel: 'silent' });
});
afterAll(async () => app.close());

describe('squelette', () => {
  it('répond sur /health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('sert la page d’affichage', async () => {
    const res = await app.inject({ method: 'GET', url: '/display' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Aucun message');
  });

  it('redirige l’admin vers la connexion', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^\/admin\/login/);
  });

  it('applique les migrations', () => {
    const row = app.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number };
    expect(row.v).toBeGreaterThanOrEqual(1);
  });
});
