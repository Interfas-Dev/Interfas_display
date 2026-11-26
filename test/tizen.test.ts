import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers/app.js';
import fs from 'node:fs';
import os from 'node:os';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { packageVersion, readZipEntry, zipStored } from '../src/content/tizen.js';

let app: FastifyInstance;
beforeAll(async () => { app = await makeApp(); });
afterAll(async () => app.close());

describe('URL Launcher des télés Samsung', () => {
  it('sert sssp_config.xml avec la taille exacte du paquet', async () => {
    const cfg = await app.inject({ method: 'GET', url: '/display/sssp_config.xml', headers: { host: 'screen.interfas.fr' } });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.headers['content-type']).toContain('application/xml');
    expect(cfg.body).toContain('<widgetname>InterfasDisplay</widgetname>');
    expect(cfg.body).toContain('<webtype>tizen</webtype>');
    const size = Number(/<size>(\d+)<\/size>/.exec(cfg.body)![1]);

    const wgt = await app.inject({ method: 'GET', url: '/display/InterfasDisplay.wgt', headers: { host: 'screen.interfas.fr' } });
    expect(wgt.statusCode).toBe(200);
    expect(wgt.rawPayload.length).toBe(size);
    expect(wgt.rawPayload.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    // L'application renvoie vers l'écran du même serveur.
    expect(wgt.rawPayload.toString('latin1')).toContain('"http://screen.interfas.fr/display"');
    expect(wgt.rawPayload.toString('latin1')).toContain('config.xml');
    // Pas de style ni de script dans la page : la politique de sécurité des télés les bloque.
    const index = readZipEntry(wgt.rawPayload, 'index.html')!.toString();
    expect(index).not.toMatch(/<style|<script>/);
    expect(index).toContain('<script src="main.js"></script>');
    expect(readZipEntry(wgt.rawPayload, 'main.js')!.toString()).toContain('/display/ping.gif');
    expect(readZipEntry(wgt.rawPayload, 'config.xml')!.toString()).toContain('<tizen:profile name="tv-samsung"/>');
  });

  it('répond au test de présence depuis l’application de la télé', async () => {
    const res = await app.inject({ method: 'GET', url: '/display/ping.gif' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('sert en priorité un paquet signé déposé à côté de la base', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'interfas-tv-'));
    const other = await buildApp({ ...loadConfig({}), databasePath: path.join(dir, 'interfas.db'), mediaDir: path.join(dir, 'media'), backupDir: path.join(dir, 'b'), backupTime: '', logLevel: 'silent' });
    try {
      const signed = Buffer.from('PK-paquet-signe');
      fs.writeFileSync(path.join(dir, 'InterfasDisplay.wgt'), signed);
      const cfg = await other.inject({ method: 'GET', url: '/display/sssp_config.xml', headers: { host: 'screen.interfas.fr' } });
      expect(cfg.body).toContain(`<size>${signed.length}</size>`);
      expect(cfg.body).toContain('<ver>1.0.1</ver>'); // config.xml illisible : version par défaut
      const wgt = await other.inject({ method: 'GET', url: '/display/InterfasDisplay.wgt' });
      expect(wgt.rawPayload.equals(signed)).toBe(true);
    } finally {
      await other.close();
    }
  });

  it('annonce la version du config.xml d’un paquet signé (compressé)', () => {
    const cfg = '<?xml version="1.0"?><widget xmlns="http://www.w3.org/ns/widgets" id="x" version="1.0.7"></widget>';
    const zip = zipStored([{ name: 'config.xml', data: Buffer.from(cfg) }]);
    expect(packageVersion(zip)).toBe('1.0.7');
    // Même paquet en « deflate », comme le produisent les outils Tizen.
    const rebuilt = zipStored([{ name: 'config.xml', data: deflateRawSync(Buffer.from(cfg)) }]);
    rebuilt.writeUInt16LE(8, 8); // méthode locale
    const central = rebuilt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    rebuilt.writeUInt16LE(8, central + 10);
    expect(packageVersion(rebuilt)).toBe('1.0.7');
    expect(packageVersion(Buffer.from('pas un zip'))).toBe('1.0.1');
  });

  it('refuse un nom d’hôte suspect', async () => {
    const res = await app.inject({ method: 'GET', url: '/display/sssp_config.xml', headers: { host: 'x"><script>' } });
    expect(res.statusCode).toBe(400);
  });

  it('produit un ZIP lisible', () => {
    const zip = zipStored([{ name: 'a.txt', data: Buffer.from('bonjour') }]);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(1);
  });
});
