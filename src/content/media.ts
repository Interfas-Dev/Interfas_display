import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { Db } from '../db/index.js';

/** Tailles maximales : les images restent légères, les vidéos peuvent être longues. */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 200 * 1024 * 1024;
/** Les GIF animés sont souvent plus lourds qu'une image fixe. */
export const GIF_MAX_BYTES = 20 * 1024 * 1024;
/** Compatibilité : ancienne constante (images). */
export const MEDIA_MAX_BYTES = IMAGE_MAX_BYTES;
/** Polices envoyées pour les templates. */
export const FONT_MAX_BYTES = 2 * 1024 * 1024;

/** Types acceptés. Le SVG est exclu : il peut contenir du script. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/webm'] as const;
export const FONT_TYPES = ['font/woff2', 'font/woff', 'font/ttf', 'font/otf'] as const;
export const MEDIA_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES, ...FONT_TYPES] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Nom de fichier stocké : <uuid>.<ext>. */
export const MEDIA_FILE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif|mp4|webm|woff2|woff|ttf|otf)$/;
export const VIDEO_FILE_RE = /\.(mp4|webm)$/;

const EXT: Record<MediaType, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm',
  'font/woff2': 'woff2', 'font/woff': 'woff', 'font/ttf': 'ttf', 'font/otf': 'otf',
};
export const MIME_BY_EXT: Record<string, MediaType> = {
  png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm',
  woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf',
};

export const isVideo = (file: string) => VIDEO_FILE_RE.test(file);
export const isFont = (file: string) => /\.(woff2|woff|ttf|otf)$/.test(file);
export const maxBytesFor = (mime: string) =>
  mime.startsWith('video/') ? VIDEO_MAX_BYTES : mime.startsWith('font/') ? FONT_MAX_BYTES : mime === 'image/gif' ? GIF_MAX_BYTES : IMAGE_MAX_BYTES;

/** Reconnaît le format réel d'après les premiers octets (sans se fier à l'en-tête envoyé). */
export function detectMediaType(buf: Buffer): MediaType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // GIF (fixe ou animé)
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  // MP4 / MOV ISO : boîte « ftyp » en tête
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') return 'video/mp4';
  // WebM (Matroska / EBML)
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  // Polices : WOFF2, WOFF, TrueType, OpenType (CFF)
  if (buf.length >= 4) {
    const sig = buf.toString('latin1', 0, 4);
    if (sig === 'wOF2') return 'font/woff2';
    if (sig === 'wOFF') return 'font/woff';
    if (sig === 'OTTO') return 'font/otf';
    if (sig === 'true' || buf.readUInt32BE(0) === 0x00010000) return 'font/ttf';
  }
  return null;
}
/** Compatibilité. */
export const detectImageType = (buf: Buffer) => {
  const t = detectMediaType(buf);
  return t && t.startsWith('image/') ? t : null;
};

export class MediaError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Enregistre un fichier envoyé en flux (sans le garder en mémoire : une vidéo
 * peut peser 200 Mo et le conteneur est limité en RAM). Le format est vérifié
 * sur les premiers octets et doit correspondre au type annoncé (image ou vidéo).
 */
export async function saveMediaStream(
  db: Db,
  dir: string,
  input: Readable,
  declared: string,
  userId: number,
): Promise<{ file: string; mime: MediaType }> {
  const limit = maxBytesFor(declared);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.envoi-${randomUUID()}`);
  let size = 0;
  let head = Buffer.alloc(0);
  let tooBig = false;
  const out = createWriteStream(tmp, { flags: 'wx' });
  const closed = new Promise<void>((resolve, reject) => {
    out.on('close', resolve);
    out.on('error', reject);
  });
  try {
    // Lecture manuelle : en cas de dépassement, on continue de lire (sans écrire)
    // pour pouvoir répondre proprement 413 au lieu de couper la connexion.
    for await (const chunk of input as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (tooBig) continue;
      if (size > limit) {
        tooBig = true;
        continue;
      }
      if (head.length < 16) head = Buffer.concat([head, chunk.subarray(0, 16)]);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    }
    out.end();
    await closed;
    if (tooBig) {
      throw new MediaError(
        413,
        limit === VIDEO_MAX_BYTES ? 'Vidéo trop lourde : 200 Mo maximum.' : limit === FONT_MAX_BYTES ? 'Police trop lourde : 2 Mo maximum.' : limit === GIF_MAX_BYTES ? 'GIF trop lourd : 20 Mo maximum.' : 'Image trop lourde : 5 Mo maximum.',
      );
    }
    if (!size) throw new MediaError(400, 'Fichier vide.');
    const mime = detectMediaType(head);
    if (!mime || mime.split('/')[0] !== declared.split('/')[0]) {
      throw new MediaError(
        415,
        declared.startsWith('font/') ? 'Format non reconnu : WOFF2, WOFF, TTF ou OTF uniquement.' : 'Format non reconnu : PNG, JPG, WebP, GIF, MP4 ou WebM uniquement.',
      );
    }
    const file = `${randomUUID()}.${EXT[mime]}`;
    await fs.rename(tmp, path.join(dir, file));
    db.prepare('INSERT INTO media (file, mime, size, created_by) VALUES (?, ?, ?, ?)').run(file, mime, size, userId);
    return { file, mime };
  } catch (err) {
    out.destroy();
    await fs.rm(tmp, { force: true });
    throw err;
  }
}

export function mediaExists(db: Db, file: string): boolean {
  return MEDIA_FILE_RE.test(file) && !!db.prepare('SELECT 1 FROM media WHERE file = ?').get(file);
}

/**
 * Supprime les fichiers qui ne sont utilisés par aucun message, template ou police (ajoutés puis
 * retirés, ou formulaire abandonné) après un délai de grâce.
 */
export async function purgeOrphanMedia(db: Db, dir: string, olderThanHours = 24): Promise<number> {
  const orphans = db
    .prepare(
      `SELECT file FROM media
       WHERE created_at < datetime('now', ?)
         AND NOT EXISTS (SELECT 1 FROM messages
                         WHERE instr(messages.images_json, media.file) > 0 OR messages.video_file = media.file)
         AND NOT EXISTS (SELECT 1 FROM templates WHERE instr(templates.style_json, media.file) > 0)
         AND NOT EXISTS (SELECT 1 FROM fonts WHERE fonts.file = media.file)`,
    )
    .all(`-${olderThanHours} hours`) as { file: string }[];
  for (const { file } of orphans) {
    await fs.rm(path.join(dir, file), { force: true });
    db.prepare('DELETE FROM media WHERE file = ?').run(file);
  }
  // Restes d'envois interrompus
  for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!n.startsWith('.envoi-')) continue;
    const st = await fs.stat(path.join(dir, n)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > olderThanHours * 3600 * 1000) await fs.rm(path.join(dir, n), { force: true });
  }
  return orphans.length;
}
