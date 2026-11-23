import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getSessionUser, purgeExpiredSessions, SESSION_TTL_MS } from './sessions.js';
import type { User } from './users.js';

export const SESSION_COOKIE = 'interfas_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    sessionId: string | null;
  }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Lit le cookie de session sur chaque requête et expose `req.user`.
 * Fournit `app.requireAuth` à utiliser en preHandler sur les routes protégées.
 */
async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    const user = getSessionUser(app.db, unsigned.value);
    if (user) {
      req.user = user;
      req.sessionId = unsigned.value;
    }
  });

  // Protection CSRF : les cookies sont SameSite=Strict, et on refuse en plus
  // toute requête qui modifie des données en provenance d'un autre site.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (!isSameOrigin(req)) return reply.code(403).send('Origine refusée');
  });

  app.decorate('requireAuth', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) {
      const next = encodeURIComponent(req.url);
      return reply.redirect(`/admin/login?next=${next}`);
    }
  });

  purgeExpiredSessions(app.db);
  const timer = setInterval(() => purgeExpiredSessions(app.db), 60 * 60 * 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

/**
 * Les navigateurs récents envoient Sec-Fetch-Site, qui suffit. Sinon on compare
 * l'en-tête Origin à Host. Sans aucun des deux (outil en ligne de commande), on accepte :
 * l'attaque CSRF passe forcément par un navigateur.
 */
function isSameOrigin(req: FastifyRequest): boolean {
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false; // Origine illisible, par exemple « null »
  }
}

export function sessionCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'strict' as const,
    // Réseau local en HTTP : pas de flag Secure. À activer si un HTTPS est mis en place.
    secure: false,
    signed: true,
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  };
}

export default fp(authPlugin, { name: 'auth' });
