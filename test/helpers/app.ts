import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createUser } from '../../src/auth/users.js';

export const PASSWORD = 'motdepasse-solide';

export async function makeApp(): Promise<FastifyInstance> {
  const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interfas-media-'));
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'interfas-backups-'));
  return buildApp({ ...loadConfig({}), databasePath: ':memory:', mediaDir, backupDir, backupTime: '', logLevel: 'silent' });
}

export function form(data: Record<string, string | string[]>) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) for (const x of Array.isArray(v) ? v : [v]) params.append(k, x);
  return {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    payload: params.toString(),
  };
}

export const ALL_DAYS_FIELD = ['0', '1', '2', '3', '4', '5', '6'];

/** Champs « Diffusion » par défaut d'un formulaire de message. */
export function messageDefaults(templateId: string) {
  return { template_id: templateId, duration_seconds: '10', days: ALL_DAYS_FIELD };
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
