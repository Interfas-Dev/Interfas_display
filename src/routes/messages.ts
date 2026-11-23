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
  TITLE_MAX,
} from '../content/messages.js';
import { BRAND_COLORS, FONT_SIZES } from '../content/sanitize.js';

const LAYOUT = { layout: 'partials/layout.ejs' };
type IdParams = { Params: { id: string } };
type FormBody = { title?: string; content?: string; is_active?: string };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Gestion des messages : liste, ajout, modification, suppression, ordre. */
export async function messageRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  const notFound = (reply: FastifyReply) =>
    reply.code(404).view('admin/not-found.ejs', { title: 'Introuvable', user: reply.request.user }, LAYOUT);

  const renderForm = (
    reply: FastifyReply,
    data: { message: { id?: number; title: string; content_html: string; is_active: number }; errors: Record<string, string> },
    code = 200,
  ) =>
    reply.code(code).view(
      'admin/messages/form.ejs',
      {
        title: data.message.id ? 'Modifier le message' : 'Nouveau message',
        user: reply.request.user,
        titleMax: TITLE_MAX,
        fontSizes: FONT_SIZES,
        brandColors: BRAND_COLORS,
        ...data,
      },
      LAYOUT,
    );

  app.get('/', async (req, reply) =>
    reply.view('admin/messages/index.ejs', { title: 'Messages', user: req.user, messages: listMessages(app.db) }, LAYOUT),
  );

  app.get('/new', async (_req, reply) =>
    renderForm(reply, { message: { title: '', content_html: '', is_active: 1 }, errors: {} }),
  );

  app.post<{ Body: FormBody }>('/', async (req, reply) => {
    const { input, errors } = validateMessage(req.body ?? {});
    if (Object.keys(errors).length) {
      return renderForm(reply, { message: { title: input.title, content_html: input.contentHtml, is_active: input.isActive ? 1 : 0 }, errors }, 400);
    }
    createMessage(app.db, input, req.user!.id);
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
    if (!id || !getMessage(app.db, id)) return notFound(reply);
    const { input, errors } = validateMessage(req.body ?? {});
    if (Object.keys(errors).length) {
      return renderForm(reply, { message: { id, title: input.title, content_html: input.contentHtml, is_active: input.isActive ? 1 : 0 }, errors }, 400);
    }
    updateMessage(app.db, id, input, req.user!.id);
    return reply.redirect('/admin/messages', 303);
  });

  app.post<IdParams & { Body: { active?: string } }>('/:id/toggle', async (req, reply) => {
    const id = parseId(req.params.id);
    if (!id || !setMessageActive(app.db, id, req.body?.active === '1', req.user!.id)) return notFound(reply);
    return reply.redirect('/admin/messages', 303);
  });

  app.post<IdParams & { Body: { direction?: string } }>('/:id/move', async (req, reply) => {
    const id = parseId(req.params.id);
    if (!id) return notFound(reply);
    moveMessage(app.db, id, req.body?.direction === 'up' ? 'up' : 'down');
    return reply.redirect('/admin/messages', 303);
  });

  app.post<IdParams>('/:id/delete', async (req, reply) => {
    const id = parseId(req.params.id);
    if (!id || !deleteMessage(app.db, id)) return notFound(reply);
    return reply.redirect('/admin/messages', 303);
  });
}
