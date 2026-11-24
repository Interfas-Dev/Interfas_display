import type { FastifyInstance } from 'fastify';
import { diskSpace, listBackups, rotateBackups, runBackup, KEEP_DAILY, KEEP_WEEKLY, type BackupInfo } from '../backup.js';
import { localNow } from '../content/schedule.js';
import { logAudit } from '../audit.js';

const LAYOUT = { layout: 'partials/layout.ejs' };
const CHECK_MS = 30 * 1000;

/** Paramètres › Sauvegardes, et sauvegarde quotidienne automatique. */
export async function backupRoutes(app: FastifyInstance) {
  const cfg = app.config;
  let running: Promise<BackupInfo> | null = null;
  let lastError: { at: string; message: string } | null = null;
  let lastAutoDay = '';

  async function backup(kind: 'auto' | 'manual'): Promise<BackupInfo> {
    if (running) return running; // une seule sauvegarde à la fois
    running = (async () => {
      try {
        const info = await runBackup(app.db, { backupDir: cfg.backupDir, mediaDir: cfg.mediaDir, timezone: cfg.timezone, kind });
        const removed = await rotateBackups(cfg.backupDir);
        app.log.info({ backup: info.name, removed }, 'sauvegarde terminée');
        lastError = null;
        return info;
      } catch (err) {
        lastError = { at: new Date().toISOString(), message: (err as Error).message };
        app.log.error({ err }, 'sauvegarde impossible');
        throw err;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  // Sauvegarde quotidienne à l'heure prévue (heure de l'atelier).
  if (cfg.backupTime) {
    const timer = setInterval(() => {
      const now = localNow(new Date(), cfg.timezone);
      const day = now.datetime.slice(0, 10);
      if (now.time === cfg.backupTime && lastAutoDay !== day) {
        lastAutoDay = day;
        backup('auto').catch(() => {});
      }
    }, CHECK_MS);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  app.register(async (admin) => {
    admin.addHook('preHandler', admin.requireAuth);
    admin.addHook('preHandler', admin.requireAdmin);

    const render = async (reply: import('fastify').FastifyReply, flash: { success?: string; error?: string } = {}, code = 200) =>
      reply.code(code).view(
        'admin/backups/index.ejs',
        {
          title: 'Sauvegardes',
          user: reply.request.user,
          backups: await listBackups(cfg.backupDir),
          disk: await diskSpace(cfg.backupDir),
          backupDir: cfg.backupDir,
          backupTime: cfg.backupTime,
          keep: { daily: KEEP_DAILY, weekly: KEEP_WEEKLY },
          lastError,
          ...flash,
        },
        LAYOUT,
      );

    admin.get('/', async (_req, reply) => render(reply));

    admin.post('/', async (req, reply) => {
      try {
        const info = await backup('manual');
        logAudit(app.db, req, { action: 'run', entity: 'backup', label: info.name });
        return render(reply, { success: `Sauvegarde « ${info.name} » créée.` });
      } catch (err) {
        return render(reply, { error: `La sauvegarde a échoué : ${(err as Error).message}` }, 500);
      }
    });
  }, { prefix: '/admin/backups' });
}
