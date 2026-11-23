import crypto from 'node:crypto';
import type { Db } from '../db/index.js';
import type { User } from './users.js';

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours, prolongée à chaque visite

export function createSession(db: Db, userId: number): string {
  const id = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    id,
    userId,
    new Date(Date.now() + SESSION_TTL_MS).toISOString(),
  );
  return id;
}

/** Retourne l'utilisateur de la session si elle est valide, et prolonge son expiration. */
export function getSessionUser(db: Db, sessionId: string): User | undefined {
  const now = new Date().toISOString();
  const user = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.created_at, u.last_login_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .get(sessionId, now) as User | undefined;
  if (user) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(
      new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      sessionId,
    );
  }
  return user;
}

export function deleteSession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteOtherSessions(db: Db, userId: number, keepSessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId);
}

export function purgeExpiredSessions(db: Db): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}
