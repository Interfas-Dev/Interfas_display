import fs from 'node:fs/promises';
import path from 'node:path';
import type { Db } from './db/index.js';

/** Rotation : les 7 derniers jours, puis une sauvegarde par semaine sur 4 semaines. */
export const KEEP_DAILY = 7;
export const KEEP_WEEKLY = 4;

/** Dossier d'une sauvegarde : AAAA-MM-JJ_HH-MM-SS (heure de l'atelier). */
const NAME_RE = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})$/;

export interface BackupInfo {
  name: string;
  /** Date locale lisible : AAAA-MM-JJ HH:MM:SS */
  date: string;
  day: string;
  kind: 'auto' | 'manual';
  bytes: number;
  images: number;
}

function stamp(date: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}_${p.hour}-${p.minute}-${p.second}`;
}

async function exists(p: string): Promise<boolean> {
  return fs.access(p).then(() => true, () => false);
}

async function dirSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0;
  let files = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await dirSize(full);
      bytes += sub.bytes;
      files += sub.files;
    } else if (entry.isFile()) {
      bytes += (await fs.stat(full)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

/**
 * Sauvegarde cohérente à chaud : copie SQLite via l'API de sauvegarde
 * (sans arrêter l'app), puis copie des images. Écrit d'abord dans un dossier
 * temporaire renommé à la fin : une sauvegarde visible est toujours complète.
 */
export async function runBackup(
  db: Db,
  opts: { backupDir: string; mediaDir: string; timezone: string; kind: 'auto' | 'manual'; now?: Date },
): Promise<BackupInfo> {
  await fs.mkdir(opts.backupDir, { recursive: true });
  let name = stamp(opts.now ?? new Date(), opts.timezone);
  // Deux sauvegardes dans la même seconde : on attend la suivante plutôt que d'écraser.
  while (await exists(path.join(opts.backupDir, name))) {
    await new Promise((r) => setTimeout(r, 1000));
    name = stamp(new Date(), opts.timezone);
  }
  const tmp = path.join(opts.backupDir, `.en-cours-${name}`);
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp);
  try {
    await db.backup(path.join(tmp, 'interfas.db'));
    if (await exists(opts.mediaDir)) await fs.cp(opts.mediaDir, path.join(tmp, 'media'), { recursive: true });
    await fs.writeFile(
      path.join(tmp, 'sauvegarde.json'),
      JSON.stringify({ kind: opts.kind, created_at: new Date().toISOString() }, null, 2),
    );
    await fs.rename(tmp, path.join(opts.backupDir, name));
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw err;
  }
  return (await readBackup(opts.backupDir, name))!;
}

async function readBackup(dir: string, name: string): Promise<BackupInfo | null> {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const full = path.join(dir, name);
  if (!(await fs.stat(full).catch(() => null))?.isDirectory()) return null;
  let kind: BackupInfo['kind'] = 'auto';
  try {
    kind = JSON.parse(await fs.readFile(path.join(full, 'sauvegarde.json'), 'utf8')).kind === 'manual' ? 'manual' : 'auto';
  } catch {
    /* manifeste absent : sauvegarde automatique par défaut */
  }
  const size = await dirSize(full);
  const media = await dirSize(path.join(full, 'media'));
  return {
    name,
    date: `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`,
    day: `${m[1]}-${m[2]}-${m[3]}`,
    kind,
    bytes: size.bytes,
    images: media.files,
  };
}

/** Sauvegardes présentes, de la plus récente à la plus ancienne. */
export async function listBackups(dir: string): Promise<BackupInfo[]> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => NAME_RE.test(n)).sort().reverse();
  const out: BackupInfo[] = [];
  for (const n of names) {
    const info = await readBackup(dir, n);
    if (info) out.push(info);
  }
  return out;
}

/** Semaine ISO (AAAA-Wnn) d'une date AAAA-MM-JJ. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // lundi = 0
  d.setUTCDate(d.getUTCDate() - dow + 3); // jeudi de la semaine
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Garde la plus récente de chacun des 7 derniers jours ayant une sauvegarde,
 * et la plus récente de chacune des 4 dernières semaines. Supprime le reste.
 */
export function selectToKeep(backups: Pick<BackupInfo, 'name' | 'day'>[], daily = KEEP_DAILY, weekly = KEEP_WEEKLY): Set<string> {
  const sorted = [...backups].sort((a, b) => (a.name < b.name ? 1 : -1));
  const keep = new Set<string>();
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const b of sorted) {
    if (!days.has(b.day) && days.size < daily) {
      days.add(b.day);
      keep.add(b.name);
    }
    const w = isoWeek(b.day);
    if (!weeks.has(w) && weeks.size < weekly) {
      weeks.add(w);
      keep.add(b.name);
    }
  }
  return keep;
}

export async function rotateBackups(dir: string): Promise<string[]> {
  const all = await listBackups(dir);
  const keep = selectToKeep(all);
  const removed: string[] = [];
  for (const b of all) {
    if (keep.has(b.name)) continue;
    await fs.rm(path.join(dir, b.name), { recursive: true, force: true });
    removed.push(b.name);
  }
  // Restes d'une sauvegarde interrompue (arrêt du conteneur pendant la copie)
  for (const n of await fs.readdir(dir).catch(() => [] as string[])) {
    if (n.startsWith('.en-cours-')) await fs.rm(path.join(dir, n), { recursive: true, force: true });
  }
  return removed;
}
