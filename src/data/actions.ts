// Every save in the app goes through this file, so each rule lives in one place:
// - a new record is written whole; an edit changes only the fields of its form (nothing else is wiped);
// - things that belong together are saved together (a sale with its payment, an order with its
//   deposit and reminders, a delete with its payments);
// - amounts are cleaned once here (whole shillings, above zero);
// - bottles leave the fridge only here, oldest best-before first.
// A refused action throws an Error whose message is plain words for the screen.
import { addDays, todayYmd } from '../lib/dates';
import { fridgeByBatch, linesValue, nextNumber, orderTotals, orderValue, purchaseTotals, sameName, saleTotals, sizeOf, takeFromFridge } from '../lib/juice';
import { cleanAmount, cleanQty, money, num } from '../lib/money';
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
import { newId, type Op, type Store } from './store';

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
  const paymentsOf = (refId: string) => cur().payments.filter((p) => p.refId === refId);
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
    async archiveProduct(id: string, archived: boolean) {
      await store.commit([{ op: 'patch', col: 'products', id, data: { archived, ...touched() } }]);
    },
    async deleteProduct(id: string) {
      const r = cur();
      const used = r.batches.some((b) => b.productId === id) || r.orders.some((o) => o.lines.some((l) => l.productId === id));
      need(!used, 'This juice has batches or orders, so it is kept. Use Hide instead.');
      await store.commit([{ op: 'delete', col: 'products', id }]);
    },

    // ---------- fruit, ingredients and packaging ----------
    async saveItem(input: Input<StockItem>, id?: string): Promise<string> {
      const name = text(input.name);
      need(name, 'Type the name of the item.');
      const clash = cur().items.find((i) => i.id !== id && sameName(i.name, name));
      need(!clash, `There is already an item called ${clash?.name}.`);
      const s = save('items', id, { name, kind: input.kind === 'packaging' ? 'packaging' : 'fruit', unit: text(input.unit) || 'kg', reorderLevel: cleanQty(input.reorderLevel) }, { archived: false });
      await store.commit([s.op]);
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
      await store.commit(ops);
      return id;
    },
    async deletePurchase(id: string) {
      const ops: Op[] = [{ op: 'delete', col: 'purchases', id }];
      for (const p of paymentsOf(id)) ops.push({ op: 'delete', col: 'payments', id: p.id });
      await store.commit(ops);
    },

    // ---------- production ----------
    async saveBatch(input: { date: string; productId: string; litres: number; used: RecipeLine[]; filled: Record<string, number>; madeBy: string; checks: string[]; note?: string }): Promise<string> {
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
      };
      await store.commit([{ op: 'set', col: 'batches', id, data: { ...data, ...created() } }]);
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
      await store.commit([{ op: 'patch', col: 'batches', id, data: { filled: clean, ...touched() } }]);
    },
    async deleteBatch(id: string) {
      const r = cur();
      const used = r.sales.some((s) => s.lines.some((l) => l.batchId === id)) || r.orders.some((o) => o.packed?.some((l) => l.batchId === id)) || r.writeOffs.some((w) => w.batchId === id);
      need(!used, 'Bottles from this batch are already sold, packed or written off, so it is kept.');
      await store.commit([{ op: 'delete', col: 'batches', id }]);
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
    async saveSale(input: { lines: OrderLine[]; customerName: string; method: string; received?: number; emptiesBack?: number; note?: string }): Promise<string> {
      const wanted = cleanOrderLines(input.lines);
      need(wanted.length, 'Add at least one bottle.');
      const lines = takeFromFridge(fridge(), wanted, productName, sizeLabel);
      const ops: Op[] = [];
      const credit = input.method === 'On credit';
      const customerId = resolveCustomer(ops, input.customerName);
      need(!credit || customerId, 'A sale on credit needs the customer\'s name.');
      const date = todayYmd();
      const d = new Date();
      const id = newId();
      ops.push({
        op: 'set',
        col: 'sales',
        id,
        data: {
          number: nextNumber('S', cur().sales.map((s) => s.number)),
          date,
          time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          customerId,
          customerName: customerId ? text(input.customerName) : 'Walk-in',
          lines,
          method: input.method || 'Cash',
          emptiesBack: Math.max(0, Math.round(num(input.emptiesBack))),
          note: text(input.note),
          ...created(),
        },
      });
      if (!credit) ops.push(paymentOp('sale', id, linesValue(lines), date, input.method || 'Cash'));
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
      if ((stage === 'Ready' || stage === 'Out for delivery' || stage === 'Delivered') && !packedNow) data.packed = takeFromFridge(fridge(), o!.lines, productName, sizeLabel);
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
      await store.commit([{ op: 'delete', col: 'payments', id }]);
    },

    // ---------- customers ----------
    async saveCustomer(input: Input<Customer>, id?: string): Promise<string> {
      const name = text(input.name);
      need(name, "Type the customer's name.");
      const clash = cur().customers.find((c) => c.id !== id && sameName(c.name, name));
      need(!clash, `There is already a customer called ${clash?.name}.`);
      const s = save('customers', id, { name, type: text(input.type) || 'Shop', phone: text(input.phone), place: text(input.place), notes: text(input.notes) }, { archived: false });
      await store.commit([s.op]);
      return s.id;
    },
    async archiveCustomer(id: string, archived: boolean) {
      await store.commit([{ op: 'patch', col: 'customers', id, data: { archived, ...touched() } }]);
    },
    async deleteCustomer(id: string) {
      const used = cur().orders.some((o) => o.customerId === id) || cur().sales.some((s) => s.customerId === id);
      need(!used, 'This customer has orders or sales, so the record is kept. Use Hide instead.');
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
    async archiveStaff(id: string, archived: boolean) {
      await store.commit([{ op: 'patch', col: 'staff', id, data: { archived, ...touched() } }]);
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

    /** For restore and "delete all records". */
    async commitRaw(ops: Op[]) {
      if (ops.length) await store.commit(ops);
    },
  };
}

export type Actions = ReturnType<typeof makeActions>;

// ---------- the usual set, offered once on an empty app ----------

const STARTER_ITEMS: [string, 'fruit' | 'packaging', string, number][] = [
  ['Mangoes', 'fruit', 'kg', 30],
  ['Passion fruit', 'fruit', 'kg', 15],
  ['Pineapples', 'fruit', 'pcs', 15],
  ['Watermelons', 'fruit', 'pcs', 5],
  ['Oranges', 'fruit', 'kg', 20],
  ['Ginger', 'fruit', 'kg', 1],
  ['Lemons', 'fruit', 'kg', 2],
  ['Mint', 'fruit', 'bunches', 4],
  ['Carrots', 'fruit', 'kg', 8],
  ['Beetroot', 'fruit', 'kg', 4],
  ['Cucumbers', 'fruit', 'kg', 6],
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
  { name: 'Mango', kind: 'single', icon: '🥭', colour: '#FFA41B', water: 4, keepsDays: 3, recipe: [['Mangoes', 12], ['Sugar', 1]] },
  { name: 'Passion fruit', kind: 'single', icon: '🟣', colour: '#8E3FA0', water: 7, keepsDays: 3, recipe: [['Passion fruit', 4], ['Sugar', 1.5]] },
  { name: 'Pineapple', kind: 'single', icon: '🍍', colour: '#E9B800', water: 3, keepsDays: 3, recipe: [['Pineapples', 8], ['Sugar', 0.8]] },
  { name: 'Watermelon', kind: 'single', icon: '🍉', colour: '#E8445A', water: 0, keepsDays: 2, recipe: [['Watermelons', 4], ['Lemons', 0.3]] },
  { name: 'Orange', kind: 'single', icon: '🍊', colour: '#F7811E', premium: true, water: 0, keepsDays: 3, recipe: [['Oranges', 16]] },
  { name: 'Tropical Sunrise', kind: 'cocktail', icon: '🍹', colour: '#3BA935', water: 3, keepsDays: 3, tag: 'Mango, pineapple, passion', recipe: [['Mangoes', 4], ['Pineapples', 3], ['Passion fruit', 2], ['Sugar', 1]] },
  { name: 'Mango Passion', kind: 'cocktail', icon: '🥭', colour: '#C2571A', water: 4, keepsDays: 3, tag: 'Mango, passion fruit', recipe: [['Mangoes', 8], ['Passion fruit', 2], ['Sugar', 1]] },
  { name: 'Pineapple Ginger Zing', kind: 'cocktail', icon: '🍍', colour: '#B58A00', water: 3, keepsDays: 3, tag: 'Pineapple, ginger, lemon', recipe: [['Pineapples', 7], ['Ginger', 0.5], ['Lemons', 0.3], ['Sugar', 0.8]] },
  { name: 'Watermelon Mint Cooler', kind: 'cocktail', icon: '🍉', colour: '#D33A55', water: 0, keepsDays: 2, tag: 'Watermelon, mint, lemon', recipe: [['Watermelons', 4], ['Mint', 2], ['Lemons', 0.3]] },
  { name: 'Orange Carrot Glow', kind: 'cocktail', icon: '🥕', colour: '#E86A10', premium: true, water: 0, keepsDays: 2, tag: 'Orange, carrot', recipe: [['Oranges', 10], ['Carrots', 4]] },
  { name: 'Beetroot Power', kind: 'cocktail', icon: '🔴', colour: '#A3203F', water: 3, keepsDays: 3, tag: 'Beetroot, pineapple, ginger', recipe: [['Beetroot', 3], ['Pineapples', 4], ['Ginger', 0.3], ['Sugar', 0.5]] },
  { name: 'Green Fresh', kind: 'cocktail', icon: '🥒', colour: '#2F8F3A', water: 2, keepsDays: 2, tag: 'Cucumber, pineapple, mint, lemon', recipe: [['Cucumbers', 4], ['Pineapples', 4], ['Lemons', 0.4], ['Mint', 1]] },
];
