import type { Db } from '../db/index.js';
import { hashPassword, MIN_PASSWORD_LENGTH } from './password.js';

export interface User {
  id: number;
  username: string;
  display_name: string;
  created_at: string;
  last_login_at: string | null;
}

interface UserRow extends User {
  password_hash: string;
}

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

export async function createUser(
  db: Db,
  input: { username: string; displayName?: string; password: string },
): Promise<User> {
  const username = input.username.trim();
  const error = validateUsername(username) ?? validatePassword(input.password);
  if (error) throw new Error(error);
  if (findUserByUsername(db, username)) throw new Error(`L'utilisateur « ${username} » existe déjà.`);

  const hash = await hashPassword(input.password);
  const info = db
    .prepare('INSERT INTO users (username, display_name, password_hash) VALUES (?, ?, ?)')
    .run(username, input.displayName?.trim() || username, hash);
  return getUserById(db, Number(info.lastInsertRowid))!;
}

export function findUserByUsername(db: Db, username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim()) as UserRow | undefined;
}

export function getUserById(db: Db, id: number): User | undefined {
  return db
    .prepare('SELECT id, username, display_name, created_at, last_login_at FROM users WHERE id = ?')
    .get(id) as User | undefined;
}

export function getPasswordHash(db: Db, id: number): string | undefined {
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as
    | { password_hash: string }
    | undefined;
  return row?.password_hash;
}

export async function setPassword(db: Db, id: number, password: string): Promise<void> {
  const error = validatePassword(password);
  if (error) throw new Error(error);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), id);
}

export function touchLastLogin(db: Db, id: number): void {
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(id);
}

export function countUsers(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}
