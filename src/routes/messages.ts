import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  createMessage,
  deleteMessage,
  getMessage,
  listMessages,
  moveMessage,
  setMessageActive,
  updateMessage,
  validateMessage,
  HEADING_MAX,
  SIGNATURE_MAX,
  TITLE_MAX,
  type Message,
  type MessageInput,
} from '../content/messages.js';
import { mediaExists } from '../content/media.js';
import { diff, logAudit, yesNo, type FieldSpec } from '../audit.js';
import { BRAND_COLORS, FONT_SIZES } from '../content/sanitize.js';
import { getDefaultTemplate, getTemplate, listTemplates } from '../content/templates.js';
import {
  ALL_DAYS,
  DAY_LABELS,
  DURATION_DEFAULT,
  DURATION_MAX,
  DURATION_MIN,
  STATUS_LABELS,
  describeSchedule,
  localNow,
  scheduleStatus,
} from '../content/schedule.js';

const LAYOUT = { layout: 'partials/layout.ejs' };
type IdParams = { Params: { id: string } };
type FormBody = Record<string, string | undefined>;
type FormMessage = Pick<
  Message,
  | 'title' | 'heading' | 'content_html' | 'signature_name' | 'signature_role' | 'template_id' | 'is_active'
  | 'duration_seconds' | 'starts_at' | 'ends_at' | 'days_mask' | 'daily_start' | 'daily_end' | 'images_json'
> & { id?: number };

const TIME = (v: unknown) => (v ? String(v).replace('T', ' ') : '(aucune)');
const DAYS = (v: unknown) => {
  const mask = Number(v);
  return mask === ALL_DAYS ? 'tous les jours' : DAY_LABELS.filter((_, i) => mask & (1 << i)).join(', ') || '(aucun)';
};

