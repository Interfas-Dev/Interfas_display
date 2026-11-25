import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  FRAMES,
  getTemplate,
  listTemplates,
  NAME_MAX,
  SIGNATURE_MAX,
  THEMES,
  updateTemplate,
  validateTemplate,
  type TemplateInput,
} from '../content/templates.js';

import { diff, logAudit, yesNo } from '../audit.js';
import { FONT_TYPES, FONT_MAX_BYTES, MediaError, isFont, mediaExists, saveMediaStream } from '../content/media.js';
import {
  BUILTIN_FONTS, FONT_NAME_MAX, LIMITS, THEME_COLORS, FRAME_PRESETS, effectiveStyle, fontChoices, listFonts, presetStyle,
  styleSpecs, validFontName, type TemplateStyle,
} from '../content/style.js';

type TemplateForm = { name: string; theme: string; frame: string; show_logo: number; is_default: number; default_signature_name: string; default_signature_role: string; style: TemplateStyle };
const THEME_LABEL = (v: unknown) => THEMES.find((t) => t.value === v)?.label.split(' (')[0] ?? String(v);
const FRAME_LABEL = (v: unknown) => FRAMES.find((f) => f.value === v)?.label ?? String(v);
const TEMPLATE_SPECS = [
  { label: 'Nom', get: (t: TemplateForm) => t.name },
  { label: 'Thème', get: (t: TemplateForm) => t.theme, format: THEME_LABEL },
  { label: 'Cadre', get: (t: TemplateForm) => t.frame, format: FRAME_LABEL },
  { label: 'Logo', get: (t: TemplateForm) => !!t.show_logo, format: yesNo },
  { label: 'Par défaut', get: (t: TemplateForm) => !!t.is_default, format: yesNo },
  { label: 'Signature par défaut (nom)', get: (t: TemplateForm) => t.default_signature_name },
  { label: 'Signature par défaut (fonction)', get: (t: TemplateForm) => t.default_signature_role },
];
const specsWithStyle = (db: Parameters<typeof styleSpecs>[0]) => [
  ...TEMPLATE_SPECS.filter((sp) => sp.label !== 'Cadre'),
  ...styleSpecs(db).map((sp) => ({ label: sp.label, get: (t: TemplateForm) => t.style[sp.key], format: sp.format })),
];

const LAYOUT = { layout: 'partials/layout.ejs' };
type IdParams = { Params: { id: string } };
type FormBody = Record<string, string | undefined>;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Exemple de message affiché dans l'aperçu d'un template. */
const SAMPLE = {
  heading: 'Titre du message',
  content_html: '<p>Texte du message avec une <strong>information importante</strong> :</p><ul><li><p>Premier point</p></li><li><p>Deuxième point</p></li></ul>',
  signature_name: 'Prénom NOM',
  signature_role: 'Fonction',
};

