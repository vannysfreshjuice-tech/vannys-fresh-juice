// How each customer and each juice is doing, worked out from the records (nothing stored).
// Customers: billed, paid, owed, collection rate, paid ahead, bottles a week, last active, overdue.
// Juices (for a period): bottles, sales, profit, margin, share of sales, customers, days sold,
// change against the period before, spoiled bottles.
import { addDays, daysBetween, inPeriod, showDate, type Period } from './dates';
import { customerAdvances, linesValue, orderTotals, orderValue, saleTotals, type Debt } from './juice';
import { money, num, sum } from './money';
import type { Report } from './reports';
import type { Batch, Customer, Order, Payment, Product, Sale, WriteOff } from './types';

/** An unpaid day older than this many days counts as overdue. */
export const OVERDUE_DAYS = 7;

export interface CustomerStats {
  billed: number;
  paid: number;
  owed: number;
  /** paid / billed, 0 to 1 (1 when nothing was billed) */
  rate: number;
  ahead: number;
  times: number;
  bottles: number;
  /** bottles a week over the last 4 weeks */
  perWeek: number;
  lastActive: string;
  /** unpaid sales and orders older than OVERDUE_DAYS */
  overdue: number;
  oldestUnpaid: string;
}

export function customerStats(customers: Customer[], sales: Sale[], orders: Order[], payments: Payment[], byRef: Map<string, Payment[]>, today: string): Map<string, CustomerStats> {
  const ahead = customerAdvances(customers, orders, sales, payments);
  const out = new Map<string, CustomerStats>();
  const at = (id: string) => {
    let s = out.get(id);
    if (!s) out.set(id, (s = { billed: 0, paid: 0, owed: 0, rate: 1, ahead: Math.max(0, ahead.get(id) ?? 0), times: 0, bottles: 0, perWeek: 0, lastActive: '', overdue: 0, oldestUnpaid: '' }));
    return s;
  };
  for (const c of customers) at(c.id);
  const recent = addDays(today, -27);
  const overdueBefore = addDays(today, -OVERDUE_DAYS);
  const add = (id: string, date: string, value: number, balance: number, bottles: number) => {
    const s = at(id);
    s.billed += value;
    s.owed += balance;
    s.times += 1;
    s.bottles += bottles;
    if (date >= recent && date <= today) s.perWeek += bottles / 4;
    if (date > s.lastActive) s.lastActive = date;
    if (balance > 0) {
      if (date < overdueBefore) s.overdue += 1;
      if (!s.oldestUnpaid || date < s.oldestUnpaid) s.oldestUnpaid = date;
    }
  };
  for (const s of sales) if (s.customerId) add(s.customerId, s.date, linesValue(s.lines), saleTotals(s, byRef.get(s.id)).balance, sum(s.lines, (l) => num(l.qty)));
  for (const o of orders) if (o.customerId && o.stage !== 'Cancelled') add(o.customerId, o.deliveredOn || o.dueDate, orderValue(o), orderTotals(o, byRef.get(o.id)).balance, sum(o.lines, (l) => num(l.qty)));
  for (const s of out.values()) {
    s.paid = s.billed - s.owed;
    s.rate = s.billed > 0 ? s.paid / s.billed : 1;
    s.perWeek = Math.round(s.perWeek * 10) / 10;
  }
  return out;
}

export interface Standing {
  /** owes: a balance to pay; ahead: money paid ahead not used; clear: nothing either way */
  kind: 'owes' | 'ahead' | 'clear';
  amount: number;
  /** for money paid ahead: about how many bottles it still buys */
  bottles: number;
}

/** A customer's final standing for the statement card: what they owe less what they paid ahead, one figure. */
export function standing(owes: number, ahead: number, bottlePrice: number): Standing {
  const net = Math.round(owes - Math.max(0, ahead));
  if (net > 0) return { kind: 'owes', amount: net, bottles: 0 };
  if (net < 0) return { kind: 'ahead', amount: -net, bottles: bottlePrice > 0 ? Math.floor(-net / bottlePrice) : 0 };
  return { kind: 'clear', amount: 0, bottles: 0 };
}

