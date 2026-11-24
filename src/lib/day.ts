// The day list and the week sheet: the same picture as the owner's Excel sheet, worked out from the sales.
// Excel colours kept: a day with juice = yellow, a weekday without = red, a paid name = blue,
// a name paid from money paid ahead = green, a name not paid yet = no colour.
import { addDays, fromYmd } from './dates';
import { fridgeFlow, linesValue, saleTotals } from './juice';
import { num, sum } from './money';
import { FROM_ADVANCE, type Batch, type Order, type Payment, type Sale, type WriteOff } from './types';

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

/**
 * Bottles in a sale, written the Excel way: "Apio", "Apio-2", "Wasswa-5k". "Usual" is each bottle's own
 * price-list price for its size (the same on every phone; 24 Nov 2026), or one price for all bottles.
 */
export function excelName(s: Sale, usual: number | ((l: Sale['lines'][number]) => number)): string {
  const listOf = typeof usual === 'number' ? () => usual : usual;
  const qty = sum(s.lines, (l) => num(l.qty));
  const value = linesValue(s.lines);
  const listed = sum(s.lines, (l) => num(l.qty) * listOf(l));
  const name = s.customerName || 'Walk-in';
  const k = (v: number) => (v % 1000 === 0 ? `${v / 1000}k` : String(v));
  if (qty === 1) return value === listed ? name : `${name}-${k(value)}`;
  return value === listed ? `${name}-${qty}` : `${name}-${qty} (${k(value)})`;
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
  const list = sales.filter((s) => s.date === day && !s.opening).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.createdAt - b.createdAt);
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

export interface DayStock {
  /** Bottles left in the fridge from the days before (the evening before) */
  before: number;
  /** Bottles filled in batches dated that day */
  made: number;
  /** Bottles that came out of the fridge that day for sales and delivered or packed orders */
  sold: number;
  /** Bottles from recorded batches still in the fridge at the end of that day */
  left: number;
  /** Bottles written off (spoiled, given away) that day */
  spoiled: number;
  /** Bottles sold that day with no bottles made recorded for them */
  unrecorded: number;
}

/**
 * The fridge sum for one day: left from before + made - sold - went bad = left. Worked out from the same
 * per-batch count as the fridge (`fridgeFlow`), so the Day list and Stock always agree; for today, left
 * is the fridge count. A bottle sold without a batch comes off a batch of that juice and size made that
 * day or before, even one recorded later; bottles sold with nothing recorded for them are `unrecorded`.
 */
export function dayStock(day: string, batches: Batch[], sales: Sale[], orders: Order[], writeOffs: WriteOff[]): DayStock {
  const flow = fridgeFlow(batches, sales, orders, writeOffs);
  let filledBefore = 0;
  let made = 0;
  for (const b of batches) {
    const n = sum(Object.values(b.filled ?? {}), (v) => num(v));
    if (b.date < day) filledBefore += n;
    else if (b.date === day) made += n;
  }
  let takenBefore = 0;
  let sold = 0;
  let spoiled = 0;
  for (const t of flow.taken) {
    if (t.date < day) takenBefore += t.qty;
    else if (t.date === day) {
      if (t.spoiled) spoiled += t.qty;
      else sold += t.qty;
    }
  }
  const before = Math.max(0, filledBefore - takenBefore);
  return { before, made, sold, spoiled, left: Math.max(0, before + made - sold - spoiled), unrecorded: sum(flow.unmatched.filter((u) => u.date === day), (u) => u.qty) };
}

/** Old version kept only to compare in the audit script; not used by the app. */
export function dayStockOld(day: string, batches: Batch[], sales: Sale[], orders: Order[], writeOffs: WriteOff[]) {
  let made = 0;
  let filled = 0;
  for (const b of batches) {
    if (b.date > day) continue;
    const n = sum(Object.values(b.filled ?? {}), (v) => num(v));
    filled += n;
    if (b.date === day) made += n;
  }
  let out = 0;
  for (const s of sales) if (s.date <= day) for (const l of s.lines ?? []) if (l.batchId) out += num(l.qty);
  for (const o of orders) {
    if (o.stage === 'Cancelled' || !o.packed?.length) continue;
    // packed bottles leave the fridge when packed; dated by delivery (or the due day while on the way)
    if ((o.deliveredOn || o.dueDate) <= day) for (const l of o.packed) if (l.batchId) out += num(l.qty);
  }
  let spoiled = 0;
  for (const w of writeOffs) {
    if (w.date <= day) out += num(w.qty);
    if (w.date === day) spoiled += num(w.qty);
  }
  return { made, left: Math.max(0, filled - out), spoiled };
}

/** The juice and size sold most (bottles) in the 60 days up to that day: the day list's usual bottle. */
export function mostSold(sales: Sale[], day: string): { productId: string; size: string } | null {
  const from = addDays(day, -60);
  const count = new Map<string, number>();
  for (const s of sales) {
    if (s.opening || s.date < from || s.date > day) continue;
    for (const l of s.lines ?? []) count.set(`${l.productId}|${l.size}`, (count.get(`${l.productId}|${l.size}`) ?? 0) + num(l.qty));
  }
  const top = [...count].sort((a, b) => b[1] - a[1])[0];
  if (!top) return null;
  const [productId, size] = top[0].split('|');
  return { productId, size };
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
    if (!s.customerId || s.opening) continue;
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
