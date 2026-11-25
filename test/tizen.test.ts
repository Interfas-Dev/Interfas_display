import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp } from './helpers/app.js';
import { zipStored } from '../src/content/tizen.js';

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
  });

  it('répond au test de présence depuis l’application de la télé', async () => {
    const res = await app.inject({ method: 'GET', url: '/display/ping.gif' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
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
