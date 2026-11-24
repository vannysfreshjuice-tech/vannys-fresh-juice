// The figures of the juice business, worked out from the records. Nothing here is stored.
// Pages and actions both use these functions, so a figure is worked out one way only.
import { num, sum } from './money';
import { DAY_LIST_NOTE, FROM_ADVANCE, OPENING_NOTE, type Batch, type BottleLine, type Customer, type Order, type OrderLine, type Payment, type Product, type Purchase, type RecipeLine, type Records, type Sale, type Size, type StockCount, type StockItem, type WriteOff } from './types';

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

// ---------------- recipes from real batches ----------------

/** How many of a juice's latest batches its recipe is the average of. */
export const AVERAGE_OF = 10;

/** A batch whose amounts were really measured (not a Day list count that only copied the recipe). */
export const countsForRecipe = (b: Batch) => (b.measured ?? b.note !== DAY_LIST_NOTE) && (b.used ?? []).length > 0;

/** The litres a batch gave: its bottles, or the litres made while not bottled yet. */
export function batchLitres(b: Batch, sizes: Size[]): number {
  const bottled = sum(Object.entries(b.filled ?? {}), ([k, n]) => num(n) * num(sizeOf(sizes, k)?.litres));
  return bottled > 0 ? bottled : num(b.litres);
}

export interface AverageRecipe {
  /** per 10 litres */
  recipe: RecipeLine[];
  /** water per 10 litres, or null when no batch recorded its water */
  water: number | null;
  batches: number;
  litres: number;
  last: string;
}

/**
 * Fruit is not the same size every week (Vanessa, 20 Nov 2026): a juice's recipe for 10 litres is the
 * average of its last AVERAGE_OF measured batches, weighted by the litres each gave:
 * amount = everything that went in x 10 / all their litres. An ingredient left out of a batch counts as 0 there.
 */
export function averageRecipe(productId: string, batches: Batch[], sizes: Size[], n = AVERAGE_OF): AverageRecipe | null {
  const list = batches
    .filter((b) => b.productId === productId && countsForRecipe(b) && batchLitres(b, sizes) > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || num(b.createdAt) - num(a.createdAt))
    .slice(0, n);
  if (!list.length) return null;
  const litres = sum(list, (b) => batchLitres(b, sizes));
  const totals = new Map<string, number>();
  for (const b of [...list].reverse()) for (const u of b.used ?? []) totals.set(u.itemId, (totals.get(u.itemId) ?? 0) + num(u.qty));
  const watered = list.filter((b) => typeof b.water === 'number');
  const waterLitres = sum(watered, (b) => batchLitres(b, sizes));
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return {
    recipe: [...totals].map(([itemId, q]) => ({ itemId, qty: r3((q * 10) / litres) })).filter((r) => r.qty > 0),
    water: watered.length && waterLitres > 0 ? r3((sum(watered, (b) => num(b.water)) * 10) / waterLitres) : null,
    batches: list.length,
    litres: r3(litres),
    last: list[0].date,
  };
}

// ---------------- prices and costs ----------------

export const sizeOf = (sizes: Size[], key: string) => sizes.find((s) => s.key === key);
export const litresOf = (sizes: Size[], key: string) => num(sizeOf(sizes, key)?.litres);

