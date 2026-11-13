// The saving rules: what each action writes, what it refuses, and that a backup holds everything.
import { describe, expect, it } from 'vitest';
import { makeLocalStore } from '../src/data/localStore';
import { countRows, deleteAllOps, makeBackup, restoreOps } from '../src/lib/backup';
import { todayYmd } from '../src/lib/dates';
import { customerBalances, fridgeByBatch, fridgeCount, itemLevels, orderTotals, paymentsByRef, saleTotals } from '../src/lib/juice';
import { COLLECTIONS, RECORD_COLS } from '../src/lib/types';
import { memoryStorage, testApp } from './helpers';

/** Starter set, 20 kg of mangoes, sugar and bottles bought, and two mango batches. */
async function stocked() {
  const app = await testApp();
  await app.actions.addStarterSet();
  const r = app.records();
  const id = (name: string) => r.items.find((i) => i.name === name)!.id;
  const mango = r.products.find((p) => p.name === 'Mango')!;
  await app.actions.savePurchase({ date: '2026-11-01', supplierName: 'Mama Rose', itemId: id('Mangoes'), qty: 30, price: 2000 }, { amount: 60000, method: 'Cash' });
  await app.actions.savePurchase({ date: '2026-11-01', supplierName: 'Kikuubo', itemId: id('Sugar'), qty: 10, price: 4800 });
  await app.actions.savePurchase({ date: '2026-11-01', supplierName: 'Kampala Packaging', itemId: id('Bottles 500 ml'), qty: 100, price: 300 });
  // older batch first (best before sooner), then a newer one
  await app.actions.saveBatch({ date: '2026-11-10', productId: mango.id, litres: 5, used: [{ itemId: id('Mangoes'), qty: 6 }, { itemId: id('Sugar'), qty: 0.5 }], filled: { '500': 10 }, madeBy: 'Brian', checks: [] });
  await app.actions.saveBatch({ date: '2026-11-11', productId: mango.id, litres: 10, used: [{ itemId: id('Mangoes'), qty: 12 }, { itemId: id('Sugar'), qty: 1 }], filled: { '500': 20 }, madeBy: 'Brian', checks: [] });
  return { ...app, id, mango };
}

describe('starter set', () => {
  it('adds the 12 juices, 19 stock items and links each bottle size, once', async () => {
    const app = await testApp();
    await app.actions.addStarterSet();
    expect(app.records().products).toHaveLength(12);
    expect(app.records().products.filter((p) => p.kind === 'cocktail')).toHaveLength(7);
    expect(app.records().items).toHaveLength(19);
    expect(app.settings().sizes.every((s) => s.bottleItemId)).toBe(true);
    expect(app.settings().perBottle).toHaveLength(2);
    await app.actions.addStarterSet();
    expect(app.records().products).toHaveLength(12);
    expect(app.records().items).toHaveLength(19);
  });
});

describe('batches and stock', () => {
  it('takes fruit, sugar and bottles off stock', async () => {
    const app = await stocked();
    const r = app.records();
    const levels = itemLevels(r.items, r.purchases, r.batches, r.counts, app.settings().sizes, app.settings().perBottle);
    expect(levels.get(app.id('Mangoes'))!.onHand).toBe(12); // 30 - 6 - 12
    expect(levels.get(app.id('Sugar'))!.onHand).toBe(8.5);
    expect(levels.get(app.id('Bottles 500 ml'))!.onHand).toBe(70); // 100 - 30 filled
    expect(levels.get(app.id('Caps'))!.onHand).toBe(-30); // none bought, 30 used: shows the shortfall
    expect(r.batches.map((b) => b.number).sort()).toEqual(['B-0001', 'B-0002']);
    expect(r.batches.find((b) => b.number === 'B-0001')!.bestBefore).toBe('2026-11-13');
  });
  it('refuses bottles holding more than the litres made', async () => {
    const app = await stocked();
    await expect(app.actions.saveBatch({ date: '2026-11-12', productId: app.mango.id, litres: 2, used: [], filled: { '500': 5 }, madeBy: '', checks: [] })).rejects.toThrow(/more than the 2 litres/);
  });
});

