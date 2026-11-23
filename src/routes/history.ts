import type { FastifyInstance } from 'fastify';
import { ACTION_LABELS, ENTITIES, listAudit, purgeAudit, type Entity } from '../audit.js';
import { listUsers } from '../auth/users.js';

const LAYOUT = { layout: 'partials/layout.ejs' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Paramètres › Historique : qui a modifié quoi (administrateurs uniquement). */
export async function historyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.requireAuth);
  app.addHook('preHandler', app.requireAdmin);

  const timer = setInterval(() => purgeAudit(app.db), DAY_MS);
  timer.unref();
  app.addHook('onReady', async () => void purgeAudit(app.db));
  app.addHook('onClose', async () => clearInterval(timer));

  app.get<{ Querystring: { user?: string; entity?: string; page?: string } }>('/', async (req, reply) => {
    const userId = Number(req.query.user) || undefined;
    const entity = req.query.entity && req.query.entity in ENTITIES ? (req.query.entity as Entity) : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const { entries, hasMore } = listAudit(app.db, { userId, entity, page });

    const query = (p: number) => {
      const q = new URLSearchParams();
      if (userId) q.set('user', String(userId));
      if (entity) q.set('entity', entity);
      if (p > 1) q.set('page', String(p));
      const s = q.toString();
      return s ? `?${s}` : '';
    };

    return reply.view(
      'admin/history/index.ejs',
      {
        title: 'Historique',
        user: req.user,
        entries: entries.map((e) => ({
          ...e,
          details: JSON.parse(e.details) as string[],
          actionLabel: ACTION_LABELS[e.action] ?? e.action,
          entityLabel: ENTITIES[e.entity] ?? e.entity,
          when: new Date(e.at.replace(' ', 'T') + 'Z').toLocaleString('fr-FR', {
            timeZone: app.config.timezone, dateStyle: 'short', timeStyle: 'medium',
          }),
        })),
        users: listUsers(app.db),
        entities: Object.entries(ENTITIES),
        filter: { userId, entity },
        page,
        prevUrl: page > 1 ? query(page - 1) || '?' : null,
        nextUrl: hasMore ? query(page + 1) : null,
      },
      LAYOUT,
    );
  });
}
