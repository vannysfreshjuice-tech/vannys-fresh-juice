// The figures of the juice business, worked out from the records. Nothing here is stored.
// Pages and actions both use these functions, so a figure is worked out one way only.
import { num, sum } from './money';
import type { Batch, BottleLine, Customer, Order, OrderLine, Payment, Product, Purchase, Records, Sale, Size, StockCount, StockItem, WriteOff } from './types';

export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** BA-0007 -> next is BA-0008. Works from the highest number used so far. */
export function nextNumber(prefix: string, used: string[]): string {
  let max = 0;
  for (const u of used) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(u ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// ---------------- prices and costs ----------------

export const sizeOf = (sizes: Size[], key: string) => sizes.find((s) => s.key === key);
export const litresOf = (sizes: Size[], key: string) => num(sizeOf(sizes, key)?.litres);

export function priceOf(product: Product | undefined, size: Size | undefined): number {
  if (!size) return 0;
  return product?.premium ? num(size.premiumPrice) || num(size.price) : num(size.price);
}

/** Average cost of one unit of each stock item, over everything ever bought. */
export function averageCosts(purchases: Purchase[]): Map<string, number> {
  const qty = new Map<string, number>();
  const spent = new Map<string, number>();
  for (const p of purchases) {
    qty.set(p.itemId, (qty.get(p.itemId) ?? 0) + num(p.qty));
    spent.set(p.itemId, (spent.get(p.itemId) ?? 0) + num(p.qty) * num(p.price));
  }
  const out = new Map<string, number>();
  for (const [id, q] of qty) out.set(id, q > 0 ? (spent.get(id) ?? 0) / q : 0);
  return out;
}

/** The price paid the last time each item was bought (recipes use this: "today's fruit prices"). */
export function latestCosts(purchases: Purchase[]): Map<string, number> {
  const out = new Map<string, { date: string; at: number; price: number }>();
  for (const p of purchases) {
    const prev = out.get(p.itemId);
    if (!prev || p.date > prev.date || (p.date === prev.date && p.createdAt > prev.at)) out.set(p.itemId, { date: p.date, at: p.createdAt, price: num(p.price) });
  }
  return new Map([...out].map(([k, v]) => [k, v.price]));
}

/** Juice cost of 1 litre from a recipe (per 10 litres) and unit costs. */
export function recipeCostPerLitre(product: Product, costs: Map<string, number>): number {
  return sum(product.recipe ?? [], (r) => num(r.qty) * (costs.get(r.itemId) ?? 0)) / 10;
}

/** What a bottle costs: the juice in it plus bottle, cap and label. */
export function bottleCost(perLitre: number, size: Size | undefined): number {
  if (!size) return 0;
  return perLitre * num(size.litres) + num(size.packCost);
}

export interface BatchCost {
  juice: number;
  packaging: number;
  total: number;
  perLitre: number;
  /** What the bottles would bring in if all are sold */
  salesValue: number;
}

export function batchCost(b: Batch, product: Product | undefined, sizes: Size[], costs: Map<string, number>): BatchCost {
  const juice = sum(b.used ?? [], (u) => num(u.qty) * (costs.get(u.itemId) ?? 0));
  const packaging = sum(Object.entries(b.filled ?? {}), ([k, n]) => num(n) * num(sizeOf(sizes, k)?.packCost));
  const salesValue = sum(Object.entries(b.filled ?? {}), ([k, n]) => num(n) * priceOf(product, sizeOf(sizes, k)));
  return { juice, packaging, total: juice + packaging, perLitre: num(b.litres) > 0 ? juice / num(b.litres) : 0, salesValue };
}

export const bottledLitres = (b: Batch, sizes: Size[]) => sum(Object.entries(b.filled ?? {}), ([k, n]) => num(n) * litresOf(sizes, k));

// ---------------- stock of fruit and packaging ----------------

export interface ItemLevel {
  bought: number;
  used: number;
  counted: number;
  onHand: number;
  low: boolean;
}

export function itemLevels(items: StockItem[], purchases: Purchase[], batches: Batch[], counts: StockCount[], sizes: Size[], perBottle: string[] = []): Map<string, ItemLevel> {
  const out = new Map<string, ItemLevel>();
  for (const i of items) out.set(i.id, { bought: 0, used: 0, counted: 0, onHand: 0, low: false });
  const at = (id: string) => {
    let l = out.get(id);
    if (!l) out.set(id, (l = { bought: 0, used: 0, counted: 0, onHand: 0, low: false }));
    return l;
  };
  for (const p of purchases) at(p.itemId).bought += num(p.qty);
  for (const b of batches) {
    for (const u of b.used ?? []) at(u.itemId).used += num(u.qty);
    for (const [k, n] of Object.entries(b.filled ?? {})) {
      const bottle = sizeOf(sizes, k)?.bottleItemId;
      if (bottle) at(bottle).used += num(n);
      for (const each of perBottle) if (each && each !== bottle) at(each).used += num(n);
    }
  }
  for (const c of counts) at(c.itemId).counted += num(c.qty);
  for (const i of items) {
    const l = at(i.id);
    l.onHand = Math.round((l.bought - l.used + l.counted) * 1000) / 1000;
    l.low = l.onHand < num(i.reorderLevel);
  }
  return out;
}

// ---------------- the fridge ----------------

/** Every bottle that has left the fridge, by batch and size: sold, packed for an order, or written off. */
function takenByBatch(sales: Sale[], orders: Order[], writeOffs: WriteOff[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  const add = (batchId: string | undefined, size: string, qty: number) => {
    if (!batchId) return;
    let m = out.get(batchId);
    if (!m) out.set(batchId, (m = new Map()));
    m.set(size, (m.get(size) ?? 0) + num(qty));
  };
  for (const s of sales) for (const l of s.lines ?? []) add(l.batchId, l.size, l.qty);
  for (const o of orders) if (o.stage !== 'Cancelled') for (const l of o.packed ?? []) add(l.batchId, l.size, l.qty);
  for (const w of writeOffs) add(w.batchId, w.size, w.qty);
  return out;
}

export interface BatchLeft {
  batch: Batch;
  left: Record<string, number>;
  total: number;
}

/** Bottles still in the fridge for each batch. */
export function fridgeByBatch(batches: Batch[], sales: Sale[], orders: Order[], writeOffs: WriteOff[]): Map<string, BatchLeft> {
  const taken = takenByBatch(sales, orders, writeOffs);
  const out = new Map<string, BatchLeft>();
  for (const b of batches) {
    const left: Record<string, number> = {};
    let total = 0;
    for (const [k, n] of Object.entries(b.filled ?? {})) {
      const v = Math.max(0, num(n) - (taken.get(b.id)?.get(k) ?? 0));
      left[k] = v;
      total += v;
    }
    out.set(b.id, { batch: b, left, total });
  }
  return out;
}

export type BatchStatus = 'Making' | 'In the fridge' | 'Finished';

export function batchStatus(b: Batch, left: BatchLeft | undefined): BatchStatus {
  if (!Object.values(b.filled ?? {}).some((n) => num(n) > 0)) return 'Making';
  return (left?.total ?? 0) > 0 ? 'In the fridge' : 'Finished';
}

/** Bottles in the fridge for one juice and size (all batches). */
export function fridgeCount(byBatch: Map<string, BatchLeft>, productId: string, size: string): number {
  let n = 0;
  for (const bl of byBatch.values()) if (bl.batch.productId === productId) n += bl.left[size] ?? 0;
  return n;
}

export function fridgeTotal(byBatch: Map<string, BatchLeft>, productId?: string): number {
  let n = 0;
  for (const bl of byBatch.values()) if (!productId || bl.batch.productId === productId) n += bl.total;
  return n;
}

/**
 * Takes bottles from the batches with the nearest best-before first.
 * Returns the lines with their batch, or throws a plain message when the fridge has too few.
 */
export function takeFromFridge(byBatch: Map<string, BatchLeft>, wanted: OrderLine[], productName: (id: string) => string, sizeLabel: (k: string) => string): BottleLine[] {
  // A working copy, so two lines for the same juice and size do not take the same bottles.
  const left = new Map([...byBatch].map(([id, bl]) => [id, { ...bl.left }]));
  const ordered = [...byBatch.values()].sort((a, b) => (a.batch.bestBefore || '').localeCompare(b.batch.bestBefore || '') || a.batch.number.localeCompare(b.batch.number));
  const out: BottleLine[] = [];
  for (const w of wanted) {
    let need = num(w.qty);
    for (const bl of ordered) {
      if (need <= 0) break;
      if (bl.batch.productId !== w.productId) continue;
      const here = left.get(bl.batch.id)!;
      const take = Math.min(need, here[w.size] ?? 0);
      if (take > 0) {
        here[w.size] -= take;
        need -= take;
        out.push({ productId: w.productId, size: w.size, qty: take, price: num(w.price), batchId: bl.batch.id });
      }
    }
    if (need > 0) {
      const have = num(w.qty) - need;
      throw new Error(`Only ${have} × ${productName(w.productId)} ${sizeLabel(w.size)} in the fridge.`);
    }
  }
  return out;
}

// ---------------- money owed ----------------

export function paymentsByRef(payments: Payment[]): Map<string, Payment[]> {
  const m = new Map<string, Payment[]>();
  for (const p of payments) {
    const list = m.get(p.refId);
    if (list) list.push(p);
    else m.set(p.refId, [p]);
  }
  return m;
}

export type PayStatus = 'Paid' | 'Part paid' | 'Not paid';

export interface Totals {
  value: number;
  paid: number;
  balance: number;
  status: PayStatus;
}

function totals(value: number, paid: number, closed = false): Totals {
  const balance = closed ? 0 : Math.max(0, value - paid);
  return { value, paid, balance, status: balance <= 0 ? 'Paid' : paid > 0 ? 'Part paid' : 'Not paid' };
}

export const linesValue = (lines: { qty: number; price: number }[]) => sum(lines ?? [], (l) => num(l.qty) * num(l.price));
export const orderValue = (o: Pick<Order, 'lines' | 'deliveryFee'>) => linesValue(o.lines) + num(o.deliveryFee);

export function orderTotals(o: Order, pays: Payment[] | undefined): Totals {
  return totals(orderValue(o), sum(pays ?? [], (p) => p.amount), o.stage === 'Cancelled');
}

export function saleTotals(s: Sale, pays: Payment[] | undefined): Totals {
  return totals(linesValue(s.lines), sum(pays ?? [], (p) => p.amount));
}

export function purchaseTotals(p: Purchase, pays: Payment[] | undefined): Totals {
  return totals(num(p.qty) * num(p.price), sum(pays ?? [], (x) => x.amount));
}

/** What each customer owes: the balance of each of their orders and credit sales, added up. */
export function customerBalances(customers: Customer[], orders: Order[], sales: Sale[], byRef: Map<string, Payment[]>): Map<string, number> {
  const out = new Map<string, number>(customers.map((c) => [c.id, 0]));
  for (const o of orders) if (o.customerId) out.set(o.customerId, (out.get(o.customerId) ?? 0) + orderTotals(o, byRef.get(o.id)).balance);
  for (const s of sales) if (s.customerId) out.set(s.customerId, (out.get(s.customerId) ?? 0) + saleTotals(s, byRef.get(s.id)).balance);
  return out;
}

export function supplierOwed(r: Pick<Records, 'purchases' | 'suppliers'>, byRef: Map<string, Payment[]>): Map<string, number> {
  const out = new Map<string, number>(r.suppliers.map((s) => [s.id, 0]));
  for (const p of r.purchases) if (p.supplierId) out.set(p.supplierId, (out.get(p.supplierId) ?? 0) + purchaseTotals(p, byRef.get(p.id)).balance);
  return out;
}
