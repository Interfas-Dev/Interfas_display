import type { Db } from '../db/index.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password.js';

export const ROLES = ['admin', 'editor'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = { admin: 'Administrateur', editor: 'Éditeur' };

export interface User {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  is_active: number;
  must_change_password: number;
  created_at: string;
  last_login_at: string | null;
}

interface UserRow extends User {
  password_hash: string;
}

export const USER_COLUMNS = 'id, username, display_name, role, is_active, must_change_password, created_at, last_login_at';
export const DISPLAY_NAME_MAX = 60;

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/i;

export function validateUsername(username: string): string | null {
  return USERNAME_RE.test(username)
    ? null
    : "L'identifiant doit faire 3 à 32 caractères (lettres, chiffres, . _ -).";
}

export function validatePassword(password: string): string | null {
  return password.length >= MIN_PASSWORD_LENGTH
    ? null
    : `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export async function createUser(
  db: Db,
  input: { username: string; displayName?: string; password: string; role?: Role; mustChangePassword?: boolean },
): Promise<User> {
  const username = input.username.trim();
  const error = validateUsername(username) ?? validatePassword(input.password);
  if (error) throw new Error(error);
  if (findUserByUsername(db, username)) throw new Error(`L'utilisateur « ${username} » existe déjà.`);

  const hash = await hashPassword(input.password);
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, ?)')
    .run(
      username,
      input.displayName?.trim().slice(0, DISPLAY_NAME_MAX) || username,
      hash,
      input.role ?? 'admin',
      input.mustChangePassword ? 1 : 0,
    );
  return getUserById(db, Number(info.lastInsertRowid))!;
}

export function findUserByUsername(db: Db, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
}

export function getUserById(db: Db, id: number): User | undefined {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as User | undefined;
}

export function listUsers(db: Db): User[] {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY is_active DESC, display_name COLLATE NOCASE`).all() as User[];
}

export function getPasswordHash(db: Db, id: number): string | undefined {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as
    | { password_hash: string }
    | undefined;
  return row?.password_hash;
}

/** mustChange : mot de passe provisoire, à changer à la prochaine connexion. */
export async function setPassword(db: Db, id: number, password: string, mustChange = false): Promise<void> {
  const error = validatePassword(password);
  if (error) throw new Error(error);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = ? WHERE id = ?').run(
    await hashPassword(password),
    mustChange ? 1 : 0,
    id,
  );
}

export function updateUser(db: Db, id: number, input: { displayName: string; role: Role; isActive: boolean }): void {
  db.prepare('UPDATE users SET display_name = ?, role = ?, is_active = ? WHERE id = ?').run(
    input.displayName,
    input.role,
    input.isActive ? 1 : 0,
    id,
  );
  if (!input.isActive) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
}

export function deleteUser(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0;
}

export function touchLastLogin(db: Db, id: number): void {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}

export function countUsers(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function countActiveAdmins(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1").get() as { n: number }).n;
}
