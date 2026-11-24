import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { getDummyHash, verifyPassword } from '../auth/password.js';
import { createSession, deleteSession } from '../auth/sessions.js';
import { findUserByUsername, touchLastLogin } from '../auth/users.js';
import { logAudit } from '../audit.js';
import { SESSION_COOKIE, sessionCookieOptions } from '../auth/plugin.js';

const LAYOUT = { layout: 'partials/auth-layout.ejs' };

/** N'accepte que des redirections internes à l'admin. */
function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/admin') && !next.startsWith('//') ? next : '/admin';
}

export async function authRoutes(app: FastifyInstance) {
  await app.register(rateLimit, { global: false });

  app.get<{ Querystring: { next?: string } }>('/login', async (req, reply) => {
    if (req.user) return reply.redirect(safeNext(req.query.next));
    return reply.view('admin/login.ejs', { title: 'Connexion', error: null, username: '', next: safeNext(req.query.next) }, LAYOUT);
  });

  app.post<{ Body: { username?: string; password?: string; next?: string } }>(
    '/login',
    {
      // 10 tentatives par minute et par adresse IP.
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const username = String(req.body?.username ?? '').trim();
      const password = String(req.body?.password ?? '');
      const next = safeNext(req.body?.next);

      const user = username ? findUserByUsername(app.db, username) : undefined;
      const ok = await verifyPassword(user?.password_hash ?? (await getDummyHash()), password);

      // Compte désactivé : même réponse qu'un mauvais mot de passe.
      if (!user || !ok || !user.is_active) {
        req.log.warn({ username }, 'échec de connexion');
        logAudit(app.db, req, {
          action: 'login_failed', entity: 'session', user: user ? { id: user.id, display_name: user.display_name } : null,
          username: user?.display_name ?? '', label: username.slice(0, 64),
          details: user && ok && !user.is_active ? ['Compte désactivé'] : [],
        });
        return reply
          .code(401)
          .view('admin/login.ejs', { title: 'Connexion', error: 'Identifiant ou mot de passe incorrect.', username, next }, LAYOUT);
      }

      if (req.sessionId) deleteSession(app.db, req.sessionId);
      const sessionId = createSession(app.db, user.id);
      touchLastLogin(app.db, user.id);
      logAudit(app.db, req, { action: 'login', entity: 'session', user, label: user.username });
      reply.setCookie(SESSION_COOKIE, sessionId, sessionCookieOptions(app.config.cookieSecure));
      return reply.redirect(next, 303);
    },
  );

  app.post('/logout', async (req, reply) => {
    if (req.sessionId) deleteSession(app.db, req.sessionId);
    if (req.user) logAudit(app.db, req, { action: 'logout', entity: 'session', label: req.user.username });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/admin/login', 303);
  });
}
