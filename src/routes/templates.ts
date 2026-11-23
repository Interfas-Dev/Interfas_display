import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  createTemplate,
  deleteTemplate,
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

  const renderList = (reply: FastifyReply, error: string | null = null, code = 200) =>
    reply.code(code).view(
      'admin/templates/index.ejs',
      { title: 'Templates', user: reply.request.user, templates: listTemplates(app.db), sample: SAMPLE, error },
      LAYOUT,
    );

  const renderForm = (
    reply: FastifyReply,
    data: {
      template: {
        id?: number; name: string; theme: string; frame: string; show_logo: number; is_default: number;
        default_signature_name: string; default_signature_role: string;
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
        ...data,
      },
      LAYOUT,
    );

  const toForm = (input: TemplateInput, id?: number) => ({
    id, name: input.name, theme: input.theme, frame: input.frame,
    show_logo: input.showLogo ? 1 : 0, is_default: input.isDefault ? 1 : 0,
    default_signature_name: input.signatureName, default_signature_role: input.signatureRole,
  });

  app.get('/', async (_req, reply) => renderList(reply));

  app.get('/new', async (_req, reply) =>
    renderForm(reply, {
      template: { name: '', theme: 'light', frame: 'greige', show_logo: 1, is_default: 0, default_signature_name: '', default_signature_role: '' },
      errors: {},
    }),
  );

  app.post<{ Body: FormBody }>('/', async (req, reply) => {
    const { input, errors } = validateTemplate(req.body ?? {});
    if (!Object.keys(errors).length) {
      const res = createTemplate(app.db, input);
      if (!res.error) return reply.redirect('/admin/templates', 303);
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
    if (!id || !getTemplate(app.db, id)) return reply.code(404).view('admin/not-found.ejs', { title: 'Introuvable', user: req.user }, LAYOUT);
    const { input, errors } = validateTemplate(req.body ?? {});
    if (!Object.keys(errors).length) {
      const res = updateTemplate(app.db, id, input);
      if (!res.error) return reply.redirect('/admin/templates', 303);
      errors.name = res.error;
    }
    return renderForm(reply, { template: toForm(input, id), errors }, 400);
  });

  app.post<IdParams>('/:id/delete', async (req, reply) => {
    const id = parseId(req.params.id);
    const res = id ? deleteTemplate(app.db, id) : { error: 'Template introuvable.' };
    if (res.error) return renderList(reply, res.error, 400);
    return reply.redirect('/admin/templates', 303);
  });
}
