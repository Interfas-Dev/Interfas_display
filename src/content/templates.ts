import type { Db } from '../db/index.js';

export const THEMES = [
  { value: 'light', label: 'Clair (fond beige, texte noir chaud)' },
  { value: 'dark', label: 'Sombre (fond noir chaud, texte blanc)' },
  { value: 'red', label: 'Aplat rouge (texte blanc)' },
] as const;

export const FRAMES = [
  { value: 'none', label: 'Aucun' },
  { value: 'greige', label: 'Filet grège' },
  { value: 'red', label: 'Filet rouge' },
] as const;

export type Theme = (typeof THEMES)[number]['value'];
export type Frame = (typeof FRAMES)[number]['value'];

export interface Template {
  id: number;
  name: string;
  theme: Theme;
  frame: Frame;
  show_logo: number;
  is_default: number;
  default_signature_name: string;
  default_signature_role: string;
  created_at: string;
  updated_at: string;
  usage_count?: number;
}

export interface TemplateInput {
  name: string;
  theme: Theme;
  frame: Frame;
  showLogo: boolean;
  isDefault: boolean;
  signatureName: string;
  signatureRole: string;
}

export const NAME_MAX = 60;
export const SIGNATURE_MAX = 80;

export function validateTemplate(raw: Record<string, unknown>) {
  const name = String(raw.name ?? '').trim();
  const theme = THEMES.some((t) => t.value === raw.theme) ? (raw.theme as Theme) : 'light';
  const frame = FRAMES.some((f) => f.value === raw.frame) ? (raw.frame as Frame) : 'none';
  const signatureName = String(raw.default_signature_name ?? '').trim();
  const signatureRole = String(raw.default_signature_role ?? '').trim();
  const errors: Record<string, string> = {};
  if (signatureName.length > SIGNATURE_MAX || signatureRole.length > SIGNATURE_MAX) {
    errors.signature = `La signature ne doit pas dépasser ${SIGNATURE_MAX} caractères par ligne.`;
  }
  if (!name) errors.name = 'Le nom est obligatoire.';
  else if (name.length > NAME_MAX) errors.name = `Le nom ne doit pas dépasser ${NAME_MAX} caractères.`;
  return {
    input: { name, theme, frame, showLogo: raw.show_logo === 'on', isDefault: raw.is_default === 'on', signatureName, signatureRole } satisfies TemplateInput,
    errors,
  };
}

export function listTemplates(db: Db): Template[] {
  return db
    .prepare(
      `SELECT t.*, (SELECT COUNT(*) FROM messages m WHERE m.template_id = t.id) AS usage_count
       FROM templates t ORDER BY t.is_default DESC, t.name`,
    )
    .all() as Template[];
}

export function getTemplate(db: Db, id: number): Template | undefined {
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Template | undefined;
}

export function getDefaultTemplate(db: Db): Template | undefined {
  return db.prepare('SELECT * FROM templates ORDER BY is_default DESC, id LIMIT 1').get() as Template | undefined;
}

function nameTaken(db: Db, name: string, exceptId?: number): boolean {
  return !!db.prepare('SELECT 1 FROM templates WHERE name = ? AND id != ?').get(name, exceptId ?? -1);
}

/** Un seul template par défaut : celui proposé pour les nouveaux messages. */
function applyDefault(db: Db, id: number, isDefault: boolean) {
  if (isDefault) {
    db.prepare('UPDATE templates SET is_default = (id = ?)').run(id);
  } else if (!db.prepare('SELECT 1 FROM templates WHERE is_default = 1 AND id != ?').get(id)) {
    // Il faut toujours un template par défaut : on garde celui-ci.
    db.prepare('UPDATE templates SET is_default = 1 WHERE id = ?').run(id);
  } else {
    db.prepare('UPDATE templates SET is_default = 0 WHERE id = ?').run(id);
  }
}

export function createTemplate(db: Db, input: TemplateInput): { id?: number; error?: string } {
  if (nameTaken(db, input.name)) return { error: 'Un template porte déjà ce nom.' };
  return db.transaction(() => {
    const id = Number(
      db
        .prepare(
          `INSERT INTO templates (name, theme, frame, show_logo, default_signature_name, default_signature_role)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.name, input.theme, input.frame, input.showLogo ? 1 : 0, input.signatureName, input.signatureRole)
        .lastInsertRowid,
    );
    applyDefault(db, id, input.isDefault);
    return { id };
  })();
}

export function updateTemplate(db: Db, id: number, input: TemplateInput): { error?: string } {
  if (nameTaken(db, input.name, id)) return { error: 'Un template porte déjà ce nom.' };
  db.transaction(() => {
    db.prepare(
      `UPDATE templates SET name = ?, theme = ?, frame = ?, show_logo = ?,
         default_signature_name = ?, default_signature_role = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(input.name, input.theme, input.frame, input.showLogo ? 1 : 0, input.signatureName, input.signatureRole, id);
    applyDefault(db, id, input.isDefault);
  })();
  return {};
}

/** Supprime un template. Refusé s'il est utilisé ou si c'est le dernier. */
export function deleteTemplate(db: Db, id: number): { error?: string } {
  const t = getTemplate(db, id);
  if (!t) return { error: 'Template introuvable.' };
  const used = (db.prepare('SELECT COUNT(*) AS n FROM messages WHERE template_id = ?').get(id) as { n: number }).n;
  if (used > 0) return { error: `Ce template est utilisé par ${used} message(s). Change leur template avant de le supprimer.` };
  if ((db.prepare('SELECT COUNT(*) AS n FROM templates').get() as { n: number }).n <= 1) {
    return { error: 'Il faut garder au moins un template.' };
  }
  db.transaction(() => {
    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
    if (t.is_default) db.prepare('UPDATE templates SET is_default = 1 WHERE id = (SELECT MIN(id) FROM templates)').run();
  })();
  return {};
}
