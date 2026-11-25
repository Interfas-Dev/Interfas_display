import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}

describe('dépôt', () => {
  // Une règle trop large du .gitignore (ex. « backups/ ») a déjà exclu une vue.
  it('aucun fichier de l’application n’est ignoré par git', () => {
    const files = ['views', 'src', 'client', 'public/css', 'public/js', 'public/img', 'public/fonts'].flatMap(walk);
    let ignored = '';
    try {
      ignored = execFileSync('git', ['check-ignore', ...files], { encoding: 'utf8' });
    } catch (err) {
      // Code 1 : aucun fichier ignoré. Autre erreur (pas de git) : on ne peut pas vérifier.
      if ((err as { status?: number }).status !== 1) return;
    }
    expect(ignored.trim()).toBe('');
  });
});

describe('compatibilité de l’écran de l’atelier', () => {
  it('n’utilise pas « inset » (inconnu des navigateurs de télé anciens)', () => {
    for (const f of ['public/css/display.css', 'public/css/message.css']) {
      const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, f).not.toMatch(/(^|[;{\s])inset\s*:/);
    }
  });
});
