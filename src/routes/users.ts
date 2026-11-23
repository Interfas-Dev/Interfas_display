import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { deleteUserSessions } from '../auth/sessions.js';
import {
  countActiveAdmins,
  createUser,
  deleteUser,
  DISPLAY_NAME_MAX,
  getUserById,
  isRole,
  listUsers,
  ROLE_LABELS,
  ROLES,
  setPassword,
  updateUser,
  validatePassword,
  validateUsername,
  findUserByUsername,
  type Role,
  type User,
} from '../auth/users.js';

import { diff, logAudit, yesNo } from '../audit.js';

const LAYOUT = { layout: 'partials/layout.ejs' };
type IdParams = { Params: { id: string } };
type FormBody = Record<string, string | undefined>;
type FormUser = { id?: number; username: string; display_name: string; role: Role; is_active: number };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Règles de sécurité : on ne peut pas se rétrograder, se désactiver ni se
 * supprimer soi-même, et il reste toujours au moins un administrateur actif.
 */
function guard(db: FastifyInstance['db'], me: User, target: User, next: { role: Role; active: boolean } | 'delete'): string | null {
  const removesAdmin =
    target.role === 'admin' && target.is_active === 1 && (next === 'delete' || next.role !== 'admin' || !next.active);
  if (target.id === me.id) {
    if (next === 'delete') return 'Tu ne peux pas supprimer ton propre compte.';
    if (!next.active) return 'Tu ne peux pas désactiver ton propre compte.';
    if (next.role !== target.role) return 'Tu ne peux pas changer ton propre rôle.';
  }
  if (removesAdmin && countActiveAdmins(db) <= 1) return 'Il doit rester au moins un administrateur actif.';
  return null;
}

