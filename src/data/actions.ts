// Every save in the app goes through this file, so each rule lives in one place:
// - a new record is written whole; an edit changes only the fields of its form (nothing else is wiped);
// - things that belong together are saved together (a sale with its payment, an order with its
//   deposit and reminders, a delete with its payments);
// - amounts are cleaned once here (whole shillings, above zero);
// - bottles leave the fridge only here, oldest best-before first.
// A refused action throws an Error whose message is plain words for the screen.
import { addDays, todayYmd } from '../lib/dates';
import { applyDiscount, averageRecipe, countsForRecipe, customerAdvances, debtsOf, fridgeByBatch, linesValue, nextNumber, orderTotals, orderValue, paymentsByRef, purchaseTotals, sameName, saleTotals, sizeOf, takeFromFridge } from '../lib/juice';
import { cleanAmount, cleanQty, money, num, sum } from '../lib/money';
import { DAY_LIST_NOTE, FROM_ADVANCE } from '../lib/types';
import type {
  Batch,
  Customer,
  Expense,
  FridgeReading,
  Order,
  OrderLine,
  OrderStage,
  PaymentKind,
  Product,
  RecipeLine,
  Records,
  Reminder,
  Settings,
  Size,
  Staff,
  StockItem,
  WagePayment,
} from '../lib/types';
import { accessRemoval, newId, type Op, type Store } from './store';
import { startAgainPlan } from '../lib/startAgain';