/** The WhatsApp statement: what is owed day by day (oldest first), the total, and money paid ahead. */
export function statementText(name: string, debts: Debt[], owes: number, ahead: number, s: { businessName: string; whatsapp: string; currency: string }): string {
  return [
    `${s.businessName}: statement for ${name}`,
    ...debts.map((d) => `${showDate(d.date)}${d.kind === 'order' ? ` (order ${d.number})` : ''}: ${money(d.balance, s.currency)}`),
    `Total owed: ${money(owes, s.currency)}`,
    ...(ahead > 0 ? [`Paid ahead, not used yet: ${money(ahead, s.currency)}`] : []),
    `Thank you. ${s.whatsapp}`,
  ].join('\n');
}

/**
 * The days just before the period, as many as the period has had so far (none for "all time" or an
 * open-ended period). This month on the 16th: the 16 days before the 1st, so half a month is never
 * compared with a whole one.
 */
export function previousPeriod(p: Period, today?: string): Period | null {
  if (!p.from || !p.to) return null;
  const end = today && today < p.to ? today : p.to;
  if (end < p.from) return null;
  const days = daysBetween(p.from, end) + 1;
  return { key: 'custom', label: 'the period before', from: addDays(p.from, -days), to: addDays(p.from, -1) };
}

export interface JuiceStats {
  product: Product;
  bottles: number;
  sales: number;
  cost: number;
  profit: number;
  margin: number;
  /** share of the period's bottle sales, 0 to 1 */
  share: number;
  customers: number;
  daysSold: number;
  lastSold: string;
  /** sales change against the period before, e.g. 0.25 = +25% (null when there is nothing to compare) */
  change: number | null;
  spoiled: number;
}

export function juiceStats(report: Report, before: Report | null, sales: Sale[], orders: Order[], batches: Batch[], writeOffs: WriteOff[]): JuiceStats[] {
  const p = report.period;
  const customers = new Map<string, Set<string>>();
  const days = new Map<string, Set<string>>();
  const last = new Map<string, string>();
  const note = (productId: string, date: string, customerId?: string) => {
    if (date > (last.get(productId) ?? '')) last.set(productId, date);
    if (!inPeriod(date, p)) return;
    if (!days.has(productId)) days.set(productId, new Set());
    days.get(productId)!.add(date);
    if (customerId) {
      if (!customers.has(productId)) customers.set(productId, new Set());
      customers.get(productId)!.add(customerId);
    }
  };
  for (const s of sales) for (const l of s.lines ?? []) note(l.productId, s.date, s.customerId);
  for (const o of orders) if (o.stage === 'Delivered') for (const l of o.lines) note(l.productId, o.deliveredOn || o.dueDate, o.customerId);
  const batchProduct = new Map(batches.map((b) => [b.id, b.productId]));
  const spoiled = new Map<string, number>();
  for (const w of writeOffs) {
    if (!inPeriod(w.date, p)) continue;
    const pid = batchProduct.get(w.batchId);
    if (pid) spoiled.set(pid, (spoiled.get(pid) ?? 0) + num(w.qty));
  }
  const prev = new Map((before?.rows ?? []).map((r) => [r.product.id, r.sales]));
  return report.rows
    .map((r) => {
      const was = prev.get(r.product.id) ?? 0;
      return {
        product: r.product,
        bottles: r.bottles,
        sales: r.sales,
        cost: r.cost,
        profit: r.profit,
        margin: r.sales > 0 ? r.profit / r.sales : 0,
        share: report.sales > 0 ? r.sales / report.sales : 0,
        customers: customers.get(r.product.id)?.size ?? 0,
        daysSold: days.get(r.product.id)?.size ?? 0,
        lastSold: last.get(r.product.id) ?? '',
        change: before && was > 0 ? (r.sales - was) / was : null,
        spoiled: spoiled.get(r.product.id) ?? 0,
      };
    })
    .sort((a, b) => b.sales - a.sales);
}
