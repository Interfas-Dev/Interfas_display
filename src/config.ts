import path from 'node:path';

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  sessionSecret: string;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const sessionSecret = env.SESSION_SECRET ?? '';

  if (isProduction && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET doit faire au moins 32 caractères en production.');
  }

  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databasePath: path.resolve(env.DATABASE_PATH ?? './data/interfas.db'),
    sessionSecret: sessionSecret || 'dev-secret-a-ne-pas-utiliser-en-production',
    isProduction,
  };
}
