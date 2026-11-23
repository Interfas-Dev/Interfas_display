import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Db } from '../db/index.js';

/** Taille maximale d'une image téléversée. */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
/** Types acceptés. Le SVG est exclu : il peut contenir du script. */
export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** Nom de fichier stocké : <uuid>.<ext>. */
export const MEDIA_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const MIME_BY_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Reconnaît le format réel d'après les premiers octets (sans se fier à l'en-tête envoyé). */
export function detectImageType(buf: Buffer): (typeof MEDIA_TYPES)[number] | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

export async function saveMedia(db: Db, dir: string, buf: Buffer, userId: number): Promise<string | null> {
  const mime = detectImageType(buf);
  if (!mime) return null;
  const file = `${randomUUID()}.${EXT[mime]}`;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, file), buf, { flag: 'wx' });
  db.prepare('INSERT INTO media (file, mime, size, created_by) VALUES (?, ?, ?, ?)').run(file, mime, buf.length, userId);
  return file;
}

export function mediaExists(db: Db, file: string): boolean {
  return MEDIA_FILE_RE.test(file) && !!db.prepare('SELECT 1 FROM media WHERE file = ?').get(file);
}

/**
 * Supprime les images qui ne sont utilisées par aucun message (ajoutées puis
 * retirées, ou formulaire abandonné) après un délai de grâce.
 */
export async function purgeOrphanMedia(db: Db, dir: string, olderThanHours = 24): Promise<number> {
  const orphans = db
    .prepare(
      `SELECT file FROM media
       WHERE created_at < datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM messages WHERE instr(messages.images_json, media.file) > 0)`,
    )
    .all(`-${olderThanHours} hours`) as { file: string }[];
  for (const { file } of orphans) {
    await fs.rm(path.join(dir, file), { force: true });
    db.prepare('DELETE FROM media WHERE file = ?').run(file);
  }
  return orphans.length;
}
