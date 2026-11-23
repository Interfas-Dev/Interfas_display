import type { FastifyRequest } from 'fastify';
import type { Db } from './db/index.js';
import type { User } from './auth/users.js';

export const ENTITIES = {
  message: 'Message',
  template: 'Template',
  user: 'Compte',
  session: 'Connexion',
  backup: 'Sauvegarde',
} as const;
export type Entity = keyof typeof ENTITIES;

export const ACTION_LABELS: Record<string, string> = {
  create: 'Création',
  update: 'Modification',
  delete: 'Suppression',
  enable: 'Activation',
  disable: 'Désactivation',
  move: 'Ordre de diffusion',
  password: 'Mot de passe',
  password_reset: 'Mot de passe réinitialisé',
  login: 'Connexion',
  login_failed: 'Échec de connexion',
  logout: 'Déconnexion',
  run: 'Sauvegarde manuelle',
};

/** Durée de conservation du journal. */
export const AUDIT_RETENTION_DAYS = 365;

export interface AuditEntry {
  id: number;
  at: string;
  user_id: number | null;
  username: string;
  action: string;
  entity: Entity;
  entity_id: number | null;
  label: string;
  details: string;
  ip: string;
}

export interface AuditInput {
  action: string;
  entity: Entity;
  entityId?: number | null;
  label?: string;
  details?: string[];
  /** Auteur, si différent de req.user (ex. connexion). */
  user?: Pick<User, 'id' | 'display_name'> | null;
  username?: string;
}

export function logAudit(db: Db, req: FastifyRequest | null, input: AuditInput): void {
  const user = input.user !== undefined ? input.user : req?.user ?? null;
  db.prepare(
    `INSERT INTO audit_log (user_id, username, action, entity, entity_id, label, details, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    user?.id ?? null,
    input.username ?? user?.display_name ?? '',
    input.action,
    input.entity,
    input.entityId ?? null,
    (input.label ?? '').slice(0, 200),
    JSON.stringify(input.details ?? []),
    req?.ip ?? '',
  );
}

export interface AuditFilter {
  userId?: number;
  entity?: Entity;
  page?: number;
}

export const AUDIT_PAGE_SIZE = 50;

export function listAudit(db: Db, filter: AuditFilter = {}): { entries: AuditEntry[]; hasMore: boolean } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.userId) {
    where.push('user_id = ?');
    params.push(filter.userId);
  }
  if (filter.entity) {
    where.push('entity = ?');
    params.push(filter.entity);
  }
  const page = Math.max(1, filter.page ?? 1);
  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, AUDIT_PAGE_SIZE + 1, (page - 1) * AUDIT_PAGE_SIZE) as AuditEntry[];
  return { entries: rows.slice(0, AUDIT_PAGE_SIZE), hasMore: rows.length > AUDIT_PAGE_SIZE };
}

export function purgeAudit(db: Db, days = AUDIT_RETENTION_DAYS): number {
  return db.prepare(`DELETE FROM audit_log WHERE at < datetime('now', ?)`).run(`-${days} days`).changes;
}

/** Comparaison champ par champ : « Libellé : avant → après ». */
export type FieldSpec<T> = {
  label: string;
  get: (v: T) => unknown;
  /** Format d'affichage ; null = signaler le changement sans les valeurs (texte long). */
  format?: ((v: unknown) => string) | null;
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '(vide)' : String(v));

export function diff<T>(before: T, after: T, specs: FieldSpec<T>[]): string[] {
  const out: string[] = [];
  for (const spec of specs) {
    const a = spec.get(before);
    const b = spec.get(after);
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (spec.format === null) out.push(`${spec.label} modifié`);
    else {
      const f = spec.format ?? show;
      out.push(`${spec.label} : ${f(a)} → ${f(b)}`);
    }
  }
  return out;
}

export const yesNo = (v: unknown) => (v ? 'oui' : 'non');
