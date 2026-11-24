import path from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  /** Dossier des images téléversées (par défaut : <dossier de la base>/media). */
  mediaDir: string;
  /** Dossier des sauvegardes (par défaut : <dossier de la base>/backups). */
  backupDir: string;
  /** Heure de la sauvegarde quotidienne (HH:MM, fuseau TIMEZONE) ; vide = désactivée. */
  backupTime: string;
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
    backupDir: path.resolve(env.BACKUP_DIR ?? path.join(path.dirname(databasePath), 'backups')),
    backupTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(env.BACKUP_TIME ?? '03:00') ? (env.BACKUP_TIME ?? '03:00') : '',
    sessionSecret: sessionSecret || 'dev-secret-a-ne-pas-utiliser-en-production',
    isProduction,
    logLevel: env.LOG_LEVEL ?? 'info',
    timezone: env.TIMEZONE ?? 'Europe/Paris',
    cookieSecure: env.COOKIE_SECURE === 'true',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}
