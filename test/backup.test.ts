import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loginAs, makeApp, PASSWORD, form, sessionCookie } from './helpers/app.js';
import { isoWeek, listBackups, rotateBackups, runBackup, selectToKeep } from '../src/backup.js';
import { createUser } from '../src/auth/users.js';

let app: FastifyInstance;
let admin: string;

beforeAll(async () => {
  app = await makeApp();
  admin = await loginAs(app);
  fs.mkdirSync(app.config.mediaDir, { recursive: true });
  fs.writeFileSync(path.join(app.config.mediaDir, 'photo.png'), 'img');
});
afterAll(async () => app.close());

describe('sauvegarde', () => {
  it('copie la base et les images dans un dossier daté', async () => {
    const info = await runBackup(app.db, {
      backupDir: app.config.backupDir, mediaDir: app.config.mediaDir, timezone: 'Europe/Paris', kind: 'auto',
      now: new Date('2020-01-06T02:00:00Z'), // jour passé : la sauvegarde manuelle du jour ne la remplace pas
    });
    expect(info).toMatchObject({ name: '2020-01-06_03-00-00', kind: 'auto', images: 1 });
    const copy = new Database(path.join(app.config.backupDir, info.name, 'interfas.db'), { readonly: true });
    expect((copy.prepare('SELECT username FROM users').get() as { username: string }).username).toBe('matthias');
    copy.close();
    expect(fs.readFileSync(path.join(app.config.backupDir, info.name, 'media', 'photo.png'), 'utf8')).toBe('img');
  });

  it('« Sauvegarder maintenant » crée une sauvegarde manuelle et la trace', async () => {
    const res = await app.inject({ method: 'POST', url: '/admin/backups', headers: { cookie: admin, 'content-type': 'application/x-www-form-urlencoded' }, payload: '' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('créée');
    const list = await listBackups(app.config.backupDir);
    expect(list.some((b) => b.kind === 'manual')).toBe(true);
    const page = await app.inject({ method: 'GET', url: '/admin/backups', headers: { cookie: admin } });
    expect(page.body).toContain('Manuelle');
    expect(page.body).toContain('Automatique');
    const audit = app.db.prepare("SELECT action FROM audit_log WHERE entity = 'backup'").get();
    expect(audit).toEqual({ action: 'run' });
  });

  it('réservé aux administrateurs', async () => {
    await createUser(app.db, { username: 'paul', password: PASSWORD, role: 'editor' });
    const paul = sessionCookie(await app.inject({ method: 'POST', url: '/admin/login', ...form({ username: 'paul', password: PASSWORD }) }));
    expect((await app.inject({ method: 'GET', url: '/admin/backups', headers: { cookie: paul } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/admin/backups', headers: { cookie: paul } })).statusCode).toBe(403);
  });
});

describe('rotation', () => {
  it('calcule les semaines ISO', () => {
    expect(isoWeek('2026-11-23')).toBe('2026-W48');
    expect(isoWeek('2026-11-29')).toBe('2026-W48');
    expect(isoWeek('2024-12-30')).toBe('2025-W01');
  });

  it('garde 7 jours puis une par semaine sur 4 semaines', () => {
    // Une sauvegarde par jour sur 60 jours, plus une manuelle le dernier jour
    const days: { name: string; day: string }[] = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date(Date.UTC(2026, 10, 23) - i * 86400000).toISOString().slice(0, 10);
      days.push({ name: `${d}_03-00-00`, day: d });
    }
    days.push({ name: '2026-11-23_14-00-00', day: '2026-11-23' });
    const keep = [...selectToKeep(days)].sort().reverse();
    expect(keep).toEqual([
      '2026-11-23_14-00-00', // le plus récent du jour (et de la semaine 48)
      '2026-11-22_03-00-00', '2026-11-21_03-00-00', '2026-11-20_03-00-00',
      '2026-11-19_03-00-00', '2026-11-18_03-00-00', '2026-11-17_03-00-00',
      '2026-11-15_03-00-00', // dimanche, semaine 46
      '2026-11-08_03-00-00', // semaine 45
    ]);
  });

  it('supprime les dossiers en trop et les restes de sauvegarde interrompue', async () => {
    const dir = fs.mkdtempSync(path.join(path.dirname(app.config.backupDir), 'rot-'));
    for (let i = 0; i < 20; i++) {
      const d = new Date(Date.UTC(2026, 10, 23) - i * 86400000).toISOString().slice(0, 10);
      fs.mkdirSync(path.join(dir, `${d}_03-00-00`));
    }
    fs.mkdirSync(path.join(dir, '.en-cours-2026-11-23_03-00-00'));
    fs.mkdirSync(path.join(dir, 'autre-dossier'));
    const removed = await rotateBackups(dir);
    expect(removed.length).toBe(20 - 9);
    const left = fs.readdirSync(dir);
    expect(left).toContain('autre-dossier'); // on ne touche qu'à nos sauvegardes
    expect(left.some((n) => n.startsWith('.en-cours-'))).toBe(false);
  });
});

describe('sauvegardes sans doublons', () => {
  it('relie les médias inchangés à la sauvegarde précédente', async () => {
    const base = fs.mkdtempSync(path.join(path.dirname(app.config.backupDir), 'dedup-'));
    const media = path.join(base, 'media');
    const backups = path.join(base, 'backups');
    fs.mkdirSync(media);
    fs.writeFileSync(path.join(media, 'video.mp4'), Buffer.alloc(200_000, 1));
    const opts = { backupDir: backups, mediaDir: media, timezone: 'Europe/Paris', kind: 'auto' as const };
    const a = await runBackup(app.db, { ...opts, now: new Date('2026-11-20T02:00:00Z') });
    fs.writeFileSync(path.join(media, 'photo.png'), 'nouvelle');
    const b = await runBackup(app.db, { ...opts, now: new Date('2026-11-21T02:00:00Z') });

    const inode = (n: string) => fs.statSync(path.join(backups, n, 'media', 'video.mp4')).ino;
    expect(inode(b.name)).toBe(inode(a.name));
    expect(fs.readFileSync(path.join(backups, b.name, 'media', 'photo.png'), 'utf8')).toBe('nouvelle');

    const list = await listBackups(backups);
    const newer = list.find((x) => x.name === b.name)!;
    const older = list.find((x) => x.name === a.name)!;
    expect(older.bytes).toBeGreaterThan(200_000);
    expect(newer.bytes).toBeLessThan(200_000); // la vidéo n'est comptée qu'une fois
    expect(newer.images).toBe(2);
  });

  it('affiche l’espace disque', async () => {
    const page = await app.inject({ method: 'GET', url: '/admin/backups', headers: { cookie: admin } });
    expect(page.body).toContain('Disque du serveur');
  });
});
