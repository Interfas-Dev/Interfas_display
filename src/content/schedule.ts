/**
 * Planification des messages : période (début / fin), jours de la semaine et
 * plage horaire quotidienne, évalués dans le fuseau de l'atelier.
 */

export const DEFAULT_TIMEZONE = 'Europe/Paris';
export const DURATION_MIN = 3;
export const DURATION_MAX = 300;
export const DURATION_DEFAULT = 10;
export const ALL_DAYS = 0b1111111;
export const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

export interface Schedule {
  is_active: number;
  starts_at: string | null; // AAAA-MM-JJTHH:MM, heure locale
  ends_at: string | null;
  days_mask: number;
  daily_start: string | null; // HH:MM
  daily_end: string | null;
}

export type ScheduleStatus = 'live' | 'disabled' | 'scheduled' | 'ended' | 'off_hours';

export const STATUS_LABELS: Record<ScheduleStatus, string> = {
  live: 'En diffusion',
  disabled: 'Désactivé',
  scheduled: 'Programmé',
  ended: 'Terminé',
  off_hours: 'Hors plage horaire',
};

export interface LocalNow {
  datetime: string; // AAAA-MM-JJTHH:MM
  time: string; // HH:MM
  weekday: number; // 0 = lundi ... 6 = dimanche
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Date et heure locales de l'atelier pour un instant donné. */
export function localNow(date: Date = new Date(), timeZone = DEFAULT_TIMEZONE): LocalNow {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      weekday: 'short',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const time = `${parts.hour}:${parts.minute}`;
  return {
    datetime: `${parts.year}-${parts.month}-${parts.day}T${time}`,
    time,
    weekday: WEEKDAYS.indexOf(parts.weekday!),
  };
}

function inDailyWindow(time: string, start: string, end: string): boolean {
  // Plage qui passe minuit (ex. 22:00 → 06:00) acceptée.
  return start <= end ? time >= start && time < end : time >= start || time < end;
}

export function scheduleStatus(s: Schedule, now: LocalNow): ScheduleStatus {
  if (!s.is_active) return 'disabled';
  if (s.ends_at && now.datetime >= s.ends_at) return 'ended';
  if (s.starts_at && now.datetime < s.starts_at) return 'scheduled';
  if (!(s.days_mask & (1 << now.weekday))) return 'off_hours';
  if (s.daily_start && s.daily_end && !inDailyWindow(now.time, s.daily_start, s.daily_end)) return 'off_hours';
  return 'live';
}

export function isLive(s: Schedule, now: LocalNow): boolean {
  return scheduleStatus(s, now) === 'live';
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface ScheduleInput {
  durationSeconds: number;
  startsAt: string | null;
  endsAt: string | null;
  daysMask: number;
  dailyStart: string | null;
  dailyEnd: string | null;
}

/** Lit et valide les champs « Diffusion » d'un formulaire. */
export function validateSchedule(raw: Record<string, unknown>): { input: ScheduleInput; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const str = (k: string) => String(raw[k] ?? '').trim();

  const durRaw = str('duration_seconds');
  const duration = durRaw === '' ? DURATION_DEFAULT : Number(durRaw);
  if (!Number.isInteger(duration) || duration < DURATION_MIN || duration > DURATION_MAX) {
    errors.duration = `La durée doit être un nombre entier de secondes entre ${DURATION_MIN} et ${DURATION_MAX}.`;
  }

  const startsAt = str('starts_at') || null;
  const endsAt = str('ends_at') || null;
  if ((startsAt && !DATETIME_RE.test(startsAt)) || (endsAt && !DATETIME_RE.test(endsAt))) {
    errors.period = 'Date ou heure invalide.';
  } else if (startsAt && endsAt && endsAt <= startsAt) {
    errors.period = 'La fin doit être après le début.';
  }

  // Les cases cochées arrivent en chaîne (une seule) ou en tableau (plusieurs).
  const rawDays = raw.days;
  const days = (Array.isArray(rawDays) ? rawDays : rawDays === undefined ? [] : [rawDays])
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const daysMask = days.reduce((m, d) => m | (1 << d), 0);
  if (daysMask === 0) errors.days = 'Coche au moins un jour.';

  const dailyStart = str('daily_start') || null;
  const dailyEnd = str('daily_end') || null;
  if ((dailyStart && !TIME_RE.test(dailyStart)) || (dailyEnd && !TIME_RE.test(dailyEnd))) {
    errors.daily = 'Heure invalide.';
  } else if (!!dailyStart !== !!dailyEnd) {
    errors.daily = 'Indique l’heure de début et l’heure de fin, ou aucune des deux.';
  } else if (dailyStart && dailyStart === dailyEnd) {
    errors.daily = 'Les heures de début et de fin doivent être différentes.';
  }

  return {
    input: {
      durationSeconds: Number.isInteger(duration) ? duration : DURATION_DEFAULT,
      startsAt, endsAt, daysMask: daysMask || ALL_DAYS, dailyStart, dailyEnd,
    },
    errors,
  };
}

function formatDateTime(v: string): string {
  const [d, t] = v.split('T');
  const [y, m, day] = d!.split('-');
  return `${day}/${m}/${y} ${t!.replace(':', 'h')}`;
}

/** Résumé lisible de la planification, pour la liste des messages. */
export function describeSchedule(s: Omit<Schedule, 'is_active'>): string {
  const parts: string[] = [];
  if (s.starts_at && s.ends_at) parts.push(`du ${formatDateTime(s.starts_at)} au ${formatDateTime(s.ends_at)}`);
  else if (s.starts_at) parts.push(`à partir du ${formatDateTime(s.starts_at)}`);
  else if (s.ends_at) parts.push(`jusqu'au ${formatDateTime(s.ends_at)}`);
  if (s.days_mask !== ALL_DAYS) {
    if (s.days_mask === 0b0011111) parts.push('du lundi au vendredi');
    else parts.push(DAY_LABELS.filter((_, i) => s.days_mask & (1 << i)).join(', ').toLowerCase());
  }
  if (s.daily_start && s.daily_end) parts.push(`de ${s.daily_start.replace(':', 'h')} à ${s.daily_end.replace(':', 'h')}`);
  return parts.length ? parts.join(', ') : 'en continu';
}
