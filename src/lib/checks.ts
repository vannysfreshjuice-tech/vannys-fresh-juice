// "Not balanced yet": things in the records that do not add up, each with what fixes it (Vanessa,
// 20 Nov 2026: things are sometimes recorded late or forgotten; show what does not balance and let her
// put it right). Worked out from the records only; nothing is stored.
import { fridgeFlow, type ItemLevel } from './juice';
import { num, sum } from './money';
import type { Batch, Order, Sale, StockItem, WriteOff } from './types';

export type CheckFix =
  | { kind: 'buy'; itemId: string; date?: string }
  | { kind: 'count'; itemId: string }
  | { kind: 'made'; productId: string; date: string }
  | { kind: 'bottle'; batchId: string }
  | { kind: 'whatWentIn'; productId: string; date: string };

export interface Check {
  key: string;
  what: 'stock' | 'sold' | 'bottling' | 'fruit';
  /** the day it is about (newest first in the list) */
  date: string;
  fixes: CheckFix[];
  /** figures for the wording */
  itemId?: string;
  productId?: string;
  size?: string;
  qty: number;
  used?: number;
  had?: number;
  batchId?: string;
}

/**
 * - stock: an item's batches used more than was bought and counted (e.g. 11 mangoes in a batch, 8 bought):
 *   record the purchase (on the day it was bought) or count it.
 * - sold: bottles sold with no bottles made recorded for them (from the first batch on): add the bottles made.
 * - bottling: a batch from before today still not bottled: fill the bottles.
 * - fruit: bottles made with nothing recorded about what went in (a juice with no recipe): record it.
 */
export function balanceChecks(input: { items: StockItem[]; levels: Map<string, ItemLevel>; batches: Batch[]; sales: Sale[]; orders: Order[]; writeOffs: WriteOff[]; today: string }): Check[] {
  const { items, levels, batches, sales, orders, writeOffs, today } = input;
  const out: Check[] = [];
  for (const it of items) {
    const l = levels.get(it.id);
    if (!l || l.onHand > -0.001) continue;
    // the day it went short: the latest batch that used it
    const lastUse = batches.filter((b) => (b.used ?? []).some((u) => u.itemId === it.id)).reduce((m, b) => (b.date > m ? b.date : m), '');
    out.push({ key: `stock|${it.id}`, what: 'stock', date: lastUse || today, itemId: it.id, qty: Math.round(-l.onHand * 1000) / 1000, used: l.used, had: Math.round((l.bought + l.counted) * 1000) / 1000, fixes: [{ kind: 'buy', itemId: it.id, date: lastUse || today }, { kind: 'count', itemId: it.id }] });
  }
  const firstBatch = batches.reduce((m, b) => (!m || b.date < m ? b.date : m), '');
  if (firstBatch) {
    const flow = fridgeFlow(batches, sales, orders, writeOffs);
    const sold = new Map<string, Check>();
    for (const u of flow.unmatched) {
      if (u.date < firstBatch || !u.productId) continue;
      const key = `sold|${u.date}|${u.productId}|${u.size}`;
      const c = sold.get(key);
      if (c) c.qty += u.qty;
      else sold.set(key, { key, what: 'sold', date: u.date, productId: u.productId, size: u.size, qty: u.qty, fixes: [{ kind: 'made', productId: u.productId, date: u.date }] });
    }
    out.push(...sold.values());
  }
  for (const b of batches) {
    const bottles = sum(Object.values(b.filled ?? {}), (n) => num(n));
    if (bottles === 0 && b.date < today) out.push({ key: `bottling|${b.id}`, what: 'bottling', date: b.date, productId: b.productId, batchId: b.id, qty: num(b.litres), fixes: [{ kind: 'bottle', batchId: b.id }] });
    else if (bottles > 0 && !(b.used ?? []).length) out.push({ key: `fruit|${b.id}`, what: 'fruit', date: b.date, productId: b.productId, batchId: b.id, qty: bottles, fixes: [{ kind: 'whatWentIn', productId: b.productId, date: b.date }] });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}