export function priceOf(product: Product | undefined, size: Size | undefined): number {
  if (!size) return 0;
  // One price per size for every juice (Denis, 16 Nov 2026: no more premium price).
  void product;
  return num(size.price);
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

export interface BatchLeft {
  batch: Batch;
  left: Record<string, number>;
  total: number;
}

export interface FridgeFlow {
  byBatch: Map<string, BatchLeft>;
  /** Bottles sold without a batch that came off a batch recorded for that day or before (often added later) */
  matched: { date: string; qty: number }[];
  /** Bottles sold with no bottles made recorded for them at all */
  unmatched: { date: string; qty: number; productId: string; size: string }[];
  /** Every bottle that came off a batch, by day: sold (counter or order) or written off */
  taken: { date: string; qty: number; spoiled: boolean }[];
}

/**
 * The fridge, day by day: every bottle that left it (sold, packed for an order, written off), in date
 * order. A bottle that names its batch comes off that batch. A bottle sold without a batch (sold before
 * the bottles made were recorded, e.g. production written in later in the day) comes off the batches of
 * the same juice and size made on that day or before, nearest best-before first, so recording the
 * bottles later does not add them to the fridge a second time (Vanessa, 20 Nov 2026).
 */
export function fridgeFlow(batches: Batch[], sales: Sale[], orders: Order[], writeOffs: WriteOff[]): FridgeFlow {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const left = new Map<string, Record<string, number>>();
  for (const b of batches) {
    const l: Record<string, number> = {};
    for (const [k, n] of Object.entries(b.filled ?? {})) l[k] = Math.max(0, num(n));
    left.set(b.id, l);
  }
  const outs: { date: string; at: number; batchId?: string; productId: string; size: string; qty: number; spoiled?: boolean }[] = [];
  for (const s of sales) {
    if (s.opening) continue;
    for (const l of s.lines ?? []) if (l.productId) outs.push({ date: s.date, at: num(s.createdAt), batchId: l.batchId, productId: l.productId, size: l.size, qty: num(l.qty) });
  }
  for (const o of orders) {
    if (o.stage === 'Cancelled') continue;
    for (const l of o.packed ?? []) outs.push({ date: o.deliveredOn || o.dueDate, at: num(o.createdAt), batchId: l.batchId, productId: l.productId, size: l.size, qty: num(l.qty) });
  }
  for (const w of writeOffs) outs.push({ date: w.date, at: num(w.createdAt), batchId: w.batchId, productId: byId.get(w.batchId)?.productId ?? '', size: w.size, qty: num(w.qty), spoiled: true });
  outs.sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.at - b.at);
  const oldestFirst = [...batches].sort((a, b) => (a.bestBefore || '').localeCompare(b.bestBefore || '') || (a.date || '').localeCompare(b.date || '') || (a.number || '').localeCompare(b.number || ''));
  const matched: FridgeFlow['matched'] = [];
  const unmatched: FridgeFlow['unmatched'] = [];
  const taken: FridgeFlow['taken'] = [];
  for (const o of outs) {
    let need = o.qty;
    if (o.batchId) {
      const l = left.get(o.batchId);
      const t = l && l[o.size] !== undefined ? Math.min(o.qty, l[o.size]) : 0;
      if (t > 0) {
        l![o.size] -= t;
        taken.push({ date: o.date, qty: t, spoiled: !!o.spoiled });
      }
      need -= t;
      // A written-off bottle belongs to its batch only. A sold bottle whose batch is already empty (its
      // bottles were changed after) is matched to other bottles like a sale without a batch, never dropped.
      if (need <= 0 || o.spoiled) continue;
    }
    const wanted = need;
    for (const b of oldestFirst) {
      if (need <= 0) break;
      if (b.productId !== o.productId || b.date > o.date) continue;
      const l = left.get(b.id)!;
      const take = Math.min(need, l[o.size] ?? 0);
      if (take > 0) {
        l[o.size] -= take;
        need -= take;
      }
    }
    if (wanted - need > 0) {
      matched.push({ date: o.date, qty: wanted - need });
      taken.push({ date: o.date, qty: wanted - need, spoiled: false });
    }
    if (need > 0 && !o.spoiled) unmatched.push({ date: o.date, qty: need, productId: o.productId, size: o.size });
  }
  const byBatch = new Map<string, BatchLeft>();
  for (const b of batches) {
    const l = left.get(b.id)!;
    byBatch.set(b.id, { batch: b, left: l, total: sum(Object.values(l), (v) => v) });
  }
  return { byBatch, matched, unmatched, taken };
}

