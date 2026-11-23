import path from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  /** Dossier des images téléversées (par défaut : <dossier de la base>/media). */
  mediaDir: string;
  sessionSecret: string;
  isProduction: boolean;
  logLevel: string;
  timezone: string;
  /** Cookie de session envoyé uniquement en HTTPS. */
  cookieSecure: boolean;
  /** Derrière un reverse proxy (Traefik) : lire X-Forwarded-For / -Proto. */
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const sessionSecret = env.SESSION_SECRET ?? '';

  if (isProduction && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET doit faire au moins 32 caractères en production.');
  }

  const databasePath = path.resolve(env.DATABASE_PATH ?? './data/interfas.db');

  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databasePath,
    mediaDir: path.resolve(env.MEDIA_DIR ?? path.join(path.dirname(databasePath), 'media')),
    sessionSecret: sessionSecret || 'dev-secret-a-ne-pas-utiliser-en-production',
    isProduction,
    logLevel: env.LOG_LEVEL ?? 'info',
    timezone: env.TIMEZONE ?? 'Europe/Paris',
    cookieSecure: env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}
