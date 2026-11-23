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
];
