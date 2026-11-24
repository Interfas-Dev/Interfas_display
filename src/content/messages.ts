import type { Db } from '../db/index.js';
import { isEmptyContent, sanitizeContent } from './sanitize.js';
import type { Frame, Theme } from './templates.js';
import { parseImages, type SlideImage } from './images.js';
import { isVideo } from './media.js';
import { isLive, validateSchedule, type LocalNow, type ScheduleInput } from './schedule.js';

export interface Message {
  id: number;
  title: string;
  heading: string;
  content_html: string;
  signature_name: string;
  signature_role: string;
  template_id: number | null;
  is_active: number;
  duration_seconds: number;
  starts_at: string | null;
  ends_at: string | null;
  days_mask: number;
  daily_start: string | null;
  daily_end: string | null;
  /** Images posées sur la diapo (JSON de SlideImage[]). */
  images_json: string;
  /** Vidéo plein écran : le message n'affiche qu'elle, le temps de la vidéo. */
  video_file: string | null;
  video_sound: number;
  position: number;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  // Champs du template associé (pour le rendu)
  template_name: string | null;
  theme: Theme;
  frame: Frame;
  show_logo: number;
  /** Signature affichée : celle du message, sinon celle par défaut du template. */
  sig_name: string;
  sig_role: string;
}

export interface MessageInput extends ScheduleInput {
  title: string;
  heading: string;
  contentHtml: string;
  signatureName: string;
  signatureRole: string;
  templateId: number | null;
  isActive: boolean;
  images: SlideImage[];
  videoFile: string | null;
  videoSound: boolean;
}

export const TITLE_MAX = 120;
export const HEADING_MAX = 120;
export const SIGNATURE_MAX = 80;

/** Valide et normalise une saisie. Retourne les erreurs par champ. */
export function validateMessage(
  raw: Record<string, unknown>,
  templateExists: (id: number) => boolean,
  mediaExists: (file: string) => boolean = () => false,
) {
  const heading = String(raw.heading ?? '').trim();
  // Le titre interne reprend le titre affiché s'il est laissé vide.
  const title = String(raw.title ?? '').trim() || heading;
  const contentHtml = sanitizeContent(String(raw.content ?? ''));
  const signatureName = String(raw.signature_name ?? '').trim();
  const signatureRole = String(raw.signature_role ?? '').trim();
  const tid = Number(raw.template_id);
  const templateId = Number.isInteger(tid) && tid > 0 ? tid : null;
  const isActive = raw.is_active === 'on' || raw.is_active === '1' || raw.is_active === true;

  const errors: Record<string, string> = {};
  if (!title) errors.title = 'Donne au moins un titre (affiché ou interne).';
  else if (title.length > TITLE_MAX) errors.title = `Le titre interne ne doit pas dépasser ${TITLE_MAX} caractères.`;
  if (heading.length > HEADING_MAX) errors.heading = `Le titre affiché ne doit pas dépasser ${HEADING_MAX} caractères.`;
  const rawVideo = String(raw.video_file ?? '').trim();
  const videoFile = rawVideo && isVideo(rawVideo) && mediaExists(rawVideo) ? rawVideo : null;
  if (rawVideo && !videoFile) errors.video = 'Vidéo introuvable : ajoute-la à nouveau.';
  const videoSound = !!videoFile && (raw.video_sound === 'on' || raw.video_sound === true);
  if (!heading && isEmptyContent(contentHtml) && !parseImages(raw.images, mediaExists).images.length && !videoFile) {
    errors.content = 'Le message est vide : ajoute un titre affiché, du texte, une image ou une vidéo.';
  }
  if (signatureName.length > SIGNATURE_MAX || signatureRole.length > SIGNATURE_MAX) {
    errors.signature = `La signature ne doit pas dépasser ${SIGNATURE_MAX} caractères par ligne.`;
  }
  if (!templateId || !templateExists(templateId)) errors.template_id = 'Choisis un template.';

  const parsed = parseImages(raw.images, mediaExists);
  if (parsed.error) errors.images = parsed.error;

  const schedule = validateSchedule(raw);
  Object.assign(errors, schedule.errors);

  return {
    input: {
      title, heading, contentHtml: isEmptyContent(contentHtml) ? '' : contentHtml,
      signatureName, signatureRole, templateId, isActive, images: parsed.images, videoFile, videoSound, ...schedule.input,
    } satisfies MessageInput,
    errors,
  };
}

const SELECT = `SELECT m.*, u.display_name AS updated_by_name,
    t.name AS template_name,
    COALESCE(t.theme, 'light') AS theme,
    COALESCE(t.frame, 'none') AS frame,
    COALESCE(t.show_logo, 1) AS show_logo,
    CASE WHEN m.signature_name != '' OR m.signature_role != '' THEN m.signature_name
         ELSE COALESCE(t.default_signature_name, '') END AS sig_name,
    CASE WHEN m.signature_name != '' OR m.signature_role != '' THEN m.signature_role
         ELSE COALESCE(t.default_signature_role, '') END AS sig_role
  FROM messages m
  LEFT JOIN users u ON u.id = m.updated_by
  LEFT JOIN templates t ON t.id = m.template_id`;

export function listMessages(db: Db): Message[] {
  return db.prepare(`${SELECT} ORDER BY m.position, m.id`).all() as Message[];
}

/** Messages à afficher maintenant : actifs et dans leur planification. */
export function listLiveMessages(db: Db, now: LocalNow): Message[] {
  return (db.prepare(`${SELECT} WHERE m.is_active = 1 ORDER BY m.position, m.id`).all() as Message[]).filter((m) =>
    isLive(m, now),
  );
}

export function getMessage(db: Db, id: number): Message | undefined {
  return db.prepare(`${SELECT} WHERE m.id = ?`).get(id) as Message | undefined;
}

export function createMessage(db: Db, input: MessageInput, userId: number): number {
  const next = (db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM messages').get() as { p: number }).p;
  const info = db
    .prepare(
      `INSERT INTO messages (title, heading, content_html, signature_name, signature_role, template_id, is_active,
         duration_seconds, starts_at, ends_at, days_mask, daily_start, daily_end, images_json, video_file, video_sound, position, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title, input.heading, input.contentHtml, input.signatureName, input.signatureRole,
      input.templateId, input.isActive ? 1 : 0,
      input.durationSeconds, input.startsAt, input.endsAt, input.daysMask, input.dailyStart, input.dailyEnd,
      JSON.stringify(input.images), input.videoFile, input.videoSound ? 1 : 0, next, userId, userId,
    );
  return Number(info.lastInsertRowid);
}

export function updateMessage(db: Db, id: number, input: MessageInput, userId: number): boolean {
  return (
    db
      .prepare(
        `UPDATE messages SET title = ?, heading = ?, content_html = ?, signature_name = ?, signature_role = ?,
           template_id = ?, is_active = ?, duration_seconds = ?, starts_at = ?, ends_at = ?, days_mask = ?,
           daily_start = ?, daily_end = ?, images_json = ?, video_file = ?, video_sound = ?, updated_by = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        input.title, input.heading, input.contentHtml, input.signatureName, input.signatureRole,
        input.templateId, input.isActive ? 1 : 0,
        input.durationSeconds, input.startsAt, input.endsAt, input.daysMask, input.dailyStart, input.dailyEnd,
        JSON.stringify(input.images), input.videoFile, input.videoSound ? 1 : 0, userId, id,
      ).changes > 0
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