describe('counter sales', () => {
  it('sells from the oldest batch first and records the payment', async () => {
    const app = await stocked();
    const id = await app.actions.saveSale({ lines: [{ productId: app.mango.id, size: '500', qty: 12, price: 3000 }], customerName: '', method: 'Cash' });
    const r = app.records();
    const sale = r.sales.find((s) => s.id === id)!;
    const b1 = r.batches.find((b) => b.number === 'B-0001')!;
    const b2 = r.batches.find((b) => b.number === 'B-0002')!;
    expect(sale.lines).toEqual([
      { productId: app.mango.id, size: '500', qty: 10, price: 3000, batchId: b1.id },
      { productId: app.mango.id, size: '500', qty: 2, price: 3000, batchId: b2.id },
    ]);
    expect(sale.number).toBe('S-0001');
    const fridge = fridgeByBatch(r.batches, r.sales, r.orders, r.writeOffs);
    expect(fridgeCount(fridge, app.mango.id, '500')).toBe(18);
    expect(saleTotals(sale, paymentsByRef(r.payments).get(id)).status).toBe('Paid');
    expect(r.payments.find((p) => p.refId === id)!.amount).toBe(36000);
  });
  it('refuses to sell more than the fridge holds', async () => {
    const app = await stocked();
    await expect(app.actions.saveSale({ lines: [{ productId: app.mango.id, size: '500', qty: 31, price: 3000 }], customerName: '', method: 'Cash' })).rejects.toThrow('Only 30 × Mango 500 ml in the fridge.');
    expect(app.records().sales).toHaveLength(0);
  });
  it('a credit sale needs a name, takes no payment and shows as owed', async () => {
    const app = await stocked();
    await expect(app.actions.saveSale({ lines: [{ productId: app.mango.id, size: '500', qty: 2, price: 3000 }], customerName: '', method: 'On credit' })).rejects.toThrow(/needs the customer/);
    await app.actions.saveSale({ lines: [{ productId: app.mango.id, size: '500', qty: 2, price: 3000 }], customerName: 'Mama Sarah', method: 'On credit' });
    const r = app.records();
    expect(r.payments.filter((p) => p.kind === 'sale')).toHaveLength(0);
    const c = r.customers.find((x) => x.name === 'Mama Sarah')!;
    expect(customerBalances(r.customers, r.orders, r.sales, paymentsByRef(r.payments)).get(c.id)).toBe(6000);
  });
  it('undoing a sale puts the bottles back and removes the payment', async () => {
    const app = await stocked();
    const id = await app.actions.saveSale({ lines: [{ productId: app.mango.id, size: '500', qty: 3, price: 3000 }], customerName: '', method: 'MTN MoMo' });
    await app.actions.deleteSale(id);
    const r = app.records();
    expect(fridgeCount(fridgeByBatch(r.batches, r.sales, r.orders, r.writeOffs), app.mango.id, '500')).toBe(30);
    expect(r.payments).toHaveLength(1); // only the mango purchase payment is left
  });
});

