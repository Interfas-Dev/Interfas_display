import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    app.db.prepare('SELECT 1').get();
    return { status: 'ok' };
  });
}