/** Gestion des utilisateurs (administrateurs uniquement). */
export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', app.requireAdmin);

  const roles = ROLES.map((value) => ({ value, label: ROLE_LABELS[value] }));

  const renderList = (reply: FastifyReply, flash: { error?: string; success?: string } = {}, code = 200) =>
    reply.code(code).view(
      'admin/users/index.ejs',
      { title: 'Utilisateurs', user: reply.request.user, users: listUsers(app.db), roleLabels: ROLE_LABELS, ...flash },
      LAYOUT,
    );

  const renderForm = (
    reply: FastifyReply,
    data: { account: FormUser; errors: Record<string, string>; success?: string },
    code = 200,
  ) =>
    reply.code(code).view(
      'admin/users/form.ejs',
      {
        title: data.account.id ? `Modifier ${data.account.display_name}` : 'Nouvel utilisateur',
        user: reply.request.user,
        roles,
        displayNameMax: DISPLAY_NAME_MAX,
        isSelf: data.account.id === reply.request.user!.id,
        success: null,
        ...data,
      },
      LAYOUT,
    );

  const notFound = (reply: FastifyReply) =>
    reply.code(404).view('admin/not-found.ejs', { title: 'Introuvable', user: reply.request.user }, LAYOUT);

  const target = (req: FastifyRequest<IdParams>) => {
    const id = parseId(req.params.id);
    return id ? getUserById(app.db, id) : undefined;
  };

  app.get('/', async (_req, reply) => renderList(reply));

  app.get('/new', async (_req, reply) =>
    renderForm(reply, { account: { username: '', display_name: '', role: 'editor', is_active: 1 }, errors: {} }),
  );

  app.post<{ Body: FormBody }>('/', async (req, reply) => {
    const body = req.body ?? {};
    const account: FormUser = {
      username: String(body.username ?? '').trim(),
      display_name: String(body.display_name ?? '').trim(),
      role: isRole(body.role) ? body.role : 'editor',
      is_active: 1,
    };
    const password = String(body.password ?? '');
    const errors: Record<string, string> = {};
    const usernameError = validateUsername(account.username);
    if (usernameError) errors.username = usernameError;
    else if (findUserByUsername(app.db, account.username)) errors.username = 'Cet identifiant est déjà pris.';
    if (account.display_name.length > DISPLAY_NAME_MAX) errors.display_name = `${DISPLAY_NAME_MAX} caractères au maximum.`;
    const passwordError = validatePassword(password);
    if (passwordError) errors.password = passwordError;
    if (Object.keys(errors).length) return renderForm(reply, { account, errors }, 400);

    const created = await createUser(app.db, {
      username: account.username,
      displayName: account.display_name,
      password,
      role: account.role,
      mustChangePassword: true,
    });
    logAudit(app.db, req, {
      action: 'create', entity: 'user', entityId: created.id, label: `${created.display_name} (${created.username})`,
      details: [`Rôle : ${ROLE_LABELS[created.role]}`],
    });
    return reply.redirect('/admin/users', 303);
  });

  app.get<IdParams>('/:id/edit', async (req, reply) => {
    const account = target(req);
    if (!account) return notFound(reply);
    return renderForm(reply, { account, errors: {} });
  });

  app.post<IdParams & { Body: FormBody }>('/:id', async (req, reply) => {
    const current = target(req);
    if (!current) return notFound(reply);
    const body = req.body ?? {};
    const next = {
      displayName: String(body.display_name ?? '').trim() || current.username,
      role: isRole(body.role) ? body.role : current.role,
      isActive: body.is_active === 'on',
    };
    const account: FormUser = { ...current, display_name: next.displayName, role: next.role, is_active: next.isActive ? 1 : 0 };
    const errors: Record<string, string> = {};
    if (next.displayName.length > DISPLAY_NAME_MAX) errors.display_name = `${DISPLAY_NAME_MAX} caractères au maximum.`;
    const refused = guard(app.db, req.user!, current, { role: next.role, active: next.isActive });
    if (refused) errors.account = refused;
    if (Object.keys(errors).length) return renderForm(reply, { account, errors }, 400);

    updateUser(app.db, current.id, next);
    const changes = diff(
      { name: current.display_name, role: current.role, active: !!current.is_active },
      { name: next.displayName, role: next.role, active: next.isActive },
      [
        { label: 'Nom affiché', get: (u) => u.name },
        { label: 'Rôle', get: (u) => u.role, format: (v) => ROLE_LABELS[v as Role] },
        { label: 'Actif', get: (u) => u.active, format: yesNo },
      ],
    );
    if (changes.length) {
      logAudit(app.db, req, { action: 'update', entity: 'user', entityId: current.id, label: `${next.displayName} (${current.username})`, details: changes });
    }
    return reply.redirect('/admin/users', 303);
  });

  app.post<IdParams & { Body: FormBody }>('/:id/password', async (req, reply) => {
    const current = target(req);
    if (!current) return notFound(reply);
    if (current.id === req.user!.id) {
      return renderForm(reply, { account: current, errors: { password: 'Change ton propre mot de passe depuis « Mon compte ».' } }, 400);
    }
    const password = String(req.body?.password ?? '');
    const error = validatePassword(password);
    if (error) return renderForm(reply, { account: current, errors: { password: error } }, 400);
    await setPassword(app.db, current.id, password, true);
    deleteUserSessions(app.db, current.id);
    logAudit(app.db, req, { action: 'password_reset', entity: 'user', entityId: current.id, label: `${current.display_name} (${current.username})` });
    return renderForm(reply, {
      account: current,
      errors: {},
      success: `Mot de passe provisoire enregistré. ${current.display_name} devra le changer à sa prochaine connexion.`,
    });
  });

  app.post<IdParams>('/:id/delete', async (req, reply) => {
    const current = target(req);
    if (!current) return notFound(reply);
    const refused = guard(app.db, req.user!, current, 'delete');
    if (refused) return renderList(reply, { error: refused }, 400);
    deleteUser(app.db, current.id);
    logAudit(app.db, req, { action: 'delete', entity: 'user', entityId: current.id, label: `${current.display_name} (${current.username})` });
    return renderList(reply, { success: `Le compte « ${current.username} » a été supprimé.` });
  });
}
