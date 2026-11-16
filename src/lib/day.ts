// The day list and the week sheet: the same picture as the owner's Excel sheet, worked out from the sales.
// Excel colours kept: a day with juice = yellow, a weekday without = red, a paid name = blue,
// a name paid from money paid ahead = green, a name not paid yet = no colour.
import { addDays, fromYmd } from './dates';
import { linesValue, saleTotals } from './juice';
import { num, sum } from './money';
import { FROM_ADVANCE, type Order, type Payment, type Sale } from './types';

export type EntryStatus = 'paid' | 'ahead' | 'part' | 'owed';

/** Paid, paid from money paid ahead, part paid, or not paid. */
export function entryStatus(s: Sale, pays: Payment[] | undefined): EntryStatus {
  const t = saleTotals(s, pays);
  if (t.balance <= 0) return (pays ?? []).length > 0 && (pays ?? []).every((p) => p.method === FROM_ADVANCE) ? 'ahead' : 'paid';
  return t.paid > 0 ? 'part' : 'owed';
}

export const STATUS_WORDS: Record<EntryStatus, string> = { paid: 'Paid', ahead: 'Paid ahead', part: 'Part paid', owed: 'Not paid' };

/** The Monday of that day's week. */
export function weekStart(day: string): string {
  const wd = fromYmd(day).getDay(); // 0 = Sunday
  return addDays(day, wd === 0 ? -6 : 1 - wd);
}

/** Bottles in a sale, written the Excel way: "Solo", "Solo-2", "Esther-5k". */
export function excelName(s: Sale, usualPrice: number): string {
  const qty = sum(s.lines, (l) => num(l.qty));
  const value = linesValue(s.lines);
  const name = s.customerName || 'Walk-in';
  if (qty === 1 && value === usualPrice) return name;
  if (qty === 1) return `${name}-${value % 1000 === 0 ? `${value / 1000}k` : value}`;
  return value === qty * usualPrice ? `${name}-${qty}` : `${name}-${qty} (${value % 1000 === 0 ? `${value / 1000}k` : value})`;
}

export type DayState = 'supplied' | 'none' | 'today' | 'weekend' | 'later' | 'before';

export interface DaySummary {
  day: string;
  state: DayState;
  sales: Sale[];
  bottles: number;
  value: number;
  paid: number;
  owed: number;
}

/**
 * One day: its sales and figures, and its colour. A weekday with no sales and no delivered order is
 * "none" (red in the Excel sheet); a weekend day with none is just "weekend". Days before the first
 * record, and days to come, are not coloured.
 */
export function daySummary(day: string, today: string, firstDay: string, sales: Sale[], orders: Order[], byRef: Map<string, Payment[]>): DaySummary {
  const list = sales.filter((s) => s.date === day).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.createdAt - b.createdAt);
  const delivered = orders.some((o) => o.stage === 'Delivered' && o.deliveredOn === day);
  const wd = fromYmd(day).getDay();
  const state: DayState = list.length || delivered ? 'supplied' : day > today ? 'later' : day === today ? 'today' : !firstDay || day < firstDay ? 'before' : wd === 0 || wd === 6 ? 'weekend' : 'none';
  let paid = 0;
  let owed = 0;
  for (const s of list) {
    const t = saleTotals(s, byRef.get(s.id));
    paid += t.paid;
    owed += t.balance;
  }
  return { day, state, sales: list, bottles: sum(list, (s) => sum(s.lines, (l) => num(l.qty))), value: sum(list, (s) => linesValue(s.lines)), paid, owed };
}

/**
 * The day list's quick buttons: the customers who took juice most often in the 60 days BEFORE that day
 * (so the order does not move while names are tapped), then anyone new on the day itself, at the end.
 */
export function regulars(sales: Sale[], day: string, max = 16): string[] {
  const from = addDays(day, -60);
  const count = new Map<string, { n: number; last: string }>();
  const onTheDay: string[] = [];
  for (const s of sales) {
    if (!s.customerId) continue;
    if (s.date === day && !onTheDay.includes(s.customerId)) onTheDay.push(s.customerId);
    if (s.date < from || s.date >= day) continue;
    const c = count.get(s.customerId) ?? { n: 0, last: '' };
    c.n += 1;
    if (s.date > c.last) c.last = s.date;
    count.set(s.customerId, c);
  }
  const ranked = [...count]
    .sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([id]) => id);
  return [...ranked, ...onTheDay.filter((id) => !ranked.includes(id))];
}