/** Bottles still in the fridge for each batch. */
export function fridgeByBatch(batches: Batch[], sales: Sale[], orders: Order[], writeOffs: WriteOff[]): Map<string, BatchLeft> {
  return fridgeFlow(batches, sales, orders, writeOffs).byBatch;
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
/**
 * strict (Settings: "Sell only bottles recorded in the fridge"): refuse when the batches do not hold enough.
 * Not strict: take what the batches hold, oldest first, and sell the rest without a batch (production not recorded).
 */
export function takeFromFridge(byBatch: Map<string, BatchLeft>, wanted: OrderLine[], productName: (id: string) => string, sizeLabel: (k: string) => string, strict = true, day?: string): BottleLine[] {
  // A working copy, so two lines for the same juice and size do not take the same bottles.
  const left = new Map([...byBatch].map(([id, bl]) => [id, { ...bl.left }]));
  const ordered = [...byBatch.values()].sort((a, b) => (a.batch.bestBefore || '').localeCompare(b.batch.bestBefore || '') || a.batch.number.localeCompare(b.batch.number));
  const out: BottleLine[] = [];
  for (const w of wanted) {
    let need = num(w.qty);
    for (const bl of ordered) {
      if (need <= 0) break;
      if (bl.batch.productId !== w.productId) continue;
      // a sale written in for an earlier day cannot take bottles made after it (audit, 24 Nov 2026)
      if (day && bl.batch.date > day) continue;
      const here = left.get(bl.batch.id)!;
      const take = Math.min(need, here[w.size] ?? 0);
      if (take > 0) {
        here[w.size] -= take;
        need -= take;
        out.push({ productId: w.productId, size: w.size, qty: take, price: num(w.price), batchId: bl.batch.id });
      }
    }
    if (need > 0 && !strict) out.push({ productId: w.productId, size: w.size, qty: need, price: num(w.price) });
    else if (need > 0) {
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

/**
 * Takes a discount off the bottles of a sale, from the last bottle back: a bottle comes off its line
 * into its own line at the lower price (never below 0), so the total drops by exactly the discount
 * and every price stays a whole number. 3 x 3,000 less 2,000 = 2 x 3,000 + 1 x 1,000.
 */
export function applyDiscount<L extends { qty: number; price: number; fullPrice?: number }>(lines: L[], discount: number): L[] {
  let left = Math.max(0, Math.round(num(discount)));
  if (!left) return lines;
  const out = lines.map((l) => ({ ...l }));
  for (let i = out.length - 1; i >= 0 && left > 0; i--) {
    while (left > 0 && num(out[i].qty) > 0 && num(out[i].price) > 0) {
      const price = num(out[i].price);
      const off = Math.min(left, price);
      left -= off;
      out[i].qty = num(out[i].qty) - 1;
      out.splice(i + 1, 0, { ...out[i], qty: 1, price: price - off, fullPrice: out[i].fullPrice ?? price });
    }
  }
  return out.filter((l) => num(l.qty) > 0);
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

/**
 * Money each customer paid ahead and has not used yet: what they paid ahead (payments of kind 'advance')
 * minus what their sales and orders took from it (payments made "From money paid ahead").
 */
export function customerAdvances(customers: Customer[], orders: Order[], sales: Sale[], payments: Payment[]): Map<string, number> {
  const out = new Map<string, number>(customers.map((c) => [c.id, 0]));
  const owner = new Map<string, string>();
  for (const s of sales) if (s.customerId) owner.set(s.id, s.customerId);
  for (const o of orders) if (o.customerId) owner.set(o.id, o.customerId);
  for (const p of payments) {
    if (p.kind === 'advance') out.set(p.refId, (out.get(p.refId) ?? 0) + num(p.amount));
    else if (p.method === FROM_ADVANCE) {
      const c = owner.get(p.refId);
      if (c) out.set(c, (out.get(c) ?? 0) - num(p.amount));
    }
  }
  return out;
}

export interface AdvanceRow {
  date: string;
  /** + money paid ahead, - bottles paid from it */
  amount: number;
  /** the payment (money in) or the sale / order it paid for */
  paymentId: string;
  refId: string;
  kind: 'in' | 'out';
  method: string;
  note: string;
  /** money paid ahead left after this line */
  balance: number;
}

/**
 * One customer's money paid ahead, line by line in date order: each amount paid ahead, each bottle (sale
 * or order) paid from it, and what was left after each. The last balance is customerAdvances' figure.
 */
export function advanceHistory(customerId: string, orders: Order[], sales: Sale[], payments: Payment[]): AdvanceRow[] {
  const mine = new Set<string>();
  for (const s of sales) if (s.customerId === customerId) mine.add(s.id);
  for (const o of orders) if (o.customerId === customerId) mine.add(o.id);
  const rows = payments
    .filter((p) => (p.kind === 'advance' && p.refId === customerId) || (p.method === FROM_ADVANCE && mine.has(p.refId)))
    .map((p) => ({ p, at: num(p.createdAt) }))
    .sort((a, b) => a.p.date.localeCompare(b.p.date) || a.at - b.at);
  let balance = 0;
  return rows.map(({ p }) => {
    const amount = p.kind === 'advance' ? num(p.amount) : -num(p.amount);
    balance += amount;
    return { date: p.date, amount, paymentId: p.id, refId: p.refId, kind: p.kind === 'advance' ? 'in' : 'out', method: p.method, note: p.note ?? '', balance };
  });
}

/** Money paid ahead left at the end of a day, for each customer (the Day list on a past day). */
export function advancesAsOf(customers: Customer[], orders: Order[], sales: Sale[], payments: Payment[], day: string): Map<string, number> {
  return customerAdvances(
    customers,
    orders,
    sales,
    payments.filter((p) => p.date <= day),
  );
}

export interface Debt {
  kind: 'sale' | 'order';
  id: string;
  number: string;
  date: string;
  balance: number;
}

/** What one customer still owes, oldest first: credit sales by their date, orders by their delivery day. */
export function debtsOf(customerId: string, orders: Order[], sales: Sale[], byRef: Map<string, Payment[]>): Debt[] {
  const out: (Debt & { at: number })[] = [];
  for (const s of sales) {
    if (s.customerId !== customerId) continue;
    const b = saleTotals(s, byRef.get(s.id)).balance;
    if (b > 0) out.push({ kind: 'sale', id: s.id, number: s.number, date: s.date, balance: b, at: s.createdAt });
  }
  for (const o of orders) {
    if (o.customerId !== customerId) continue;
    const b = orderTotals(o, byRef.get(o.id)).balance;
    if (b > 0) out.push({ kind: 'order', id: o.id, number: o.number, date: o.deliveredOn || o.dueDate, balance: b, at: o.createdAt });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at).map(({ at: _at, ...d }) => d);
}

/** Money that really came in: payments for sales and orders, except those taken from money paid ahead, plus money paid ahead. */
export const isMoneyIn = (p: Payment) => p.note !== OPENING_NOTE && (p.kind === 'advance' || ((p.kind === 'order' || p.kind === 'sale') && p.method !== FROM_ADVANCE));

export function supplierOwed(r: Pick<Records, 'purchases' | 'suppliers'>, byRef: Map<string, Payment[]>): Map<string, number> {
  const out = new Map<string, number>(r.suppliers.map((s) => [s.id, 0]));
  for (const p of r.purchases) if (p.supplierId) out.set(p.supplierId, (out.get(p.supplierId) ?? 0) + purchaseTotals(p, byRef.get(p.id)).balance);
  return out;
}
