export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/**
 * Migrations du schéma, jouées dans l'ordre au démarrage.
 * Ne jamais modifier une migration déjà livrée : en ajouter une nouvelle.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE app_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: 'users_sessions',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_login_at TEXT
      );
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user_id ON sessions(user_id);
    `,
  },
  {
    version: 3,
    name: 'messages',
    sql: `
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content_html TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        position INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX messages_position ON messages(position);
    `,
  },
];