/** Champs suivis dans l'historique. Les deux côtés sont au format « ligne de messages ». */
function messageSpecs(templateName: (id: unknown) => string): FieldSpec<FormMessage>[] {
  return [
    { label: 'Titre affiché', get: (m) => m.heading },
    { label: 'Titre interne', get: (m) => m.title },
    { label: 'Texte', get: (m) => m.content_html, format: null },
    { label: 'Images', get: (m) => m.images_json, format: null },
    { label: 'Template', get: (m) => m.template_id, format: templateName },
    { label: 'Signature (nom)', get: (m) => m.signature_name },
    { label: 'Signature (fonction)', get: (m) => m.signature_role },
    { label: 'Diffusé', get: (m) => !!m.is_active, format: yesNo },
    { label: 'Durée', get: (m) => m.duration_seconds, format: (v) => `${v} s` },
    { label: 'Début', get: (m) => m.starts_at, format: TIME },
    { label: 'Fin', get: (m) => m.ends_at, format: TIME },
    { label: 'Jours', get: (m) => m.days_mask, format: DAYS },
    { label: 'Plage horaire', get: (m) => (m.daily_start ? `${m.daily_start}–${m.daily_end}` : ''), format: (v) => String(v || '(toute la journée)') },
  ];
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function fromInput(input: MessageInput, id?: number): FormMessage {
  return {
    id,
    title: input.title,
    heading: input.heading,
    content_html: input.contentHtml,
    signature_name: input.signatureName,
    signature_role: input.signatureRole,
    template_id: input.templateId,
    is_active: input.isActive ? 1 : 0,
    duration_seconds: input.durationSeconds,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    days_mask: input.daysMask,
    daily_start: input.dailyStart,
    daily_end: input.dailyEnd,
    images_json: JSON.stringify(input.images),
  };
}

/** Gestion des messages : liste, ajout, modification, suppression, ordre. */
export async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  const templateExists = (id: number) => !!getTemplate(app.db, id);
  const imageExists = (file: string) => mediaExists(app.db, file);
  const specs = messageSpecs((id) => (id ? getTemplate(app.db, Number(id))?.name ?? `#${id}` : '(aucun)'));

  const notFound = (reply: FastifyReply) =>
    reply.code(404).view('admin/not-found.ejs', { title: 'Introuvable', user: reply.request.user }, LAYOUT);

  const renderForm = (reply: FastifyReply, data: { message: FormMessage; errors: Record<string, string> }, code = 200) =>
    reply.code(code).view(
      'admin/messages/form.ejs',
      {
        title: data.message.id ? 'Modifier le message' : 'Nouveau message',
        user: reply.request.user,
        limits: { title: TITLE_MAX, heading: HEADING_MAX, signature: SIGNATURE_MAX },
        fontSizes: FONT_SIZES,
        brandColors: BRAND_COLORS,
        templates: listTemplates(app.db),
        dayLabels: DAY_LABELS,
        duration: { min: DURATION_MIN, max: DURATION_MAX },
        ...data,
      },
      LAYOUT,
    );

  app.get('/', async (req, reply) => {
    const now = localNow(new Date(), app.config.timezone);
    const messages = listMessages(app.db).map((m) => {
      const status = scheduleStatus(m, now);
      return { ...m, status, statusLabel: STATUS_LABELS[status], scheduleText: describeSchedule(m) };
    });
    return reply.view('admin/messages/index.ejs', { title: 'Messages', user: req.user, messages }, LAYOUT);
  });

  app.get('/new', async (_req, reply) =>
    renderForm(reply, {
      message: {
        title: '', heading: '', content_html: '', signature_name: '', signature_role: '',
        template_id: getDefaultTemplate(app.db)?.id ?? null, is_active: 1,
        duration_seconds: DURATION_DEFAULT, starts_at: null, ends_at: null,
        days_mask: ALL_DAYS, daily_start: null, daily_end: null, images_json: '[]',
      },
      errors: {},
    }),
  );

  app.post<{ Body: FormBody }>('/', async (req, reply) => {
    const { input, errors } = validateMessage(req.body ?? {}, templateExists, imageExists);
    if (Object.keys(errors).length) return renderForm(reply, { message: fromInput(input), errors }, 400);
    const newId = createMessage(app.db, input, req.user!.id);
    logAudit(app.db, req, { action: 'create', entity: 'message', entityId: newId, label: input.title });
    return reply.redirect('/admin/messages', 303);
  });

  app.get<IdParams>('/:id/edit', async (req, reply) => {
    const id = parseId(req.params.id);
    const message = id ? getMessage(app.db, id) : undefined;
    if (!message) return notFound(reply);
    return renderForm(reply, { message, errors: {} });
  });

  app.post<IdParams & { Body: FormBody }>('/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const before = id ? getMessage(app.db, id) : undefined;
    if (!id || !before) return notFound(reply);
    const { input, errors } = validateMessage(req.body ?? {}, templateExists, imageExists);
    if (Object.keys(errors).length) return renderForm(reply, { message: fromInput(input, id), errors }, 400);
    updateMessage(app.db, id, input, req.user!.id);
    const changes = diff<FormMessage>(before, fromInput(input, id), specs);
    if (changes.length) logAudit(app.db, req, { action: 'update', entity: 'message', entityId: id, label: input.title, details: changes });
    return reply.redirect('/admin/messages', 303);
  });

  app.post<IdParams & { Body: { active?: string } }>('/:id/toggle', async (req, reply) => {
    const id = parseId(req.params.id);
    const active = req.body?.active === '1';
    if (!id || !setMessageActive(app.db, id, active, req.user!.id)) return notFound(reply);
    logAudit(app.db, req, { action: active ? 'enable' : 'disable', entity: 'message', entityId: id, label: getMessage(app.db, id)?.title });
    return reply.redirect('/admin/messages', 303);
  });

  app.post<IdParams & { Body: { direction?: string } }>('/:id/move', async (req, reply) => {
    const id = parseId(req.params.id);
    if (!id) return notFound(reply);
    const direction = req.body?.direction === 'up' ? 'up' : 'down';
    moveMessage(app.db, id, direction);
    const moved = getMessage(app.db, id);
    if (moved) {
      logAudit(app.db, req, { action: 'move', entity: 'message', entityId: id, label: moved.title, details: [direction === 'up' ? 'Monté d’un cran' : 'Descendu d’un cran'] });
    }
    return reply.redirect('/admin/messages', 303);
  });

  app.post<IdParams>('/:id/delete', async (req, reply) => {
    const id = parseId(req.params.id);
    const gone = id ? getMessage(app.db, id) : undefined;
    if (!id || !gone || !deleteMessage(app.db, id)) return notFound(reply);
    logAudit(app.db, req, { action: 'delete', entity: 'message', entityId: id, label: gone.title });
    return reply.redirect('/admin/messages', 303);
  });
}