type Input<T> = Omit<T, 'id' | 'createdAt' | 'updatedAt'>;
export interface PaidNow {
  amount: number;
  method: string;
}
export interface Current {
  records: Records;
  settings: Settings;
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const need = (ok: unknown, message: string) => {
  if (!ok) throw new Error(message);
};

export function makeActions(store: Store, now: () => Current) {
  const cur = () => now().records;
  const created = () => ({ createdAt: Date.now(), updatedAt: Date.now() });
  const touched = () => ({ updatedAt: Date.now() });
  const save = (col: Op['col'], id: string | undefined, data: Record<string, unknown>, extra: Record<string, unknown> = {}): { op: Op; id: string } => {
    const rid = id ?? newId();
    return { id: rid, op: id ? { op: 'patch', col, id: rid, data: { ...data, ...touched() } } : { op: 'set', col, id: rid, data: { ...data, ...extra, ...created() } } };
  };
  const productName = (id: string) => cur().products.find((p) => p.id === id)?.name ?? 'that juice';
  const sizeLabel = (k: string) => sizeOf(now().settings.sizes, k)?.label ?? k;
  const fridge = () => fridgeByBatch(cur().batches, cur().sales, cur().orders, cur().writeOffs);
  const paymentsOf = (refId: string) => cur().payments.filter((p) => p.refId === refId && p.kind !== 'advance');
  const advanceLeft = (customerId: string) => customerAdvances(cur().customers, cur().orders, cur().sales, cur().payments).get(customerId) ?? 0;
  const paymentOp = (kind: PaymentKind, refId: string, amount: number, date: string, method: string, note = ''): Op => ({
    op: 'set',
    col: 'payments',
    id: newId(),
    data: { kind, refId, amount, date, method: method || 'Cash', note, ...created() },
  });

  /** Finds the customer with that name, or adds one. Returns '' for a blank name (walk-in). */
  function resolveCustomer(ops: Op[], name: string, type = 'Person', phone = ''): string {
    const n = text(name);
    if (!n || sameName(n, 'Walk-in')) return '';
    const found = cur().customers.find((c) => sameName(c.name, n));
    if (found) {
      if (found.archived) ops.push({ op: 'patch', col: 'customers', id: found.id, data: { archived: false, ...touched() } });
      return found.id;
    }
    const id = newId();
    ops.push({ op: 'set', col: 'customers', id, data: { name: n, type, phone: text(phone), place: '', notes: '', archived: false, ...created() } });
    return id;
  }

  function cleanOrderLines(lines: OrderLine[]): OrderLine[] {
    const merged = new Map<string, OrderLine>();
    for (const l of lines) {
      const qty = Math.round(num(l.qty));
      if (!l.productId || !l.size || qty <= 0) continue;
      const k = `${l.productId}|${l.size}`;
      const prev = merged.get(k);
      if (prev) prev.qty += qty;
      else merged.set(k, { productId: l.productId, size: l.size, qty, price: cleanAmount(l.price) });
    }
    return [...merged.values()];
  }

  /**
   * After buying a packaging item: link it to its bottle size if it is a bottle not linked yet, and
   * set the cost of each size that uses it (its bottle, or a cap / label every bottle uses) to the
   * latest prices paid: bottle + caps + labels. Returns the new sizes, or null when nothing changes.
   */
  function bottleSizesAfterPurchase(itemId: string, bought: { date: string; price: number; createdAt: number }): Size[] | null {
    const st = now().settings;
    const item = cur().items.find((i) => i.id === itemId);
    if (!item || item.kind !== 'packaging') return null;
    let sizes = linkBottle(st.sizes, item.id, item.name) ?? st.sizes;
    const latest = new Map<string, { date: string; at: number; price: number }>();
    for (const p of [...cur().purchases, { itemId, ...bought }]) {
      const prev = latest.get(p.itemId);
      if (!prev || p.date > prev.date || (p.date === prev.date && p.createdAt >= prev.at)) latest.set(p.itemId, { date: p.date, at: p.createdAt, price: num(p.price) });
    }
    const priceOfItem = (id: string) => latest.get(id)?.price;
    const touchesAll = st.perBottle.includes(itemId);
    let changed = sizes !== st.sizes;
    sizes = sizes.map((z) => {
      if (!z.bottleItemId || (z.bottleItemId !== itemId && !touchesAll)) return z;
      const bottle = priceOfItem(z.bottleItemId);
      if (bottle === undefined) return z;
      const extras = st.perBottle.filter((x) => x && x !== z.bottleItemId).reduce((t, x) => t + (priceOfItem(x) ?? 0), 0);
      const packCost = Math.round(bottle + extras);
      if (packCost === z.packCost) return z;
      changed = true;
      return { ...z, packCost };
    });
    return changed ? sizes : null;
  }

  /** The changes that save a juice whose recipe lines are given by name (new names are added to Stock). */
  function productOps(input: Omit<Input<Product>, 'recipe'>, lines: RecipeByName[], id: string | undefined, noQty: (name: string) => string) {
    const name = text(input.name);
    need(name, 'Type the name of the juice.');
    const clash = cur().products.find((p) => p.id !== id && sameName(p.name, name));
    need(!clash, `There is already a juice called ${clash?.name}.`);
    const ops: Op[] = [];
    const recipe: RecipeLine[] = [];
    const itemIds = new Map<string, string>();
    for (const l of lines) {
      const n = text(l.name);
      const qty = cleanQty(l.qty);
      if (!n) continue;
      need(qty > 0, noQty(n));
      let itemId = cur().items.find((i) => sameName(i.name, n))?.id ?? itemIds.get(n.toLowerCase());
      if (!itemId) {
        itemId = newId();
        ops.push({ op: 'set', col: 'items', id: itemId, data: { name: n, kind: 'fruit', unit: text(l.unit) || 'pcs', reorderLevel: 0, archived: false, ...created() } });
      } else {
        const item = cur().items.find((i) => i.id === itemId);
        if (item?.archived) ops.push({ op: 'patch', col: 'items', id: itemId, data: { archived: false, ...touched() } });
      }
      itemIds.set(n.toLowerCase(), itemId);
      const prev = recipe.find((r) => r.itemId === itemId);
      if (prev) prev.qty = Math.round((prev.qty + qty) * 1000) / 1000;
      else recipe.push({ itemId, qty });
    }
    const data = {
      name,
      kind: input.kind === 'cocktail' ? 'cocktail' : 'single',
      icon: text(input.icon) || '🥤',
      colour: text(input.colour) || '#F7931E',
      premium: !!input.premium,
      recipe,
      water: cleanQty(input.water),
      keepsDays: Math.max(1, Math.round(num(input.keepsDays)) || 3),
      tag: text(input.tag),
    };
    const sv = save('products', id, data, { archived: false });
    ops.push(sv.op);
    return { ops, id: sv.id, itemIds };
  }

  /** The juice's recipe as the average of its last batches, given the batches as they will be. */
  function averageData(productId: string, batches: Batch[], water: number) {
    const avg = averageRecipe(productId, batches, now().settings.sizes);
    if (!avg) return null;
    return { recipe: avg.recipe, water: avg.water ?? water, recipeAvg: { batches: avg.batches, litres: avg.litres, last: avg.last } };
  }
  function averageOp(productId: string, batches: Batch[]): Op | null {
    const p = cur().products.find((x) => x.id === productId);
    if (!p) return null;
    const d = averageData(productId, batches, p.water);
    return d ? { op: 'patch', col: 'products', id: productId, data: { ...d, ...touched() } } : null;
  }

  const cleanRecipe = (lines: RecipeLine[]) => lines.map((l) => ({ itemId: l.itemId, qty: cleanQty(l.qty) })).filter((l) => l.itemId && l.qty > 0);

  return {
    // ---------- juices and cocktails ----------
    async saveProduct(input: Input<Product>, id?: string): Promise<string> {
      const name = text(input.name);
      need(name, 'Type the name of the juice.');
      const clash = cur().products.find((p) => p.id !== id && sameName(p.name, name));
      need(!clash, `There is already a juice called ${clash?.name}.`);
      const data = {
        name,
        kind: input.kind === 'cocktail' ? 'cocktail' : 'single',
        icon: text(input.icon) || '🥤',
        colour: text(input.colour) || '#F7931E',
        premium: !!input.premium,
        recipe: cleanRecipe(input.recipe ?? []),
        water: cleanQty(input.water),
        keepsDays: Math.max(1, Math.round(num(input.keepsDays)) || 3),
        tag: text(input.tag),
      };
      const s = save('products', id, data, { archived: false });
      await store.commit([s.op]);
      return s.id;
    },
    /**
     * A juice with its recipe for 10 litres, each line by name: a fruit or ingredient in Stock, or a
     * new one, added to Stock (kind fruit, in the unit given) in the same save, so a recipe never needs
     * Stock filled first.
     */
    async saveProductByNames(input: Omit<Input<Product>, 'recipe'>, lines: RecipeByName[], id?: string): Promise<string> {
      const b = productOps(input, lines, id, (n) => `Type how much ${n} goes into 10 litres.`);
      const before = id ? cur().products.find((p) => p.id === id) : undefined;
      const op = b.ops.find((o) => o.col === 'products');
      if (before?.recipeAvg && op && 'data' in op && op.data) {
        const d = op.data as { recipe: RecipeLine[]; water: number };
        const same = JSON.stringify(d.recipe) === JSON.stringify(before.recipe) && d.water === before.water;
        if (!same) (op.data as Record<string, unknown>).recipeAvg = null;
      }
      await store.commit(b.ops);
      return b.id;
    },
    /**
     * The recipe worked out backwards from one real batch: everything that went in (in total), the
     * water, and the bottles filled of each size. Litres = the bottles' litres; each amount per 10 litres
     * = amount x 10 / litres. With record, the batch itself is saved too (made today, already bottled),
     * so it counts on the Day list and takes the fruit off Stock.
     */
    async saveProductFromBatch(input: Omit<Input<Product>, 'recipe' | 'water'>, used: RecipeByName[], waterUsed: number, filled: Record<string, number>, record: boolean, madeBy = '', id?: string, date?: string): Promise<{ id: string; litres: number }> {
      const bottles: Record<string, number> = {};
      for (const [k, n] of Object.entries(filled)) if (Math.round(num(n)) > 0) bottles[k] = Math.round(num(n));
      const litres = Math.round(Object.entries(bottles).reduce((t, [k, n]) => t + n * num(sizeOf(now().settings.sizes, k)?.litres), 0) * 1000) / 1000;
      need(litres > 0, 'Type how many bottles of each size you filled.');
      const per10 = (q: number) => Math.round(((cleanQty(q) * 10) / litres) * 1000) / 1000;
      const b = productOps({ ...input, water: per10(waterUsed) }, used.map((l) => ({ ...l, qty: per10(l.qty) })), id, (n) => `Type how much ${n} you used.`);
      if (record) {
        const today = date || todayYmd();
        need(today <= todayYmd(), 'The day the batch was made cannot be in the future.');
        const keeps = Math.max(1, Math.round(num(input.keepsDays)) || 3);
        const usedLines: RecipeLine[] = [];
        for (const l of used) {
          const itemId = b.itemIds.get(text(l.name).toLowerCase());
          if (itemId && cleanQty(l.qty) > 0) usedLines.push({ itemId, qty: cleanQty(l.qty) });
        }
        const batch = { number: nextNumber('B', cur().batches.map((x) => x.number)), date: today, productId: b.id, litres, used: usedLines, filled: bottles, madeBy: text(madeBy), bestBefore: addDays(today, keeps), checks: [], note: 'Recipe worked out from this batch', measured: true, water: cleanQty(waterUsed), ...created() };
        const batchId = newId();
        b.ops.push({ op: 'set', col: 'batches', id: batchId, data: batch });
        // the recipe becomes the average of this juice's last batches, this one included
        const op = b.ops.find((o) => o.col === 'products');
        const d = averageData(b.id, [...cur().batches, { id: batchId, ...batch } as Batch], per10(waterUsed));
        if (d && op && 'data' in op && op.data) Object.assign(op.data, d);
      }
      await store.commit(b.ops);
      return { id: b.id, litres };
    },
    async archiveProduct(id: string, archived: boolean) {
      await store.commit([{ op: 'patch', col: 'products', id, data: { archived, ...touched() } }]);
    },
    /** Deletes a juice and its recipe, only while nothing refers to it (no batch, sale or order). */
    async deleteProduct(id: string) {
      const r = cur();
      const used = r.batches.some((b) => b.productId === id) || r.orders.some((o) => o.lines.some((l) => l.productId === id)) || r.sales.some((s) => s.lines.some((l) => l.productId === id));
      need(!used, 'This juice has been made, sold or ordered, so its history needs it. Use Hide instead: it leaves Sell, the Day list and new orders.');
      await store.commit([{ op: 'delete', col: 'products', id }]);
    },

    /**
     * Reconciling bottles already made: the batches chosen (e.g. this week's Mango, counted on the Day
     * list with nothing recorded about what went in) get what really went in, shared out by their
     * litres; with updateRecipe the juice's recipe for 10 litres becomes the same sums
     * (amount x 10 / litres of all those batches). New ingredient names are added to Stock.
     */
    async reconcileBatches(productId: string, batchIds: string[], used: RecipeByName[], waterUsed: number, updateRecipe: boolean): Promise<{ litres: number; batches: number }> {
      const product = cur().products.find((x) => x.id === productId);
      need(product, 'Choose the juice.');
      const batches = cur().batches.filter((b) => batchIds.includes(b.id) && b.productId === productId);
      need(batches.length, 'Choose the bottles made that these amounts were for.');
      const litres = Math.round(batches.reduce((t, b) => t + num(b.litres), 0) * 1000) / 1000;
      need(litres > 0, 'Those batches hold no litres.');
      const lines = used.filter((l) => text(l.name));
      need(lines.length, 'Add what went in: each fruit or ingredient and how much.');
      const per10 = (q: number) => Math.round(((cleanQty(q) * 10) / litres) * 1000) / 1000;
      // The product save resolves the names (adding new ones to Stock); its recipe is per 10 litres.
      const b = productOps(
        { name: product!.name, kind: product!.kind, icon: product!.icon, colour: product!.colour, premium: product!.premium, keepsDays: product!.keepsDays, tag: product!.tag, water: updateRecipe ? per10(waterUsed) : product!.water },
        updateRecipe ? lines.map((l) => ({ ...l, qty: per10(l.qty) })) : lines.map((l) => ({ ...l, qty: cleanQty(l.qty) || 0 })),
        productId,
        (n) => `Type how much ${n} went in.`,
      );
      const ops = updateRecipe ? b.ops : b.ops.filter((o) => o.col !== 'products');
      // Share each amount out by litres; the last batch takes what rounding leaves.
      const ordered = [...batches].sort((x, y) => x.date.localeCompare(y.date) || x.createdAt - y.createdAt);
      const shares = new Map<string, RecipeLine[]>(ordered.map((x) => [x.id, []]));
      for (const l of lines) {
        const itemId = b.itemIds.get(text(l.name).toLowerCase());
        const total = cleanQty(l.qty);
        if (!itemId || total <= 0) continue;
        let left = total;
        ordered.forEach((x, i) => {
          const q = i === ordered.length - 1 ? Math.round(left * 1000) / 1000 : Math.round(((total * num(x.litres)) / litres) * 1000) / 1000;
          left -= q;
          shares.get(x.id)!.push({ itemId, qty: q });
        });
      }
      const water = cleanQty(waterUsed);
      const waterOf = (x: Batch) => (water > 0 ? Math.round(((water * num(x.litres)) / litres) * 1000) / 1000 : x.water);
      for (const x of ordered) ops.push({ op: 'patch', col: 'batches', id: x.id, data: { used: shares.get(x.id)!, measured: true, ...(water > 0 ? { water: waterOf(x) } : {}), ...touched() } });
      if (updateRecipe) {
        const after = cur().batches.map((x) => (shares.has(x.id) ? { ...x, used: shares.get(x.id)!, measured: true, water: waterOf(x) } : x));
        const op = ops.find((o) => o.col === 'products');
        const d = averageData(productId, after, per10(waterUsed));
        if (d && op && 'data' in op && op.data) Object.assign(op.data, d);
      }
      await store.commit(ops);
      return { litres, batches: ordered.length };
    },
    /**
     * Moves everything recorded under one juice (sales, orders, batches) to another, then deletes it:
     * for a juice that was a stand-in (e.g. "Fresh juice" from the Excel sheet) once the real one exists.
     */
    async moveJuiceAndDelete(fromId: string, toId: string): Promise<number> {
      need(fromId !== toId, 'Choose another juice to move the history to.');
      const r = cur();
      need(r.products.some((x) => x.id === fromId), 'That juice no longer exists.');
      need(r.products.some((x) => x.id === toId), 'Choose the juice to move the history to.');
      const ops: Op[] = [];
      const swap = <T extends { productId: string }>(ls: T[] | undefined) => (ls ?? []).map((l) => (l.productId === fromId ? { ...l, productId: toId } : l));
      for (const x of r.sales) if (x.lines.some((l) => l.productId === fromId)) ops.push({ op: 'patch', col: 'sales', id: x.id, data: { lines: swap(x.lines), ...touched() } });
      for (const o of r.orders)
        if (o.lines.some((l) => l.productId === fromId) || o.packed?.some((l) => l.productId === fromId)) ops.push({ op: 'patch', col: 'orders', id: o.id, data: { lines: swap(o.lines), packed: swap(o.packed), ...touched() } });
      for (const x of r.batches) if (x.productId === fromId) ops.push({ op: 'patch', col: 'batches', id: x.id, data: { productId: toId, ...touched() } });
      const moved = ops.length;
      ops.push({ op: 'delete', col: 'products', id: fromId });
      await store.commit(ops);
      return moved;
    },

    // ---------- fruit, ingredients and packaging ----------
    async saveItem(input: Input<StockItem>, id?: string): Promise<string> {
      const name = text(input.name);
      need(name, 'Type the name of the item.');
      const clash = cur().items.find((i) => i.id !== id && sameName(i.name, name));
      need(!clash, `There is already an item called ${clash?.name}.`);
      const kind = input.kind === 'packaging' ? 'packaging' : 'fruit';
      const s = save('items', id, { name, kind, unit: text(input.unit) || 'kg', reorderLevel: cleanQty(input.reorderLevel) }, { archived: false });
      const ops: Op[] = [s.op];
      const linked = kind === 'packaging' ? linkBottle(now().settings.sizes, s.id, name) : null;
      if (linked) ops.push({ op: 'patch', col: 'settings', id: 'main', data: { sizes: linked, ...touched() } });
      await store.commit(ops);
      return s.id;
    },
    async archiveItem(id: string, archived: boolean) {
      await store.commit([{ op: 'patch', col: 'items', id, data: { archived, ...touched() } }]);
    },
    async deleteItem(id: string) {
      const r = cur();
      const used =
        r.purchases.some((p) => p.itemId === id) ||
        r.batches.some((b) => b.used?.some((u) => u.itemId === id)) ||
        r.counts.some((c) => c.itemId === id) ||
        r.products.some((p) => p.recipe?.some((x) => x.itemId === id));
      need(!used, 'This item is in a recipe or has stock records, so it is kept. Use Hide instead.');
      await store.commit([{ op: 'delete', col: 'items', id }]);
    },
    /** After counting: records the difference between the count and the records. */
    async saveCount(itemId: string, counted: number, onRecord: number, reason: string) {
      need(itemId, 'Choose the item.');
      const diff = Math.round((num(counted) - num(onRecord)) * 1000) / 1000;
      need(diff !== 0, 'The count is the same as the records, so there is nothing to correct.');
      await store.commit([{ op: 'set', col: 'counts', id: newId(), data: { date: todayYmd(), itemId, qty: diff, reason: text(reason) || 'Count', ...created() } }]);
    },

    // ---------- suppliers and buying ----------
    async saveSupplier(input: { name: string; phone?: string; supplies?: string }, id?: string): Promise<string> {
      const name = text(input.name);
      need(name, "Type the supplier's name.");
      const clash = cur().suppliers.find((s) => s.id !== id && sameName(s.name, name));
      need(!clash, `There is already a supplier called ${clash?.name}.`);
      const s = save('suppliers', id, { name, phone: text(input.phone), supplies: text(input.supplies) }, { archived: false });
      await store.commit([s.op]);
      return s.id;
    },
    async deleteSupplier(id: string) {
      need(!cur().purchases.some((p) => p.supplierId === id), 'This supplier has purchases, so the record is kept.');
      await store.commit([{ op: 'delete', col: 'suppliers', id }]);
    },
    async savePurchase(input: { date: string; supplierName: string; itemId: string; qty: number; price: number; quality?: string; note?: string }, paidNow?: PaidNow): Promise<string> {
      need(input.itemId, 'Choose what was bought.');
      const qty = cleanQty(input.qty);
      need(qty > 0, 'Type how much was bought.');
      const price = cleanAmount(input.price);
      need(price > 0, 'Type the price of one unit.');
      need(input.date, 'Choose the date.');
      const ops: Op[] = [];
      const sname = text(input.supplierName);
      let supplierId = '';
      if (sname) {
        const found = cur().suppliers.find((s) => sameName(s.name, sname));
        if (found) supplierId = found.id;
        else {
          supplierId = newId();
          ops.push({ op: 'set', col: 'suppliers', id: supplierId, data: { name: sname, phone: '', supplies: '', archived: false, ...created() } });
        }
      }
      const id = newId();
      ops.push({ op: 'set', col: 'purchases', id, data: { date: input.date, supplierId, supplierName: sname || 'Market', itemId: input.itemId, qty, price, quality: text(input.quality), note: text(input.note), ...created() } });
      const paid = cleanAmount(paidNow?.amount);
      if (paid > 0) {
        need(paid <= qty * price, `The amount paid is more than the total of ${money(qty * price)}.`);
        ops.push(paymentOp('purchase', id, paid, input.date, paidNow?.method ?? 'Cash'));
      }
      const sizes = bottleSizesAfterPurchase(input.itemId, { date: input.date, price, createdAt: Date.now() });
      if (sizes) ops.push({ op: 'patch', col: 'settings', id: 'main', data: { sizes, ...touched() } });
      await store.commit(ops);
      return id;
    },
    async deletePurchase(id: string) {
      const ops: Op[] = [{ op: 'delete', col: 'purchases', id }];
      for (const p of paymentsOf(id)) ops.push({ op: 'delete', col: 'payments', id: p.id });
      await store.commit(ops);
    },

    // ---------- production ----------
    async saveBatch(input: { date: string; productId: string; litres: number; used: RecipeLine[]; filled: Record<string, number>; madeBy: string; checks: string[]; note?: string; water?: number; measured?: boolean }): Promise<string> {
      const product = cur().products.find((p) => p.id === input.productId);
      need(product, 'Choose the juice.');
      const litres = cleanQty(input.litres);
      need(litres > 0, 'Type how many litres were made.');
      need(input.date, 'Choose the date.');
      const filled: Record<string, number> = {};
      for (const [k, n] of Object.entries(input.filled ?? {})) if (Math.round(num(n)) > 0) filled[k] = Math.round(num(n));
      const bottled = Object.entries(filled).reduce((t, [k, n]) => t + n * num(sizeOf(now().settings.sizes, k)?.litres), 0);
      need(bottled <= litres + 0.05, `Those bottles hold ${Math.round(bottled * 10) / 10} litres, more than the ${litres} litres made.`);
      const id = newId();
      const data: Omit<Batch, 'id' | 'createdAt' | 'updatedAt'> = {
        number: nextNumber('B', cur().batches.map((b) => b.number)),
        date: input.date,
        productId: product!.id,
        litres,
        used: cleanRecipe(input.used ?? []),
        filled,
        madeBy: text(input.madeBy),
        bestBefore: addDays(input.date, product!.keepsDays || 3),
        checks: (input.checks ?? []).filter(Boolean),
        note: text(input.note),
        measured: input.measured ?? true,
        ...(input.water !== undefined ? { water: cleanQty(input.water) } : {}),
      };
      const ops: Op[] = [{ op: 'set', col: 'batches', id, data: { ...data, ...created() } }];
      const avg = averageOp(product!.id, [...cur().batches, { id, ...data, createdAt: Date.now(), updatedAt: Date.now() }]);
      if (avg && countsForRecipe(data as Batch)) ops.push(avg);
      await store.commit(ops);
      return id;
    },
    /** Bottling a batch that was saved while still being made. */
    async bottleBatch(id: string, filled: Record<string, number>) {
      const b = cur().batches.find((x) => x.id === id);
      need(b, 'That batch no longer exists.');
      const clean: Record<string, number> = {};
      for (const [k, n] of Object.entries(filled)) if (Math.round(num(n)) > 0) clean[k] = Math.round(num(n));
      need(Object.keys(clean).length, 'Type how many bottles were filled.');
      const bottled = Object.entries(clean).reduce((t, [k, n]) => t + n * num(sizeOf(now().settings.sizes, k)?.litres), 0);
      need(bottled <= num(b!.litres) + 0.05, `Those bottles hold ${Math.round(bottled * 10) / 10} litres, more than the ${b!.litres} litres made.`);
      const taken = fridge().get(id);
      for (const [k, n] of Object.entries(b!.filled ?? {})) need((clean[k] ?? 0) >= n - (taken?.left[k] ?? 0), `Some ${sizeLabel(k)} bottles from this batch are already sold.`);
      const ops: Op[] = [{ op: 'patch', col: 'batches', id, data: { filled: clean, ...touched() } }];
      const avg = countsForRecipe(b!) ? averageOp(b!.productId, cur().batches.map((x) => (x.id === id ? { ...x, filled: clean } : x))) : null;
      if (avg) ops.push(avg);
      await store.commit(ops);
    },
    /**
     * The Day list's quick count: "20 bottles of Fresh juice 500 ml made today". Saved as a batch,
     * already bottled; the fruit that went in is the juice's recipe for those litres (none if it has
     * no recipe), as the Production form would fill it.
     */
    async quickBatch(input: { date: string; productId: string; size: string; bottles: number; madeBy?: string }): Promise<string> {
      const product = cur().products.find((p) => p.id === input.productId);
      need(product, 'Choose the juice.');
      const size = sizeOf(now().settings.sizes, input.size);
      need(size, 'Choose the bottle size.');
      const bottles = Math.round(num(input.bottles));
      need(bottles > 0, 'Type how many bottles were made.');
      need(input.date && input.date <= todayYmd(), 'Choose a day that has come.');
      const litres = Math.round(bottles * num(size!.litres) * 1000) / 1000;
      const used = (product!.recipe ?? []).map((r) => ({ itemId: r.itemId, qty: Math.round(((num(r.qty) * litres) / 10) * 1000) / 1000 }));
      return this.saveBatch({ date: input.date, productId: product!.id, litres, used, filled: { [size!.key]: bottles }, madeBy: text(input.madeBy), checks: [], note: DAY_LIST_NOTE, measured: false });
    },
    async deleteBatch(id: string) {
      const r = cur();
      const used = r.sales.some((s) => s.lines.some((l) => l.batchId === id)) || r.orders.some((o) => o.packed?.some((l) => l.batchId === id)) || r.writeOffs.some((w) => w.batchId === id);
      need(!used, 'Bottles from this batch are already sold, packed or written off, so it is kept.');
      const b = r.batches.find((x) => x.id === id);
      const ops: Op[] = [{ op: 'delete', col: 'batches', id }];
      if (b && countsForRecipe(b)) {
        const rest = r.batches.filter((x) => x.id !== id);
        const avg = averageOp(b.productId, rest);
        if (avg) ops.push(avg);
        else if (r.products.find((p) => p.id === b.productId)?.recipeAvg) ops.push({ op: 'patch', col: 'products', id: b.productId, data: { recipeAvg: null, ...touched() } });
      }
      await store.commit(ops);
    },
    async writeOff(input: { batchId: string; size: string; qty: number; reason: string; date?: string }) {
      const left = fridge().get(input.batchId);
      need(left, 'Choose the batch.');
      const qty = Math.round(num(input.qty));
      need(qty > 0, 'Type how many bottles.');
      need(qty <= (left!.left[input.size] ?? 0), `Only ${left!.left[input.size] ?? 0} bottles of that size are left in this batch.`);
      await store.commit([{ op: 'set', col: 'writeOffs', id: newId(), data: { date: input.date || todayYmd(), batchId: input.batchId, size: input.size, qty, reason: text(input.reason) || 'Other', ...created() } }]);
    },
    async deleteWriteOff(id: string) {
      await store.commit([{ op: 'delete', col: 'writeOffs', id }]);
    },

    // ---------- counter sales ----------
    /**
     * A counter sale, or a line on the day list (date = that day). method 'On credit' leaves it owed;
     * FROM_ADVANCE takes it from the customer's money paid ahead (what is not covered stays owed).
     */
    async saveSale(input: { lines: OrderLine[]; customerName: string; method: string; received?: number; emptiesBack?: number; note?: string; date?: string; discount?: number }): Promise<string> {
      const wanted = cleanOrderLines(input.lines);
      need(wanted.length, 'Add at least one bottle.');
      const full = takeFromFridge(fridge(), wanted, productName, sizeLabel, now().settings.fridgeCheck);
      const discount = cleanAmount(input.discount);
      need(discount <= linesValue(full), `The discount is more than the sale's total of ${money(linesValue(full))}.`);
      // The discount comes off the bottle prices, so every total, report and balance follows it.
      const lines = applyDiscount(full, discount);
      const ops: Op[] = [];
      const credit = input.method === 'On credit';
      const fromAdvance = input.method === FROM_ADVANCE;
      const customerId = resolveCustomer(ops, input.customerName);
      need(!credit || customerId, 'A sale on credit needs the customer\'s name.');
      need(!fromAdvance || customerId, 'Money paid ahead belongs to a customer: type their name.');
      const today = todayYmd();
      const date = input.date || today;
      need(date <= today, 'A sale cannot be on a day that has not come yet.');
      const d = new Date();
      const id = newId();
      ops.push({
        op: 'set',
        col: 'sales',
        id,
        data: {
          number: nextNumber('S', cur().sales.map((s) => s.number)),
          date,
          time: date === today ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '',
          customerId,
          customerName: customerId ? (cur().customers.find((c) => c.id === customerId)?.name ?? text(input.customerName)) : 'Walk-in',
          lines,
          method: input.method || 'Cash',
          ...(discount ? { discount } : {}),
          emptiesBack: Math.max(0, Math.round(num(input.emptiesBack))),
          note: text(input.note),
          ...created(),
        },
      });
      if (fromAdvance) {
        const take = Math.min(linesValue(lines), Math.max(0, advanceLeft(customerId)));
        need(take > 0, `${text(input.customerName)} has no money paid ahead left. Choose On credit or another way of paying.`);
        ops.push(paymentOp('sale', id, take, date, FROM_ADVANCE));
      } else if (!credit) ops.push(paymentOp('sale', id, linesValue(lines), date, input.method || 'Cash'));
      await store.commit(ops);
      return id;
    },
    /** Undo a sale: the bottles go back to the fridge and its payments are removed. */
    async deleteSale(id: string) {
      const ops: Op[] = [{ op: 'delete', col: 'sales', id }];
      for (const p of paymentsOf(id)) ops.push({ op: 'delete', col: 'payments', id: p.id });
      await store.commit(ops);
    },

    // ---------- orders ----------
    async saveOrder(
      input: { customerName: string; customerType?: string; phone?: string; date: string; dueDate: string; dueTime?: string; rider?: string; place?: string; lines: OrderLine[]; deliveryFee?: number; notes?: string },
      id?: string,
      deposit?: PaidNow,
      reminders: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt' | 'orderId'>[] = [],
    ): Promise<string> {
      const lines = cleanOrderLines(input.lines);
      need(lines.length, 'Add at least one juice: which one, the size and how many.');
      need(input.dueDate, 'Choose the delivery day.');
      need(text(input.customerName), "Type the customer's name.");
      const ops: Op[] = [];
      const customerId = resolveCustomer(ops, input.customerName, input.customerType || 'Shop', input.phone);
      const existing = id ? cur().orders.find((o) => o.id === id) : undefined;
      need(!id || existing, 'That order no longer exists.');
      need(!existing?.packed?.length, 'This order is already packed. Move it back to "To make" before changing what is in it.');
      const data = {
        customerId,
        date: input.date || todayYmd(),
        dueDate: input.dueDate,
        dueTime: text(input.dueTime),
        rider: text(input.rider),
        place: text(input.place),
        lines,
        deliveryFee: cleanAmount(input.deliveryFee),
        notes: text(input.notes),
      };
      const s = save('orders', id, data, { number: nextNumber('VJ', cur().orders.map((o) => o.number)), stage: 'To make', packed: [] });
      ops.push(s.op);
      if (!id) {
        const paid = cleanAmount(deposit?.amount);
        if (paid > 0) {
          need(paid <= orderValue(data), `The deposit is more than the order's total of ${money(orderValue(data))}.`);
          ops.push(paymentOp('order', s.id, paid, data.date, deposit?.method ?? 'Cash', 'Deposit'));
        }
      }
      for (const r of reminders)
        if (text(r.what) && r.date) ops.push({ op: 'set', col: 'reminders', id: newId(), data: { ...r, what: text(r.what), orderId: s.id, done: false, ...created() } });
      await store.commit(ops);
      return s.id;
    },
    /**
     * Ready (or Delivered straight away) takes the bottles out of the fridge for the order;
     * back to To make, or Cancelled, puts them back.
     */
    async setOrderStage(id: string, stage: OrderStage) {
      const o = cur().orders.find((x) => x.id === id);
      need(o, 'That order no longer exists.');
      const data: Partial<Order> & { updatedAt: number } = { stage, ...touched() };
      const packedNow = (o!.packed ?? []).length > 0;
      if ((stage === 'Ready' || stage === 'Out for delivery' || stage === 'Delivered') && !packedNow) data.packed = takeFromFridge(fridge(), o!.lines, productName, sizeLabel, now().settings.fridgeCheck);
      if (stage === 'To make' || stage === 'Cancelled') data.packed = [];
      data.deliveredOn = stage === 'Delivered' ? todayYmd() : '';
      await store.commit([{ op: 'patch', col: 'orders', id, data }]);
    },
    async deleteOrder(id: string) {
      const ops: Op[] = [{ op: 'delete', col: 'orders', id }];
      for (const p of paymentsOf(id)) ops.push({ op: 'delete', col: 'payments', id: p.id });
      for (const r of cur().reminders) if (r.orderId === id) ops.push({ op: 'delete', col: 'reminders', id: r.id });
      await store.commit(ops);
    },

    // ---------- payments (orders, credit sales, purchases) ----------
    async addPayment(kind: PaymentKind, refId: string, input: { amount: number; date: string; method: string; note?: string }) {
      const amount = cleanAmount(input.amount);
      need(amount > 0, 'Type an amount above zero.');
      need(input.date, 'Choose the date of the payment.');
      const r = cur();
      const pays = paymentsOf(refId);
      let balance = 0;
      if (kind === 'order') {
        const o = r.orders.find((x) => x.id === refId);
        need(o, 'That order no longer exists.');
        need(o!.stage !== 'Cancelled', 'This order is cancelled, so it cannot take a payment.');
        balance = orderTotals(o!, pays).balance;
      } else if (kind === 'sale') {
        const s = r.sales.find((x) => x.id === refId);
        need(s, 'That sale no longer exists.');
        balance = saleTotals(s!, pays).balance;
      } else {
        const p = r.purchases.find((x) => x.id === refId);
        need(p, 'That purchase no longer exists.');
        balance = purchaseTotals(p!, pays).balance;
      }
      need(balance > 0, 'This is already fully paid.');
      need(amount <= balance, `That is more than the balance of ${money(balance)}.`);
      await store.commit([paymentOp(kind, refId, amount, input.date, input.method, text(input.note))]);
    },
    async deletePayment(id: string) {
      const p = cur().payments.find((x) => x.id === id);
      if (p?.kind === 'advance') {
        const left = advanceLeft(p.refId);
        need(left >= num(p.amount), `${money(num(p.amount) - Math.max(0, left))} of this money paid ahead is already used for bottles, so it is kept. Undo those sales first.`);
      }
      await store.commit([{ op: 'delete', col: 'payments', id }]);
    },

    /**
     * Money from a customer, as one amount: it pays what they owe, oldest first, and anything left
     * over is kept as money paid ahead. With method FROM_ADVANCE it uses their money paid ahead
     * (only to pay what they owe; nothing is kept).
     * Returns how much went to their debts and how much was kept as paid ahead.
     */
    async receiveMoney(customerId: string, input: { amount: number; date: string; method: string; note?: string }): Promise<{ paid: number; kept: number }> {
      const c = cur().customers.find((x) => x.id === customerId);
      need(c, 'That customer no longer exists.');
      let amount = cleanAmount(input.amount);
      need(amount > 0, 'Type an amount above zero.');
      need(input.date, 'Choose the date.');
      const fromAdvance = input.method === FROM_ADVANCE;
      const r = cur();
      const debts = debtsOf(customerId, r.orders, r.sales, paymentsByRef(r.payments));
      const owed = sum(debts, (d) => d.balance);
      if (fromAdvance) {
        const left = advanceLeft(customerId);
        need(owed > 0, `${c!.name} owes nothing.`);
        need(left > 0, `${c!.name} has no money paid ahead left.`);
        need(amount <= left, `${c!.name} has only ${money(left)} paid ahead.`);
        amount = Math.min(amount, owed);
      }
      const ops: Op[] = [];
      let rest = amount;
      for (const d of debts) {
        if (rest <= 0) break;
        const pay = Math.min(rest, d.balance);
        ops.push(paymentOp(d.kind, d.id, pay, input.date, input.method, text(input.note)));
        rest -= pay;
      }
      if (rest > 0 && !fromAdvance) ops.push(paymentOp('advance', customerId, rest, input.date, input.method, text(input.note)));
      await store.commit(ops);
      return { paid: amount - (fromAdvance ? 0 : rest), kept: fromAdvance ? 0 : rest };
    },

    // ---------- customers ----------
    async saveCustomer(input: Input<Customer>, id?: string): Promise<string> {
      const name = text(input.name);
      need(name, "Type the customer's name.");
      const clash = cur().customers.find((c) => c.id !== id && sameName(c.name, name));
      need(!clash, `There is already a customer called ${clash?.name}.`);
      const s = save('customers', id, { name, type: text(input.type) || 'Shop', phone: text(input.phone), place: text(input.place), notes: text(input.notes), discount: cleanAmount(input.discount) }, { archived: false });
      await store.commit([s.op]);
      return s.id;
    },
    /** A discount a customer always gets (0 to stop it); found by name, added if new. */
    async setCustomerDiscount(customerName: string, amount: number) {
      const ops: Op[] = [];
      const id = resolveCustomer(ops, customerName);
      need(id, "Type the customer's name.");
      ops.push({ op: 'patch', col: 'customers', id, data: { discount: cleanAmount(amount), ...touched() } });
      await store.commit(ops);
    },
    async archiveCustomer(id: string, archived: boolean) {
      await store.commit([{ op: 'patch', col: 'customers', id, data: { archived, ...touched() } }]);
    },
    async deleteCustomer(id: string) {
      const used = cur().orders.some((o) => o.customerId === id) || cur().sales.some((s) => s.customerId === id) || cur().payments.some((p) => p.kind === 'advance' && p.refId === id);
      need(!used, 'This customer has orders, sales or money paid ahead, so the record is kept. Use Hide instead.');
      await store.commit([{ op: 'delete', col: 'customers', id }]);
    },

    // ---------- expenses ----------
    async saveExpense(input: Input<Expense>, id?: string): Promise<string> {
      const amount = cleanAmount(input.amount);
      need(amount > 0, 'Type the amount spent.');
      need(input.date, 'Choose the date.');
      const s = save('expenses', id, { date: input.date, category: text(input.category) || 'Other', description: text(input.description) || text(input.category) || 'Expense', amount, method: text(input.method) || 'Cash', note: text(input.note) });
      await store.commit([s.op]);
      return s.id;
    },
    async deleteExpense(id: string) {
      await store.commit([{ op: 'delete', col: 'expenses', id }]);
    },

    // ---------- staff, attendance and wages ----------
    async saveStaff(input: Input<Staff>, id?: string): Promise<string> {
      const name = text(input.name);
      need(name, "Type the person's name.");
      const clash = cur().staff.find((s) => s.id !== id && !s.archived && sameName(s.name, name));
      need(!clash, `There is already someone called ${clash?.name}.`);
      const s = save('staff', id, { name, role: input.role, job: text(input.job), payKind: input.payKind, rate: input.payKind === 'none' ? 0 : cleanAmount(input.rate), phone: text(input.phone) }, { archived: false });
      await store.commit([s.op]);
      return s.id;
    },
    /** Someone who has left also loses their cloud sign-in at once (in the same change). */
    async archiveStaff(id: string, archived: boolean) {
      const s = cur().staff.find((x) => x.id === id);
      await store.commit([{ op: 'patch', col: 'staff', id, data: { archived, ...(archived ? { loginUid: '', loginPhone: '' } : {}), ...touched() } }, ...(archived && s ? accessRemoval(s) : [])]);
    },
    /** present: true, false, or null to clear the mark */
    async setAttendance(staffId: string, date: string, present: boolean | null) {
      const id = `${date}_${staffId}`;
      if (present === null) await store.commit([{ op: 'delete', col: 'attendance', id }]);
      else await store.commit([{ op: 'set', col: 'attendance', id, data: { date, staffId, present, ...created() } }]);
    },
    async saveWage(input: Input<WagePayment>) {
      const amount = cleanAmount(input.amount);
      need(input.staffId, 'Choose the person.');
      need(amount > 0, 'Type the amount.');
      need(input.date, 'Choose the date.');
      await store.commit([{ op: 'set', col: 'wages', id: newId(), data: { date: input.date, staffId: input.staffId, kind: input.kind === 'advance' ? 'advance' : 'wage', amount, method: text(input.method) || 'Cash', note: text(input.note), ...created() } }]);
    },
    async deleteWage(id: string) {
      await store.commit([{ op: 'delete', col: 'wages', id }]);
    },

    // ---------- reminders ----------
    async saveReminder(input: Input<Reminder>, id?: string): Promise<string> {
      const what = text(input.what);
      need(what, 'Type what the reminder is about.');
      need(input.date, 'Choose the day.');
      const s = save('reminders', id, { date: input.date, time: text(input.time) || '06:00', what, staffId: text(input.staffId), orderId: text(input.orderId), repeat: input.repeat || '', ways: input.ways ?? [] }, { done: false });
      await store.commit([s.op]);
      return s.id;
    },
    async setReminderDone(id: string, done: boolean) {
      await store.commit([{ op: 'patch', col: 'reminders', id, data: { done, ...touched() } }]);
    },
    async deleteReminder(id: string) {
      await store.commit([{ op: 'delete', col: 'reminders', id }]);
    },

    // ---------- fridge temperatures ----------
    async saveReading(input: Input<FridgeReading>) {
      need(text(input.fridge), 'Choose the fridge.');
      need(input.celsius !== undefined && Number.isFinite(num(input.celsius)) && String(input.celsius) !== '', 'Type the temperature.');
      const d = new Date();
      await store.commit([
        {
          op: 'set',
          col: 'readings',
          id: newId(),
          data: { date: input.date || todayYmd(), time: text(input.time) || `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, fridge: text(input.fridge), celsius: Math.round(num(input.celsius) * 10) / 10, by: text(input.by), ...created() },
        },
      ]);
    },
    async deleteReading(id: string) {
      await store.commit([{ op: 'delete', col: 'readings', id }]);
    },

    // ---------- settings: only the fields that changed are written ----------
    async saveSettings(fields: Partial<Settings>) {
      await store.commit([{ op: 'patch', col: 'settings', id: 'main', data: { ...fields, ...touched() } }]);
    },

    /** Adds the usual fruit, packaging and juices (only what is not there yet), when the owner asks for it. */
    async addStarterSet() {
      const r = cur();
      const ops: Op[] = [];
      const itemId = new Map<string, string>();
      let n = 0;
      for (const [name, kind, unit, reorderLevel] of STARTER_ITEMS) {
        const found = r.items.find((i) => sameName(i.name, name));
        if (found) {
          itemId.set(name, found.id);
          continue;
        }
        const id = newId();
        itemId.set(name, id);
        ops.push({ op: 'set', col: 'items', id, data: { name, kind, unit, reorderLevel, archived: false, createdAt: Date.now() + n++, updatedAt: Date.now() } });
      }
      for (const p of STARTER_PRODUCTS) {
        if (r.products.some((x) => sameName(x.name, p.name))) continue;
        const recipe = p.recipe.map(([name, qty]) => ({ itemId: itemId.get(name)!, qty }));
        ops.push({
          op: 'set',
          col: 'products',
          id: newId(),
          data: { name: p.name, kind: p.kind, icon: p.icon, colour: p.colour, premium: !!p.premium, recipe, water: p.water, keepsDays: p.keepsDays, tag: p.tag ?? '', archived: false, createdAt: Date.now() + n++, updatedAt: Date.now() },
        });
      }
      // Each bottle size uses up its bottle from Stock (only sizes not linked yet).
      const sizes: Size[] = now().settings.sizes.map((s) => ({ ...s, bottleItemId: s.bottleItemId || itemId.get(BOTTLE_FOR_SIZE[s.key] ?? '') || '' }));
      const perBottle = now().settings.perBottle.length ? now().settings.perBottle : ['Caps', 'Labels (stickers)'].map((n) => itemId.get(n) ?? '').filter(Boolean);
      ops.push({ op: 'patch', col: 'settings', id: 'main', data: { sizes, perBottle, ...touched() } });
      await store.commit(ops);
    },

    /** Start again from a date: everything dated before it goes; balances are carried over (see lib/startAgain). */
    async startAgainFrom(cutoff: string, carryOwed: boolean) {
      need(cutoff && cutoff <= todayYmd(), 'Choose a day that has come.');
      const plan = startAgainPlan(cur(), cutoff, carryOwed, newId);
      if (plan.ops.length) await store.commit(plan.ops);
      return plan;
    },

    /** For restore and "delete all records". */
    async commitRaw(ops: Op[]) {
      if (ops.length) await store.commit(ops);
    },
  };
}

export type Actions = ReturnType<typeof makeActions>;

/** The volume in a name, in litres: "Bottles 500 ml" 0.5, "500mls" 0.5, "1 liter" 1, "Jerrycan 5 L" 5. 0 when none. */
export function volumeIn(name: string): number {
  const m = /(\d+(?:[.,]\d+)?)\s*(ml|mls|millilitres?|milliliters?|l|lt|ltr|ltrs|litres?|liters?)(?![a-z])/i.exec(name);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  return /^m/i.test(m[2]) ? n / 1000 : n;
}

/**
 * Links a packaging item to the bottle size of its volume, when that size has no bottle yet.
 * Caps, lids, labels, stickers and straws are never bottles. Returns the new sizes, or null.
 */
export function linkBottle(sizes: Size[], itemId: string, name: string): Size[] | null {
  if (/cap|lid|label|sticker|straw|seal/i.test(name)) return null;
  const litres = volumeIn(name);
  if (!litres) return null;
  const i = sizes.findIndex((z) => Math.abs(num(z.litres) - litres) < 0.0001);
  if (i < 0 || sizes[i].bottleItemId) return null;
  return sizes.map((z, n) => (n === i ? { ...z, bottleItemId: itemId } : z));
}

/** A recipe line given by the ingredient's name (in Stock, or new), its unit for a new one, and the amount. */
export interface RecipeByName {
  name: string;
  unit: string;
  qty: number;
}

// ---------- the usual set, offered once on an empty app ----------

// Fruit is counted in pieces, not kilos (Denis, 16 Nov 2026); sugar stays in kg, mint in bunches.
const STARTER_ITEMS: [string, 'fruit' | 'packaging', string, number][] = [
  ['Mangoes', 'fruit', 'pcs', 75],
  ['Passion fruit', 'fruit', 'pcs', 300],
  ['Pineapples', 'fruit', 'pcs', 15],
  ['Watermelons', 'fruit', 'pcs', 5],
  ['Oranges', 'fruit', 'pcs', 100],
  ['Ginger', 'fruit', 'pcs', 10],
  ['Lemons', 'fruit', 'pcs', 20],
  ['Mint', 'fruit', 'bunches', 4],
  ['Carrots', 'fruit', 'pcs', 80],
  ['Beetroot', 'fruit', 'pcs', 16],
  ['Cucumbers', 'fruit', 'pcs', 20],
  ['Sugar', 'fruit', 'kg', 10],
  ['Bottles 300 ml', 'packaging', 'pcs', 300],
  ['Bottles 500 ml', 'packaging', 'pcs', 300],
  ['Bottles 1 litre', 'packaging', 'pcs', 100],
  ['Jerrycans 5 litre', 'packaging', 'pcs', 6],
  ['Caps', 'packaging', 'pcs', 500],
  ['Labels (stickers)', 'packaging', 'pcs', 500],
  ['Straws', 'packaging', 'pcs', 300],
];

const BOTTLE_FOR_SIZE: Record<string, string> = { '300': 'Bottles 300 ml', '500': 'Bottles 500 ml', '1000': 'Bottles 1 litre', '5000': 'Jerrycans 5 litre' };

const STARTER_PRODUCTS: { name: string; kind: 'single' | 'cocktail'; icon: string; colour: string; premium?: boolean; water: number; keepsDays: number; tag?: string; recipe: [string, number][] }[] = [
  { name: 'Mango', kind: 'single', icon: '🥭', colour: '#FFA41B', water: 4, keepsDays: 3, recipe: [['Mangoes', 30], ['Sugar', 1]] },
  { name: 'Passion fruit', kind: 'single', icon: '🟣', colour: '#8E3FA0', water: 7, keepsDays: 3, recipe: [['Passion fruit', 80], ['Sugar', 1.5]] },
  { name: 'Pineapple', kind: 'single', icon: '🍍', colour: '#E9B800', water: 3, keepsDays: 3, recipe: [['Pineapples', 8], ['Sugar', 0.8]] },
  { name: 'Watermelon', kind: 'single', icon: '🍉', colour: '#E8445A', water: 0, keepsDays: 2, recipe: [['Watermelons', 4], ['Lemons', 3]] },
  { name: 'Orange', kind: 'single', icon: '🍊', colour: '#F7811E', premium: true, water: 0, keepsDays: 3, recipe: [['Oranges', 80]] },
  { name: 'Tropical Sunrise', kind: 'cocktail', icon: '🍹', colour: '#3BA935', water: 3, keepsDays: 3, tag: 'Mango, pineapple, passion', recipe: [['Mangoes', 10], ['Pineapples', 3], ['Passion fruit', 40], ['Sugar', 1]] },
  { name: 'Mango Passion', kind: 'cocktail', icon: '🥭', colour: '#C2571A', water: 4, keepsDays: 3, tag: 'Mango, passion fruit', recipe: [['Mangoes', 20], ['Passion fruit', 40], ['Sugar', 1]] },
  { name: 'Pineapple Ginger Zing', kind: 'cocktail', icon: '🍍', colour: '#B58A00', water: 3, keepsDays: 3, tag: 'Pineapple, ginger, lemon', recipe: [['Pineapples', 7], ['Ginger', 5], ['Lemons', 3], ['Sugar', 0.8]] },
  { name: 'Watermelon Mint Cooler', kind: 'cocktail', icon: '🍉', colour: '#D33A55', water: 0, keepsDays: 2, tag: 'Watermelon, mint, lemon', recipe: [['Watermelons', 4], ['Mint', 2], ['Lemons', 3]] },
  { name: 'Orange Carrot Glow', kind: 'cocktail', icon: '🥕', colour: '#E86A10', premium: true, water: 0, keepsDays: 2, tag: 'Orange, carrot', recipe: [['Oranges', 50], ['Carrots', 40]] },
  { name: 'Beetroot Power', kind: 'cocktail', icon: '🔴', colour: '#A3203F', water: 3, keepsDays: 3, tag: 'Beetroot, pineapple, ginger', recipe: [['Beetroot', 12], ['Pineapples', 4], ['Ginger', 3], ['Sugar', 0.5]] },
  { name: 'Green Fresh', kind: 'cocktail', icon: '🥒', colour: '#2F8F3A', water: 2, keepsDays: 2, tag: 'Cucumber, pineapple, mint, lemon', recipe: [['Cucumbers', 13], ['Pineapples', 4], ['Lemons', 4], ['Mint', 1]] },
];
