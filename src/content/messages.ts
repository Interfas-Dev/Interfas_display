import type { Db } from '../db/index.js';
import { isEmptyContent, sanitizeContent } from './sanitize.js';

export interface Message {
  id: number;
  title: string;
  content_html: string;
  is_active: number;
  position: number;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
}

export interface MessageInput {
  title: string;
  contentHtml: string;
  isActive: boolean;
}

export const TITLE_MAX = 120;

/** Valide et normalise une saisie. Retourne les erreurs par champ. */
export function validateMessage(raw: { title?: unknown; content?: unknown; is_active?: unknown }) {
  const title = String(raw.title ?? '').trim();
  const contentHtml = sanitizeContent(String(raw.content ?? ''));
  const isActive = raw.is_active === 'on' || raw.is_active === '1' || raw.is_active === true;
  const errors: Record<string, string> = {};
  if (!title) errors.title = 'Le titre est obligatoire.';
  else if (title.length > TITLE_MAX) errors.title = `Le titre ne doit pas dépasser ${TITLE_MAX} caractères.`;
  if (isEmptyContent(contentHtml)) errors.content = 'Le message ne peut pas être vide.';
  return { input: { title, contentHtml, isActive } satisfies MessageInput, errors };
}

const SELECT = `SELECT m.*, u.display_name AS updated_by_name
  FROM messages m LEFT JOIN users u ON u.id = m.updated_by`;

export function listMessages(db: Db): Message[] {
  return db.prepare(`${SELECT} ORDER BY m.position, m.id`).all() as Message[];
}

export function listActiveMessages(db: Db): Message[] {
  return db.prepare(`${SELECT} WHERE m.is_active = 1 ORDER BY m.position, m.id`).all() as Message[];
}

export function getMessage(db: Db, id: number): Message | undefined {
  return db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as Message | undefined;
}

export function createMessage(db: Db, input: MessageInput, userId: number): number {
  const next = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM messages').get() as { p: number }).p;
  const info = db
    .prepare(
      `INSERT INTO messages (title, content_html, is_active, position, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(input.title, input.contentHtml, input.isActive ? 1 : 0, next, userId, userId);
  return Number(info.lastInsertRowid);
}

export function updateMessage(db: Db, id: number, input: MessageInput, userId: number): boolean {
  return (
    db
      .prepare(
        `UPDATE messages SET title = ?, content_html = ?, is_active = ?, updated_by = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(input.title, input.contentHtml, input.isActive ? 1 : 0, userId, id).changes > 0
  );
}

export function setMessageActive(db: Db, id: number, active: boolean, userId: number): boolean {
  return (
    db
      .prepare(`UPDATE messages SET is_active = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(active ? 1 : 0, userId, id).changes > 0
  );
}

export function deleteMessage(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM messages WHERE id = ?').run(id).changes > 0;
}

/** Monte ou descend un message d'un cran dans l'ordre de diffusion. */
export function moveMessage(db: Db, id: number, direction: 'up' | 'down'): void {
  db.transaction(() => {
    const ids = (db.prepare('SELECT id FROM messages ORDER BY position, id').all() as { id: number }[]).map((r) => r.id);
    const i = ids.indexOf(id);
    const j = direction === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    const stmt = db.prepare('UPDATE messages SET position = ? WHERE id = ?');
    ids.forEach((mid, pos) => stmt.run(pos, mid));
  })();
}
