// The report for a period, built from the same functions as the pages.
// Sold = counter sales on their date + orders on the day they were delivered.
// Cost of a bottle = the juice cost per litre of the batch it came from x litres + bottle, cap and label.
import { inPeriod, type Period } from './dates';
import { batchCost, bottleCost, paymentsByRef, recipeCostPerLitre, sizeOf } from './juice';
import { num, sum } from './money';
import type { Batch, BottleLine, Product, ProductKind, Records, Settings } from './types';

export interface ProductRow {
  product: Product;
  bottles: number;
  litres: number;
  sales: number;
  cost: number;
  profit: number;
}

export interface Report {
  period: Period;
  bottles: number;
  sales: number; // value of bottles sold
  deliveryFees: number;
  juiceCost: number;
  expenses: number;
  wages: number;
  spoiled: number;
  spoiledBottles: number;
  profit: number;
  rows: ProductRow[];
  kinds: { kind: ProductKind; sales: number; cost: number; bottles: number }[];
  moneyIn: number;
  byMethod: { method: string; amount: number }[];
  byChannel: { channel: string; amount: number }[];
  expenseGroups: { group: string; amount: number }[];
  litresMade: number;
  batches: number;
}

export function buildReport(r: Records, settings: Settings, period: Period, costs: Map<string, number>): Report {
  const products = new Map(r.products.map((p) => [p.id, p]));
  const batches = new Map(r.batches.map((b) => [b.id, b]));
  const customers = new Map(r.customers.map((c) => [c.id, c]));
  const perLitre = new Map<string, number>();
  const batchPerLitre = (b: Batch | undefined) => {
    if (!b) return undefined;
    let v = perLitre.get(b.id);
    if (v === undefined) perLitre.set(b.id, (v = batchCost(b, products.get(b.productId), settings.sizes, costs).perLitre));
    return v;
  };
  const lineCost = (l: BottleLine) => {
    const size = sizeOf(settings.sizes, l.size);
    const pl = batchPerLitre(l.batchId ? batches.get(l.batchId) : undefined) ?? (products.get(l.productId) ? recipeCostPerLitre(products.get(l.productId)!, costs) : 0);
    return num(l.qty) * bottleCost(pl, size);
  };

  const sold: { line: BottleLine; channel: string }[] = [];
  for (const s of r.sales) if (inPeriod(s.date, period)) for (const l of s.lines ?? []) sold.push({ line: l, channel: 'Counter' });
  let deliveryFees = 0;
  for (const o of r.orders)
    if (o.stage === 'Delivered' && inPeriod(o.deliveredOn || o.dueDate, period)) {
      const type = customers.get(o.customerId)?.type || 'Other';
      for (const l of o.packed?.length ? o.packed : o.lines.map((x) => ({ ...x }))) sold.push({ line: l, channel: `Orders: ${type}` });
      deliveryFees += num(o.deliveryFee);
    }

  const rowsMap = new Map<string, ProductRow>();
  for (const { line } of sold) {
    const p = products.get(line.productId);
    if (!p) continue;
    let row = rowsMap.get(p.id);
    if (!row) rowsMap.set(p.id, (row = { product: p, bottles: 0, litres: 0, sales: 0, cost: 0, profit: 0 }));
    row.bottles += num(line.qty);
    row.litres += num(line.qty) * num(sizeOf(settings.sizes, line.size)?.litres);
    row.sales += num(line.qty) * num(line.price);
    row.cost += lineCost(line);
  }
  const rows = [...rowsMap.values()].map((x) => ({ ...x, profit: x.sales - x.cost })).sort((a, b) => b.profit - a.profit);
  const kinds = (['single', 'cocktail'] as ProductKind[]).map((kind) => {
    const g = rows.filter((x) => x.product.kind === kind);
    return { kind, sales: sum(g, (x) => x.sales), cost: sum(g, (x) => x.cost), bottles: sum(g, (x) => x.bottles) };
  });

  const channels = new Map<string, number>();
  for (const { line, channel } of sold) channels.set(channel, (channels.get(channel) ?? 0) + num(line.qty) * num(line.price));

  const exp = r.expenses.filter((e) => inPeriod(e.date, period));
  const groups = new Map<string, number>();
  for (const e of exp) groups.set(e.category, (groups.get(e.category) ?? 0) + num(e.amount));

  const offs = r.writeOffs.filter((w) => inPeriod(w.date, period));
  const spoiled = sum(offs, (w) => {
    const b = batches.get(w.batchId);
    return lineCost({ productId: b?.productId ?? '', size: w.size, qty: w.qty, price: 0, batchId: w.batchId });
  });

  const pays = r.payments.filter((p) => (p.kind === 'order' || p.kind === 'sale') && inPeriod(p.date, period));
  const methods = new Map<string, number>();
  for (const p of pays) methods.set(p.method, (methods.get(p.method) ?? 0) + num(p.amount));

  const sales = sum(rows, (x) => x.sales);
  const juiceCost = sum(rows, (x) => x.cost);
  const expenses = sum(exp, (e) => e.amount);
  const wages = sum(r.wages.filter((w) => inPeriod(w.date, period)), (w) => w.amount);
  const made = r.batches.filter((b) => inPeriod(b.date, period));
  return {
    period,
    bottles: sum(rows, (x) => x.bottles),
    sales,
    deliveryFees,
    juiceCost,
    expenses,
    wages,
    spoiled,
    spoiledBottles: sum(offs, (w) => w.qty),
    profit: sales + deliveryFees - juiceCost - expenses - wages - spoiled,
    rows,
    kinds,
    moneyIn: sum(pays, (p) => p.amount),
    byMethod: [...methods].map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
    byChannel: [...channels].map(([channel, amount]) => ({ channel, amount })).sort((a, b) => b.amount - a.amount),
    expenseGroups: [...groups].map(([group, amount]) => ({ group, amount })).sort((a, b) => b.amount - a.amount),
    litresMade: sum(made, (b) => b.litres),
    batches: made.length,
  };
}

/** Bottles sold and money taken on one day, for Home. */
export function dayFigures(r: Records, day: string) {
  const byRef = paymentsByRef(r.payments);
  const sales = r.sales.filter((s) => s.date === day);
  const pays = r.payments.filter((p) => (p.kind === 'order' || p.kind === 'sale') && p.date === day);
  const cash = sum(pays.filter((p) => p.method === 'Cash'), (p) => p.amount);
  const delivered = r.orders.filter((o) => o.stage === 'Delivered' && o.deliveredOn === day);
  return {
    salesCount: sales.length,
    bottles: sum(sales, (s) => sum(s.lines, (l) => l.qty)) + sum(delivered, (o) => sum(o.packed ?? o.lines, (l) => l.qty)),
    soldValue: sum(sales, (s) => sum(s.lines, (l) => num(l.qty) * num(l.price))) + sum(delivered, (o) => sum(o.lines, (l) => num(l.qty) * num(l.price))),
    moneyIn: sum(pays, (p) => p.amount),
    cash,
    mobile: sum(pays, (p) => p.amount) - cash,
    byRef,
  };
}

