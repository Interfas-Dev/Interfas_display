import type { FastifyInstance } from 'fastify';
import { verifyPassword } from '../auth/password.js';
import { deleteOtherSessions } from '../auth/sessions.js';
import { getPasswordHash, setPassword, validatePassword } from '../auth/users.js';

const LAYOUT = { layout: 'partials/layout.ejs' };

/** Page « Mon compte » : changement de mot de passe. */
export async function accountRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/account', async (req, reply) =>
    reply.view('admin/account.ejs', { title: 'Mon compte', user: req.user, error: null, success: null }, LAYOUT),
  );

  app.post<{ Body: { current?: string; password?: string; confirm?: string } }>('/account/password', async (req, reply) => {
    const user = req.user!;
    const current = String(req.body?.current ?? '');
    const password = String(req.body?.password ?? '');
    const confirm = String(req.body?.confirm ?? '');

    let error: string | null = null;
    if (!(await verifyPassword(getPasswordHash(app.db, user.id) ?? '', current))) {
      error = 'Le mot de passe actuel est incorrect.';
    } else if (password !== confirm) {
      error = 'Les deux nouveaux mots de passe ne correspondent pas.';
    } else {
      error = validatePassword(password);
    }

    if (error) {
      return reply.code(400).view('admin/account.ejs', { title: 'Mon compte', user, error, success: null }, LAYOUT);
    }

    await setPassword(app.db, user.id, password);
    // Déconnecte les autres appareils, garde la session en cours.
    deleteOtherSessions(app.db, user.id, req.sessionId!);
    return reply.view(
      'admin/account.ejs',
      { title: 'Mon compte', user, error: null, success: 'Mot de passe modifié.' },
      LAYOUT,
    );
  });
}
