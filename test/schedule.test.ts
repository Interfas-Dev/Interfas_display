import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  ALL_DAYS,
  describeSchedule,
  localNow,
  scheduleStatus,
  validateSchedule,
  type Schedule,
} from '../src/content/schedule.js';
import { form, loginAs, makeApp, messageDefaults } from './helpers/app.js';
import { listLiveMessages, listMessages } from '../src/content/messages.js';

const base: Schedule = { is_active: 1, starts_at: null, ends_at: null, days_mask: ALL_DAYS, daily_start: null, daily_end: null };
// Lundi 23 novembre 2026, 10h30 à Paris
const monday1030 = { datetime: '2026-11-23T10:30', time: '10:30', weekday: 0 };

describe('heure locale', () => {
  it('convertit en heure de Paris, hiver comme été', () => {
    expect(localNow(new Date('2026-11-23T09:30:00Z'))).toEqual(monday1030);
    expect(localNow(new Date('2026-07-05T22:15:00Z'))).toEqual({ datetime: '2026-07-06T00:15', time: '00:15', weekday: 0 });
  });
});

describe('statut de planification', () => {
  it('en continu par défaut', () => expect(scheduleStatus(base, monday1030)).toBe('live'));
  it('désactivé', () => expect(scheduleStatus({ ...base, is_active: 0 }, monday1030)).toBe('disabled'));
  it('programmé avant le début', () =>
    expect(scheduleStatus({ ...base, starts_at: '2026-11-23T10:31' }, monday1030)).toBe('scheduled'));
  it('en diffusion dès le début', () =>
    expect(scheduleStatus({ ...base, starts_at: '2026-11-23T10:30' }, monday1030)).toBe('live'));
  it('terminé à la fin', () =>
    expect(scheduleStatus({ ...base, ends_at: '2026-11-23T10:30' }, monday1030)).toBe('ended'));
  it('hors des jours choisis', () =>
    expect(scheduleStatus({ ...base, days_mask: 0b1111110 }, monday1030)).toBe('off_hours'));
  it('plage horaire', () => {
    expect(scheduleStatus({ ...base, daily_start: '06:00', daily_end: '14:00' }, monday1030)).toBe('live');
    expect(scheduleStatus({ ...base, daily_start: '14:00', daily_end: '22:00' }, monday1030)).toBe('off_hours');
    expect(scheduleStatus({ ...base, daily_start: '06:00', daily_end: '10:30' }, monday1030)).toBe('off_hours');
  });
  it('plage horaire qui passe minuit', () => {
    const night = { ...base, daily_start: '22:00', daily_end: '06:00' };
    expect(scheduleStatus(night, { ...monday1030, time: '23:00' })).toBe('live');
    expect(scheduleStatus(night, { ...monday1030, time: '05:59' })).toBe('live');
    expect(scheduleStatus(night, monday1030)).toBe('off_hours');
  });
});

describe('validation', () => {
  const ok = { duration_seconds: '15', days: ['0', '4'] };
  it('accepte une saisie complète', () => {
    const { input, errors } = validateSchedule({ ...ok, starts_at: '2026-12-01T06:00', ends_at: '2026-12-15T18:00', daily_start: '06:00', daily_end: '14:00' });
    expect(errors).toEqual({});
    expect(input).toEqual({ durationSeconds: 15, startsAt: '2026-12-01T06:00', endsAt: '2026-12-15T18:00', daysMask: 0b10001, dailyStart: '06:00', dailyEnd: '14:00' });
  });
  it('refuse une durée hors limites', () => {
    expect(validateSchedule({ ...ok, duration_seconds: '2' }).errors.duration).toBeDefined();
    expect(validateSchedule({ ...ok, duration_seconds: '301' }).errors.duration).toBeDefined();
    expect(validateSchedule({ ...ok, duration_seconds: '4.5' }).errors.duration).toBeDefined();
  });
  it('refuse une fin avant le début', () =>
    expect(validateSchedule({ ...ok, starts_at: '2026-12-02T00:00', ends_at: '2026-12-01T00:00' }).errors.period).toBeDefined());
  it('refuse aucun jour', () => expect(validateSchedule({ duration_seconds: '10' }).errors.days).toBeDefined());
  it('refuse une plage incomplète', () => expect(validateSchedule({ ...ok, daily_start: '06:00' }).errors.daily).toBeDefined());
  it('accepte un seul jour coché (valeur simple)', () =>
    expect(validateSchedule({ duration_seconds: '10', days: '6' }).input.daysMask).toBe(0b1000000));
});

describe('résumé', () => {
  it('décrit la planification', () => {
    expect(describeSchedule(base)).toBe('en continu');
    expect(describeSchedule({ ...base, starts_at: '2026-12-01T06:00', ends_at: '2026-12-15T18:00', days_mask: 0b0011111, daily_start: '06:00', daily_end: '14:00' }))
      .toBe('du 01/12/2026 06h00 au 15/12/2026 18h00, du lundi au vendredi, de 06h00 à 14h00');
  });
});

describe('diffusion à l’écran', () => {
  let app: FastifyInstance;
  let cookie: string;
  let tid: string;
  beforeAll(async () => {
    app = await makeApp();
    cookie = await loginAs(app);
    tid = String((app.db.prepare('SELECT id FROM templates WHERE is_default = 1').get() as { id: number }).id);
  });
  afterAll(async () => app.close());

  async function create(data: Record<string, string | string[]>) {
    const f = form({ ...messageDefaults(tid), content: '<p>x</p>', is_active: 'on', ...data });
    return app.inject({ method: 'POST', url: '/admin/messages', headers: { ...f.headers, cookie }, payload: f.payload });
  }

  it('enregistre durée et planification, et ne diffuse que ce qui est en cours', async () => {
    expect((await create({ heading: 'Maintenant', duration_seconds: '25' })).statusCode).toBe(303);
    expect((await create({ heading: 'Plus tard', starts_at: '2099-01-01T00:00' })).statusCode).toBe(303);
    expect((await create({ heading: 'Fini', ends_at: '2000-01-01T00:00' })).statusCode).toBe(303);

    const all = listMessages(app.db);
    expect(all.find((m) => m.heading === 'Maintenant')!.duration_seconds).toBe(25);

    const live = listLiveMessages(app.db, localNow()).map((m) => m.heading);
    expect(live).toEqual(['Maintenant']);

    const display = await app.inject({ method: 'GET', url: '/display' });
    expect(display.body).toContain('data-duration="25"');
    expect(display.body).not.toContain('Plus tard');

    const list = await app.inject({ method: 'GET', url: '/admin/messages', headers: { cookie } });
    expect(list.body).toContain('Programmé');
    expect(list.body).toContain('Terminé');
    expect(list.body).toContain('à partir du 01/01/2099 00h00');
  });

  it('refuse une planification invalide avec un message clair', async () => {
    const res = await create({ heading: 'Mauvais', duration_seconds: '1', days: [] });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('entre 3 et 300');
    expect(res.body).toContain('Coche au moins un jour');
  });
});