describe('orders', () => {
  const line = (pid: string, qty: number) => [{ productId: pid, size: '500', qty, price: 3000 }];
  it('saves the order with its deposit and its reminders together', async () => {
    const app = await stocked();
    const id = await app.actions.saveOrder({ customerName: 'Kato Supermarket', date: '2026-11-12', dueDate: '2026-11-13', lines: line(app.mango.id, 20), deliveryFee: 5000 }, undefined, { amount: 20000, method: 'Cash' }, [
      { date: '2026-11-12', time: '06:00', what: 'Make 20 mango', repeat: '', ways: ['calendar'] },
    ]);
    const r = app.records();
    const o = r.orders.find((x) => x.id === id)!;
    expect(o.number).toBe('VJ-0001');
    expect(o.stage).toBe('To make');
    expect(orderTotals(o, paymentsByRef(r.payments).get(id))).toMatchObject({ value: 65000, paid: 20000, balance: 45000, status: 'Part paid' });
    expect(r.reminders).toHaveLength(1);
    expect(r.reminders[0].orderId).toBe(id);
  });
  it('refuses a deposit above the total', async () => {
    const app = await stocked();
    await expect(app.actions.saveOrder({ customerName: 'Kato', date: '2026-11-12', dueDate: '2026-11-13', lines: line(app.mango.id, 2) }, undefined, { amount: 7000, method: 'Cash' })).rejects.toThrow(/more than the order's total/);
    expect(app.records().orders).toHaveLength(0);
  });
  it('Ready packs bottles from the fridge; Cancelled puts them back and owes nothing', async () => {
    const app = await stocked();
    const id = await app.actions.saveOrder({ customerName: 'Kato', date: '2026-11-12', dueDate: '2026-11-13', lines: line(app.mango.id, 25) });
    await app.actions.setOrderStage(id, 'Ready');
    let r = app.records();
    expect(r.orders[0].packed!.reduce((t, l) => t + l.qty, 0)).toBe(25);
    expect(fridgeCount(fridgeByBatch(r.batches, r.sales, r.orders, r.writeOffs), app.mango.id, '500')).toBe(5);
    await app.actions.setOrderStage(id, 'Cancelled');
    r = app.records();
    expect(fridgeCount(fridgeByBatch(r.batches, r.sales, r.orders, r.writeOffs), app.mango.id, '500')).toBe(30);
    expect(orderTotals(r.orders[0], []).balance).toBe(0);
  });
  it('cannot be marked Ready when the fridge is short', async () => {
    const app = await stocked();
    const id = await app.actions.saveOrder({ customerName: 'Kato', date: '2026-11-12', dueDate: '2026-11-13', lines: line(app.mango.id, 40) });
    await expect(app.actions.setOrderStage(id, 'Ready')).rejects.toThrow('Only 30 × Mango 500 ml in the fridge.');
    expect(app.records().orders[0].stage).toBe('To make');
  });
  it('Delivered is dated today, and a payment above the balance is refused', async () => {
    const app = await stocked();
    const id = await app.actions.saveOrder({ customerName: 'Kato', date: '2026-11-12', dueDate: '2026-11-13', lines: line(app.mango.id, 2) });
    await app.actions.setOrderStage(id, 'Delivered');
    expect(app.records().orders[0].deliveredOn).toBe(todayYmd());
    await expect(app.actions.addPayment('order', id, { amount: 6001, date: '2026-11-13', method: 'Cash' })).rejects.toThrow(/more than the balance of UGX 6,000/);
    await app.actions.addPayment('order', id, { amount: 6000, date: '2026-11-13', method: 'Cash' });
    await expect(app.actions.addPayment('order', id, { amount: 1, date: '2026-11-13', method: 'Cash' })).rejects.toThrow(/already fully paid/);
  });
  it('a packed order cannot be changed until it is moved back to To make', async () => {
    const app = await stocked();
    const id = await app.actions.saveOrder({ customerName: 'Kato', date: '2026-11-12', dueDate: '2026-11-13', lines: line(app.mango.id, 2) });
    await app.actions.setOrderStage(id, 'Ready');
    await expect(app.actions.saveOrder({ customerName: 'Kato', date: '2026-11-12', dueDate: '2026-11-13', lines: line(app.mango.id, 3) }, id)).rejects.toThrow(/already packed/);
  });
});

describe('write-offs and deletes', () => {
  it('writes off no more than is left, and keeps a batch with bottles gone', async () => {
    const app = await stocked();
    const b1 = app.records().batches.find((b) => b.number === 'B-0001')!;
    await expect(app.actions.writeOff({ batchId: b1.id, size: '500', qty: 11, reason: 'Went sour' })).rejects.toThrow('Only 10 bottles');
    await app.actions.writeOff({ batchId: b1.id, size: '500', qty: 4, reason: 'Went sour' });
    await expect(app.actions.deleteBatch(b1.id)).rejects.toThrow(/so it is kept/);
  });
  it('keeps a customer with orders, an item in a recipe and a juice with batches', async () => {
    const app = await stocked();
    await app.actions.saveOrder({ customerName: 'Kato', date: '2026-11-12', dueDate: '2026-11-13', lines: [{ productId: app.mango.id, size: '500', qty: 1, price: 3000 }] });
    const kato = app.records().customers.find((c) => c.name === 'Kato')!;
    await expect(app.actions.deleteCustomer(kato.id)).rejects.toThrow(/Use Hide instead/);
    await expect(app.actions.deleteItem(app.id('Mangoes'))).rejects.toThrow(/Use Hide instead/);
    await expect(app.actions.deleteProduct(app.mango.id)).rejects.toThrow(/Use Hide instead/);
  });
});

describe('edits change only their own fields', () => {
  it('editing a customer keeps fields the form does not know', async () => {
    const app = await testApp();
    const id = await app.actions.saveCustomer({ name: 'Kato', type: 'Shop', phone: '0772 000000', place: 'Ntinda', notes: '' });
    await app.store.commit([{ op: 'patch', col: 'customers', id, data: { extra: 'kept' } }]);
    await app.actions.saveCustomer({ name: 'Kato Supermarket', type: 'Shop', phone: '0772 000000', place: 'Ntinda', notes: 'Fridays' }, id);
    const c = app.records().customers[0] as unknown as Record<string, unknown>;
    expect(c.name).toBe('Kato Supermarket');
    expect(c.extra).toBe('kept');
  });
  it('settings save only the fields given; defaults are never written', async () => {
    const app = await testApp();
    expect(app.settingsRow()).toBeNull();
    await app.actions.saveSettings({ receiptNote: 'Asante!' });
    const row = app.settingsRow() as Record<string, unknown>;
    expect(row.receiptNote).toBe('Asante!');
    expect(row.sizes).toBeUndefined();
    expect(app.settings().sizes).toHaveLength(4);
  });
});

describe('backup', () => {
  it('holds every collection and restores into an empty app', async () => {
    const app = await stocked();
    await app.actions.saveSale({ lines: [{ productId: app.mango.id, size: '500', qty: 1, price: 3000 }], customerName: 'Joan', method: 'Cash' });
    await app.actions.saveStaff({ name: 'Aisha', role: 'production', job: 'Juice maker', payKind: 'day', rate: 15000, phone: '' });
    await app.actions.saveReminder({ date: '2026-11-13', time: '06:00', what: 'Buy mangoes', repeat: '', ways: ['calendar'] });
    const backup = makeBackup(app.records(), app.settingsRow());
    for (const col of COLLECTIONS) if (col !== 'settings') expect(backup.data).toHaveProperty(col);
    const total = countRows(backup.data);
    expect(total).toBeGreaterThan(30);

    const fresh = makeLocalStore(memoryStorage());
    await fresh.commit(restoreOps(JSON.parse(JSON.stringify(backup.data))));
    let restored = 0;
    for (const col of RECORD_COLS) fresh.subscribe(col, (rows) => (restored += rows.length), () => {});
    await Promise.resolve();
    expect(restored).toBe(total);
  });
  it('delete all removes every record but keeps the settings', async () => {
    const app = await stocked();
    await app.actions.commitRaw(deleteAllOps(app.records()));
    for (const col of RECORD_COLS) expect(app.records()[col]).toHaveLength(0);
    expect(app.settingsRow()).not.toBeNull();
  });
});

describe('cloud access follows the staff list', () => {
  async function withSignIn() {
    const app = await testApp();
    const id = await app.actions.saveStaff({ name: 'Aisha', role: 'sales', job: '', payKind: 'day', rate: 15000, phone: '0772 000001' });
    // what the owner's "Give a PIN" writes on the staff record (the cloud part is tested by npm run test:rules)
    await app.store.commit([{ op: 'patch', col: 'staff', id, data: { loginUid: 'uid-aisha', loginPhone: '256772000001' } }]);
    const sent: { op: string; col: string; id: string }[] = [];
    const commit = app.store.commit.bind(app.store);
    app.store.commit = (ops) => (sent.push(...ops), commit(ops));
    return { ...app, id, sent };
  }
  it('"has left" closes their sign-in in the same change', async () => {
    const app = await withSignIn();
    await app.actions.archiveStaff(app.id, true);
    expect(app.sent).toContainEqual({ op: 'delete', col: 'members', id: 'uid-aisha' });
    expect(app.sent).toContainEqual({ op: 'delete', col: 'logins', id: '256772000001' });
    const s = app.records().staff.find((x) => x.id === app.id)!;
    expect(s.archived).toBe(true);
    expect(s.loginUid).toBe('');
  });
  it('bringing someone back does not reopen their old sign-in', async () => {
    const app = await withSignIn();
    await app.actions.archiveStaff(app.id, true);
    app.sent.length = 0;
    await app.actions.archiveStaff(app.id, false);
    expect(app.sent.some((o) => o.col === 'members')).toBe(false);
  });
  it('delete all also closes every staff sign-in', async () => {
    const app = await withSignIn();
    const ops = deleteAllOps(app.records());
    expect(ops).toContainEqual({ op: 'delete', col: 'members', id: 'uid-aisha' });
    expect(ops).toContainEqual({ op: 'delete', col: 'logins', id: '256772000001' });
  });
});
