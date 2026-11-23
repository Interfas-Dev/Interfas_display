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
  {
    version: 4,
    name: 'templates',
    sql: `
      CREATE TABLE templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        theme TEXT NOT NULL DEFAULT 'light' CHECK (theme IN ('light', 'dark', 'red')),
        frame TEXT NOT NULL DEFAULT 'greige' CHECK (frame IN ('none', 'greige', 'red')),
        show_logo INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 0,
        default_signature_name TEXT NOT NULL DEFAULT '',
        default_signature_role TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO templates (name, theme, frame, show_logo, is_default) VALUES
        ('Annonce (clair)', 'light', 'greige', 1, 1),
        ('Annonce (sombre)', 'dark', 'none', 1, 0),
        ('Important (aplat rouge)', 'red', 'none', 1, 0);

      ALTER TABLE messages ADD COLUMN heading TEXT NOT NULL DEFAULT '';
      ALTER TABLE messages ADD COLUMN signature_name TEXT NOT NULL DEFAULT '';
      ALTER TABLE messages ADD COLUMN signature_role TEXT NOT NULL DEFAULT '';
      ALTER TABLE messages ADD COLUMN template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL;
      UPDATE messages SET template_id = (SELECT id FROM templates WHERE is_default = 1);
    `,
  },
  {
    version: 5,
    name: 'duree_planification',
    sql: `
      -- Dates et heures en heure locale de l'atelier (fuseau TIMEZONE, Paris par défaut),
      -- au format AAAA-MM-JJTHH:MM. days_mask : bit 0 = lundi ... bit 6 = dimanche.
      ALTER TABLE messages ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 10;
      ALTER TABLE messages ADD COLUMN starts_at TEXT;
      ALTER TABLE messages ADD COLUMN ends_at TEXT;
      ALTER TABLE messages ADD COLUMN days_mask INTEGER NOT NULL DEFAULT 127;
      ALTER TABLE messages ADD COLUMN daily_start TEXT;
      ALTER TABLE messages ADD COLUMN daily_end TEXT;
    `,
  },
  {
    version: 6,
    name: 'images',
    sql: `
      -- Images téléversées (fichiers dans MEDIA_DIR, nommés <uuid>.<ext>).
      CREATE TABLE media (
        file TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      -- Images posées librement sur la diapo : [{ file, x, y, w, layer }],
      -- x / y / w en pourcentage de la diapo, layer = front | back.
      ALTER TABLE messages ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]';
    `,
  },
];
