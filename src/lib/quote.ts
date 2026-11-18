// Event quotes (weddings, parties, meetings): guests -> bottles -> juice, fruit, cost, price, profit.
// Nothing is saved until the quote is turned into an order.
import { bottleCost, recipeCostPerLitre, sizeOf } from './juice';
import { num } from './money';
import type { ItemLevel } from './juice';
import type { Product, Size, StockItem } from './types';

export interface QuoteInput {
  guests: number;
  perGuest: number;
  size: string;
  productIds: string[];
  /** the event price of one bottle */
  price: number;
  deliveryFee: number;
}

export interface QuoteResult {
  bottles: number;
  litres: number;
  /** bottles of each juice: shared out as evenly as possible, the first juices take any one left over */
  perJuice: { product: Product; bottles: number; litres: number }[];
  /** fruit and ingredients the recipes need, against what is in Stock */
  needs: { item: StockItem; need: number; have: number; short: number }[];
  cost: number;
  value: number;
  total: number;
  profit: number;
  deposit: number;
  /** juices with no recipe: their fruit is missing from the needs and the cost */
  noRecipe: string[];
}

export function eventQuote(q: QuoteInput, products: Product[], items: StockItem[], sizes: Size[], costs: Map<string, number>, levels: Map<string, ItemLevel>): QuoteResult {
  const size = sizeOf(sizes, q.size);
  const litresEach = num(size?.litres);
  const bottles = Math.max(0, Math.ceil(num(q.guests) * Math.max(0, num(q.perGuest))));
  const chosen = q.productIds.map((id) => products.find((p) => p.id === id)).filter((p): p is Product => !!p);
  const n = chosen.length || 1;
  const base = Math.floor(bottles / n);
  const extra = bottles - base * n;
  const perJuice = chosen.map((product, i) => {
    const b = base + (i < extra ? 1 : 0);
    return { product, bottles: b, litres: Math.round(b * litresEach * 1000) / 1000 };
  });
  const need = new Map<string, number>();
  let cost = 0;
  for (const pj of perJuice) {
    for (const r of pj.product.recipe ?? []) need.set(r.itemId, (need.get(r.itemId) ?? 0) + (num(r.qty) * pj.litres) / 10);
    cost += pj.bottles * bottleCost(recipeCostPerLitre(pj.product, costs), size);
  }
  if (!chosen.length) cost = bottles * num(size?.packCost);
  const needs = [...need]
    .map(([id, amount]) => {
      const item = items.find((i) => i.id === id);
      const have = Math.max(0, levels.get(id)?.onHand ?? 0);
      const rounded = Math.ceil(amount * 10) / 10;
      return item ? { item, need: rounded, have, short: Math.max(0, Math.ceil((rounded - have) * 10) / 10) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
  const value = bottles * Math.max(0, num(q.price));
  const total = value + Math.max(0, num(q.deliveryFee));
  return {
    bottles,
    litres: Math.round(bottles * litresEach * 1000) / 1000,
    perJuice,
    needs,
    cost: Math.round(cost),
    value,
    total,
    profit: Math.round(total - cost),
    deposit: Math.ceil(total / 2 / 1000) * 1000,
    noRecipe: chosen.filter((p) => !(p.recipe ?? []).length).map((p) => p.name),
  };
}
