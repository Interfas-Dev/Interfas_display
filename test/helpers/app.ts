import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createUser } from '../../src/auth/users.js';

export const PASSWORD = 'motdepasse-solide';

export async function makeApp(): Promise<FastifyInstance> {
  return buildApp({ ...loadConfig({}), databasePath: ':memory:', logLevel: 'silent' });
}

export function form(data: Record<string, string>) {
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: new URLSearchParams(data).toString(),
  };
}

export function sessionCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((c) => c.name === 'interfas_session');
  return c ? `interfas_session=${c.value}` : '';
}

/** Crée un utilisateur et retourne le cookie de sa session. */
export async function loginAs(app: FastifyInstance, username = 'matthias', displayName = 'Matthias'): Promise<string> {
  await createUser(app.db, { username, displayName, password: PASSWORD });
  const { headers, payload } = form({ username, password: PASSWORD });
  return sessionCookie(await app.inject({ method: 'POST', url: '/admin/login', headers, payload }));
}