export async function templateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', app.requireAdmin);
  // Polices envoyées : corps brut en flux, écrit directement sur le disque.
  app.addContentTypeParser([...FONT_TYPES, 'application/octet-stream'], { bodyLimit: FONT_MAX_BYTES * 2 }, (_req, payload, done) => done(null, payload));

  const known = {
    media: (file: string) => !isFont(file) && mediaExists(app.db, file),
    font: (key: string) => !!app.db.prepare('SELECT 1 FROM fonts WHERE id = ?').get(Number(key.slice(7))),
  };

  const renderList = (reply: FastifyReply, error: string | null = null, code = 200) =>
    reply.code(code).view(
      'admin/templates/index.ejs',
      { title: 'Templates', user: reply.request.user, templates: listTemplates(app.db), fonts: listFonts(app.db), sample: SAMPLE, error },
      LAYOUT,
    );

  const renderForm = (
    reply: FastifyReply,
    data: {
      template: {
        id?: number; name: string; theme: string; frame: string; show_logo: number; is_default: number;
        default_signature_name: string; default_signature_role: string; style_json: string;
      };
      errors: Record<string, string>;
    },
    code = 200,
  ) =>
    reply.code(code).view(
      'admin/templates/form.ejs',
      {
        title: data.template.id ? 'Modifier le template' : 'Nouveau template',
        user: reply.request.user,
        themes: THEMES,
        frames: FRAMES,
        nameMax: NAME_MAX,
        signatureMax: SIGNATURE_MAX,
        sample: SAMPLE,
        style: effectiveStyle(data.template.style_json, data.template.theme, data.template.frame),
        fonts: fontChoices(app.db),
        builtinFontKeys: BUILTIN_FONTS.map((f) => f.key),
        fontNameMax: FONT_NAME_MAX,
        limits: LIMITS,
        presets: { themes: THEME_COLORS, frames: FRAME_PRESETS },
        ...data,
      },
      LAYOUT,
    );

  const toForm = (input: TemplateInput, id?: number) => ({
    id, name: input.name, theme: input.theme, frame: input.frame,
    show_logo: input.showLogo ? 1 : 0, is_default: input.isDefault ? 1 : 0,
    default_signature_name: input.signatureName, default_signature_role: input.signatureRole,
    style_json: JSON.stringify(input.style), style: input.style,
  });
  const formOf = (t: NonNullable<ReturnType<typeof getTemplate>>): TemplateForm => ({ ...t, style: effectiveStyle(t.style_json, t.theme, t.frame) });

  app.get('/', async (_req, reply) => renderList(reply));

  app.get('/new', async (_req, reply) =>
    renderForm(reply, {
      template: {
        name: '', theme: 'light', frame: 'greige', show_logo: 1, is_default: 0, default_signature_name: '', default_signature_role: '',
        style_json: JSON.stringify(presetStyle('light', 'greige')),
      },
      errors: {},
    }),
  );

  app.post<{ Body: FormBody }>('/', async (req, reply) => {
    const { input, errors } = validateTemplate(req.body ?? {}, known);
    if (!Object.keys(errors).length) {
      const res = createTemplate(app.db, input);
      if (!res.error) {
        logAudit(app.db, req, { action: 'create', entity: 'template', entityId: res.id, label: input.name });
        return reply.redirect('/admin/templates', 303);
      }
      errors.name = res.error;
    }
    return renderForm(reply, { template: toForm(input), errors }, 400);
  });

  app.get<IdParams>('/:id/edit', async (req, reply) => {
    const id = parseId(req.params.id);
    const template = id ? getTemplate(app.db, id) : undefined;
    if (!template) return reply.code(404).view('admin/not-found.ejs', { title: 'Introuvable', user: req.user }, LAYOUT);
    return renderForm(reply, { template, errors: {} });
  });

  app.post<IdParams & { Body: FormBody }>('/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const before = id ? getTemplate(app.db, id) : undefined;
    if (!id || !before) return reply.code(404).view('admin/not-found.ejs', { title: 'Introuvable', user: req.user }, LAYOUT);
    const { input, errors } = validateTemplate(req.body ?? {}, known);
    if (!Object.keys(errors).length) {
      const res = updateTemplate(app.db, id, input);
      if (!res.error) {
        const changes = diff<TemplateForm>(formOf(before), toForm(input, id), specsWithStyle(app.db));
        if (changes.length) logAudit(app.db, req, { action: 'update', entity: 'template', entityId: id, label: input.name, details: changes });
        return reply.redirect('/admin/templates', 303);
      }
      errors.name = res.error;
    }
    return renderForm(reply, { template: toForm(input, id), errors }, 400);
  });

  app.post<IdParams>('/:id/duplicate', async (req, reply) => {
    const id = parseId(req.params.id);
    const res = id ? duplicateTemplate(app.db, id) : { error: 'Template introuvable.' };
    if (res.error || !res.id) return renderList(reply, res.error ?? 'Copie impossible.', 400);
    logAudit(app.db, req, { action: 'create', entity: 'template', entityId: res.id, label: res.name });
    return reply.redirect(`/admin/templates/${res.id}/edit`, 303);
  });

  /** Ajout d'une police (WOFF2, WOFF, TTF, OTF ; 2 Mo). Réponse : { key, label, family, url }. */
  app.post<{ Querystring: { name?: string } }>('/fonts', { bodyLimit: FONT_MAX_BYTES * 2 }, async (req, reply) => {
    const name = validFontName(req.query.name);
    if (!name) {
      (req.body as NodeJS.ReadableStream & { resume?: () => void })?.resume?.();
      return reply.code(400).send({ error: `Nom de police invalide : lettres, chiffres, espaces et tirets, ${FONT_NAME_MAX} caractères maximum.` });
    }
    try {
      const { file } = await saveMediaStream(app.db, app.config.mediaDir, req.body as never, 'font/woff2', req.user!.id);
      const id = Number(app.db.prepare('INSERT INTO fonts (name, file) VALUES (?, ?)').run(name, file).lastInsertRowid);
      logAudit(app.db, req, { action: 'create', entity: 'font', entityId: id, label: name });
      return reply.code(201).send({ key: `custom-${id}`, label: `${name} (envoyée)`, family: `tpl-font-${id}`, url: `/media/${file}` });
    } catch (err) {
      if (err instanceof MediaError) return reply.code(err.status).send({ error: err.message });
      throw err;
    }
  });

  app.post<IdParams>('/fonts/:id/delete', async (req, reply) => {
    const id = parseId(req.params.id);
    const font = id ? listFonts(app.db).find((f) => f.id === id) : undefined;
    if (!font) return renderList(reply, 'Police introuvable.', 404);
    if (font.usage_count) return renderList(reply, `La police « ${font.name} » est utilisée par ${font.usage_count} template(s). Change leur police avant de la supprimer.`, 400);
    // Le fichier est retiré par la purge des médias orphelins.
    app.db.prepare('DELETE FROM fonts WHERE id = ?').run(id);
    logAudit(app.db, req, { action: 'delete', entity: 'font', entityId: id, label: font.name });
    return reply.redirect('/admin/templates', 303);
  });

  app.post<IdParams>('/:id/delete', async (req, reply) => {
    const id = parseId(req.params.id);
    const gone = id ? getTemplate(app.db, id) : undefined;
    const res = id ? deleteTemplate(app.db, id) : { error: 'Template introuvable.' };
    if (res.error) return renderList(reply, res.error, 400);
    logAudit(app.db, req, { action: 'delete', entity: 'template', entityId: id, label: gone?.name });
    return reply.redirect('/admin/templates', 303);
  });
}
