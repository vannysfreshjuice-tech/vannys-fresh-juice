// Dates are kept as plain 'YYYY-MM-DD' text, always worked out from the device's own clock.
// Never use toISOString() for a date: in Kampala (UTC+3) it gives yesterday between midnight and 3 am.

const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayYmd(): string {
  return ymd(new Date());
}

/** A Date at midday on that day (midday avoids any daylight-saving edge). */
export function fromYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12);
}

export function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function addDays(s: string, n: number): string {
  const d = fromYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

/** Whole days from a to b (b later = positive). */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromYmd(b).getTime() - fromYmd(a).getTime()) / 86400000);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 14/11/2026 */
export function showDate(s: string | undefined): string {
  if (!isYmd(s)) return '';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

/** Sat 14 Nov (adds the year when it is not this year) */
export function showDay(s: string | undefined): string {
  if (!isYmd(s)) return '';
  const d = fromYmd(s);
  const year = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}

export function dayParts(s: string): { day: string; month: string; weekday: string } {
  const d = fromYmd(s);
  return { day: String(d.getDate()), month: MONTHS[d.getMonth()], weekday: DAYS[d.getDay()] };
}

/** "Today", "Tomorrow", "In 3 days", "2 days ago" */
export function relativeDay(s: string, today = todayYmd()): string {
  const n = daysBetween(today, s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  return n > 0 ? `In ${n} days` : `${-n} days ago`;
}

export function longToday(): string {
  const d = new Date();
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

export interface Period {
  key: string;
  label: string;
  from: string; // '' = no start
  to: string; // '' = no end
}

export const PERIOD_KEYS = ['thisMonth', 'lastMonth', 'thisYear', 'lastYear', 'all', 'custom'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export function presetPeriod(key: PeriodKey, today = todayYmd(), custom?: { from: string; to: string }): Period {
  const t = fromYmd(today);
  const y = t.getFullYear();
  const m = t.getMonth();
  switch (key) {
    case 'thisMonth':
      return { key, label: `${MONTHS_LONG[m]} ${y}`, from: ymd(new Date(y, m, 1, 12)), to: ymd(new Date(y, m + 1, 0, 12)) };
    case 'lastMonth': {
      const first = new Date(y, m - 1, 1, 12);
      return { key, label: `${MONTHS_LONG[first.getMonth()]} ${first.getFullYear()}`, from: ymd(first), to: ymd(new Date(y, m, 0, 12)) };
    }
    case 'thisYear':
      return { key, label: `${y}`, from: `${y}-01-01`, to: `${y}-12-31` };
    case 'lastYear':
      return { key, label: `${y - 1}`, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case 'custom':
      return { key, label: `${showDate(custom?.from) || 'start'} to ${showDate(custom?.to) || 'today'}`, from: custom?.from ?? '', to: custom?.to ?? '' };
    default:
      return { key: 'all', label: 'All time', from: '', to: '' };
  }
}

export const PERIOD_NAMES: Record<PeriodKey, string> = {
  thisMonth: 'This month',
  lastMonth: 'Last month',
  thisYear: 'This year',
  lastYear: 'Last year',
  all: 'All time',
  custom: 'Choose dates',
};

export function inPeriod(date: string | undefined, p: { from: string; to: string }): boolean {
  if (!isYmd(date)) return false;
  if (p.from && date < p.from) return false;
  if (p.to && date > p.to) return false;
  return true;
}

/** Every month from one date to another, oldest first: { key: 'YYYY-MM', label: 'Nov 2026' }. */
export function monthsBetween(from: string, to: string): { key: string; label: string }[] {
  if (!isYmd(from) || !isYmd(to) || from > to) return [];
  const out: { key: string; label: string }[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7)) - 1;
  const endKey = to.slice(0, 7);
  for (let guard = 0; guard < 600; guard++) {
    const key = `${y}-${pad(m + 1)}`;
    out.push({ key, label: `${MONTHS[m]} ${y}` });
    if (key >= endKey) break;
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out;
}

/** The last n months, oldest first, as { key: 'YYYY-MM', label: 'Nov' }. */
export function lastMonths(n: number, today = todayYmd()): { key: string; label: string }[] {
  const t = fromYmd(today);
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(t.getFullYear(), t.getMonth() - i, 1, 12);
    out.push({ key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: MONTHS[d.getMonth()] });
  }
  return out;
}

/** Mon, Tue... */
export function weekdayShort(s: string): string {
  return isYmd(s) ? DAYS[fromYmd(s).getDay()] : '';
}
