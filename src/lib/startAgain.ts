// "Start again from a date": removes every dated record before the day chosen, keeping customers,
// juices, recipes, stock items, suppliers, staff and settings. Money paid ahead is always carried
// over (one line per customer: juice still owed to them); what customers still owe can be carried
// over too (one "brought forward" line each). Payments made on or after the day for older sales
// move onto the brought-forward line, so money already received is never lost.
import { addDays } from './dates';
import { linesValue, orderValue } from './juice';
import { num, sum } from './money';
import { FROM_ADVANCE, OPENING_NOTE, type Records } from './types';
import type { Op } from '../data/store';

export interface StartAgainPlan {
  ops: Op[];
  removed: Record<string, number>;
  /** what customers still owe from before, carried over (0 when not carried) */
  owedCarried: number;
  owedDropped: number;
  aheadCarried: number;
}

export function startAgainPlan(r: Records, cutoff: string, carryOwed: boolean, newId: () => string, now = Date.now()): StartAgainPlan {
  const ops: Op[] = [];
  const removed: Record<string, number> = {};
  const del = (col: Op['col'], id: string) => {
    ops.push({ op: 'delete', col, id });
    removed[col] = (removed[col] ?? 0) + 1;
  };
  const before = (d: string | undefined) => !!d && d < cutoff;
  const carryDay = addDays(cutoff, -1);
  const paysOf = new Map<string, typeof r.payments>();
  for (const p of r.payments) if (p.kind !== 'advance') paysOf.set(p.refId, [...(paysOf.get(p.refId) ?? []), p]);

  // Old sales and finished orders: what is still owed on them (as it stood the day before), per customer
  const oldSales = r.sales.filter((s) => before(s.date));
  const oldOrders = r.orders.filter((o) => (o.stage === 'Delivered' || o.stage === 'Cancelled') && before(o.deliveredOn || o.dueDate));
  const oldIds = new Set([...oldSales.map((s) => s.id), ...oldOrders.map((o) => o.id)]);
  const owedBy = new Map<string, number>();
  const laterPays = new Map<string, typeof r.payments>();
  const add = (customerId: string | undefined, value: number, refId: string) => {
    if (!customerId) return;
    const pays = paysOf.get(refId) ?? [];
    const paidBefore = sum(pays.filter((p) => before(p.date)), (p) => num(p.amount));
    owedBy.set(customerId, (owedBy.get(customerId) ?? 0) + Math.max(0, value - paidBefore));
    laterPays.set(customerId, [...(laterPays.get(customerId) ?? []), ...pays.filter((p) => !before(p.date))]);
  };
  for (const s of oldSales) add(s.customerId, linesValue(s.lines), s.id);
  for (const o of oldOrders) if (o.stage === 'Delivered') add(o.customerId, orderValue(o), o.id);

  // Money paid ahead as it stood the day before: paid ahead, less what bottles took from it, before the day
  const owner = new Map<string, string>();
  for (const s of r.sales) if (s.customerId) owner.set(s.id, s.customerId);
  for (const o of r.orders) if (o.customerId) owner.set(o.id, o.customerId);
  const aheadBy = new Map<string, number>();
  for (const p of r.payments) {
    if (!before(p.date)) continue;
    if (p.kind === 'advance') aheadBy.set(p.refId, (aheadBy.get(p.refId) ?? 0) + num(p.amount));
    else if (p.method === FROM_ADVANCE) {
      const c = owner.get(p.refId);
      if (c) aheadBy.set(c, (aheadBy.get(c) ?? 0) - num(p.amount));
    }
  }

  // Remove the old sales and orders with their payments; payments made later move to the carried line
  const keepLater = new Set<string>();
  let owedCarried = 0;
  let owedDropped = 0;
  let n = 0;
  for (const c of r.customers) {
    const owed = Math.round(owedBy.get(c.id) ?? 0);
    const later = laterPays.get(c.id) ?? [];
    if (owed <= 0) continue;
    if (!carryOwed) {
      owedDropped += owed;
      continue;
    }
    owedCarried += owed;
    const id = newId();
    ops.push({
      op: 'set',
      col: 'sales',
      id,
      data: { number: `BF-${String(++n).padStart(4, '0')}`, date: carryDay, time: '', customerId: c.id, customerName: c.name, lines: [{ productId: '', size: '', qty: 1, price: owed }], method: 'On credit', opening: true, note: `${OPENING_NOTE}: owed before ${cutoff}`, createdAt: now, updatedAt: now },
    });
    for (const p of later) {
      keepLater.add(p.id);
      ops.push({ op: 'patch', col: 'payments', id: p.id, data: { kind: 'sale', refId: id, updatedAt: now } });
    }
  }
  for (const s of oldSales) del('sales', s.id);
  for (const o of oldOrders) del('orders', o.id);
  for (const p of r.payments) {
    if (keepLater.has(p.id)) continue;
    if (p.kind !== 'advance' && oldIds.has(p.refId)) del('payments', p.id);
    else if (p.kind === 'advance' && before(p.date)) del('payments', p.id);
  }
  let aheadCarried = 0;
  for (const c of r.customers) {
    const ahead = Math.round(aheadBy.get(c.id) ?? 0);
    if (ahead <= 0) continue;
    aheadCarried += ahead;
    ops.push({ op: 'set', col: 'payments', id: newId(), data: { kind: 'advance', refId: c.id, amount: ahead, date: carryDay, method: 'Cash', note: OPENING_NOTE, createdAt: now, updatedAt: now } });
  }

  // Everything else dated before the day
  const oldPurchases = new Set(r.purchases.filter((p) => before(p.date)).map((p) => p.id));
  for (const id of oldPurchases) del('purchases', id);
  for (const p of r.payments) if (p.kind === 'purchase' && oldPurchases.has(p.refId)) del('payments', p.id);
  const oldBatches = new Set(r.batches.filter((b) => before(b.date)).map((b) => b.id));
  for (const id of oldBatches) del('batches', id);
  for (const w of r.writeOffs) if (before(w.date) || oldBatches.has(w.batchId)) del('writeOffs', w.id);
  for (const x of r.counts) if (before(x.date)) del('counts', x.id);
  for (const x of r.expenses) if (before(x.date)) del('expenses', x.id);
  for (const x of r.attendance) if (before(x.date)) del('attendance', x.id);
  for (const x of r.wages) if (before(x.date)) del('wages', x.id);
  for (const x of r.readings) if (before(x.date)) del('readings', x.id);
  for (const x of r.reminders) if (before(x.date) && (x.done || !x.repeat)) del('reminders', x.id);
  return { ops, removed, owedCarried, owedDropped, aheadCarried };
}
