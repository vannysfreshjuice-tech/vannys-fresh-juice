// 20 Nov 2026: changing batches and purchases already recorded, counts on an earlier day, and the
// "Not balanced yet" checks.
import { describe, expect, it } from 'vitest';
import { balanceChecks } from '../src/lib/checks';
import { itemLevels } from '../src/lib/juice';
import { testApp } from './helpers';

async function juiceApp() {
  const app = await testApp();
  const mango = await app.actions.saveItem({ name: 'Mangoes', kind: 'fruit', unit: 'pcs', reorderLevel: 0 });
  const productId = await app.actions.saveProduct({ name: 'Mango', kind: 'single', icon: '🥭', colour: '#F7931E', premium: false, recipe: [{ itemId: mango, qty: 12 }], water: 4, keepsDays: 3 });
  const other = await app.actions.saveProduct({ name: 'Soursop', kind: 'single', icon: '🍈', colour: '#3BA935', premium: false, recipe: [], water: 0, keepsDays: 2 });
  const bottle = (qty = 1) => [{ productId, size: '500', qty, price: 3000 }];
  const checks = () => {
    const r = app.records();
    const s = app.settings();
    return balanceChecks({ items: r.items, levels: itemLevels(r.items, r.purchases, r.batches, r.counts, s.sizes, s.perBottle), batches: r.batches, sales: r.sales, orders: r.orders, writeOffs: r.writeOffs, today: '2026-11-20' });
  };
  const batch = () => app.records().batches[0];
  const product = () => app.records().products.find((p) => p.id === productId)!;
  return { ...app, mango, productId, other, bottle, checks, batch, product };
}

const input = (productId: string, mango: string, over: Record<string, unknown> = {}) => ({ date: '2026-11-18', productId, litres: 8.5, used: [{ itemId: mango, qty: 10 }], filled: { '500': 17 }, madeBy: '', checks: [], ...over });

describe('changing a batch already recorded', () => {
  it('changes the day, bottles and what went in; best-before and the recipe follow', async () => {
    const app = await juiceApp();
    await app.actions.saveBatch(input(app.productId, app.mango));
    const id = app.batch().id;
    await app.actions.updateBatch(id, input(app.productId, app.mango, { date: '2026-11-17', litres: 6, filled: { '500': 12 }, used: [{ itemId: app.mango, qty: 9 }] }));
    expect(app.batch()).toMatchObject({ date: '2026-11-17', bestBefore: '2026-11-20', litres: 6, filled: { '500': 12 }, used: [{ itemId: app.mango, qty: 9 }] });
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 15 }]); // 9 x 10 / 6
  });

  it('bottles already sold stay sold when the batch has fewer bottles, changes juice or is deleted', async () => {
    const app = await juiceApp();
    await app.actions.saveBatch(input(app.productId, app.mango));
    await app.actions.saveSale({ date: '2026-11-18', lines: app.bottle(5), customerName: 'Test One', method: 'Cash' });
    const id = app.batch().id;
    const sale = () => app.records().sales[0];
    expect(sale().lines[0].batchId).toBe(id);
    // fewer bottles than were sold from it: the sale leaves the batch (matched again by the fridge count)
    await app.actions.updateBatch(id, input(app.productId, app.mango, { filled: { '500': 4 }, litres: 2 }));
    expect(sale().lines[0].batchId).toBeUndefined();
    expect(sale().lines[0].qty).toBe(5);
    expect(app.checks().filter((c) => c.what === 'sold')).toEqual([expect.objectContaining({ qty: 1 })]);
    // another juice: nothing of Mango is left to match them
    await app.actions.updateBatch(id, input(app.other, app.mango, { filled: { '500': 4 }, litres: 2 }));
    expect(app.checks().filter((c) => c.what === 'sold')).toEqual([expect.objectContaining({ qty: 5 })]);
    // a written-off bottle names its batch: not below it
    await app.actions.writeOff({ batchId: id, size: '500', qty: 2, reason: 'Went sour', date: '2026-11-18' });
    await expect(app.actions.updateBatch(id, input(app.other, app.mango, { filled: { '500': 1 }, litres: 0.5 }))).rejects.toThrow(/written off/);
    await app.actions.deleteBatch(id);
    expect(app.records().batches).toHaveLength(0);
    expect(app.records().writeOffs).toHaveLength(0);
    expect(sale().lines[0].qty).toBe(5);
  });

  it('a Day list count joins the recipe average once its fruit is typed', async () => {
    const app = await juiceApp();
    await app.actions.quickBatch({ date: '2026-11-18', productId: app.productId, size: '500', bottles: 10 });
    expect(app.product().recipeAvg ?? null).toBeNull();
    await app.actions.updateBatch(app.batch().id, input(app.productId, app.mango, { litres: 5, filled: { '500': 10 }, used: [{ itemId: app.mango, qty: 8 }], measured: true }));
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 16 }]);
  });
});

describe('changing a purchase, and counting on an earlier day', () => {
  it('changes quantity, price and day; not below what was paid', async () => {
    const app = await juiceApp();
    const id = await app.actions.savePurchase({ date: '2026-11-18', supplierName: 'Market', itemId: app.mango, qty: 8, price: 500 }, { amount: 3000, method: 'Cash' });
    await app.actions.updatePurchase(id, { date: '2026-11-17', supplierName: 'Owino', itemId: app.mango, qty: 11, price: 500 });
    expect(app.records().purchases[0]).toMatchObject({ date: '2026-11-17', supplierName: 'Owino', qty: 11, price: 500 });
    expect(app.records().suppliers.map((s) => s.name).sort()).toEqual(['Market', 'Owino']);
    await expect(app.actions.updatePurchase(id, { date: '2026-11-17', supplierName: 'Owino', itemId: app.mango, qty: 5, price: 500 })).rejects.toThrow(/already paid/);
  });
  it('a count can be dated on an earlier day, not a later one', async () => {
    const app = await juiceApp();
    await app.actions.saveCount(app.mango, 3, 0, 'Bought but not recorded', '2026-11-17');
    expect(app.records().counts[0]).toMatchObject({ date: '2026-11-17', qty: 3 });
    await expect(app.actions.saveCount(app.mango, 5, 3, 'Count', '2999-01-01')).rejects.toThrow(/future/);
  });
});

describe('not balanced yet', () => {
  it('shows fruit used but not bought, and clears when the purchase is recorded', async () => {
    const app = await juiceApp();
    await app.actions.savePurchase({ date: '2026-11-17', supplierName: 'Market', itemId: app.mango, qty: 8, price: 500 });
    await app.actions.saveBatch(input(app.productId, app.mango, { used: [{ itemId: app.mango, qty: 11 }] }));
    expect(app.checks()).toEqual([expect.objectContaining({ what: 'stock', itemId: app.mango, qty: 3, used: 11, had: 8, date: '2026-11-18' })]);
    await app.actions.savePurchase({ date: '2026-11-18', supplierName: 'Market', itemId: app.mango, qty: 3, price: 500 });
    expect(app.checks()).toEqual([]);
  });

  it('shows bottles sold with nothing made recorded, until the bottles are added', async () => {
    const app = await juiceApp();
    await app.actions.quickBatch({ date: '2026-11-17', productId: app.productId, size: '500', bottles: 2 });
    await app.actions.saveSale({ date: '2026-11-19', lines: app.bottle(5), customerName: 'Test One', method: 'Cash' });
    // 2 came off the bottles of the 17th, 3 had nothing recorded
    expect(app.checks().filter((c) => c.what === 'sold')).toEqual([expect.objectContaining({ date: '2026-11-19', productId: app.productId, size: '500', qty: 3 })]);
    await app.actions.quickBatch({ date: '2026-11-19', productId: app.productId, size: '500', bottles: 10 });
    expect(app.checks().filter((c) => c.what === 'sold')).toEqual([]);
  });

  it('shows a batch not bottled from an earlier day, and bottles made with no fruit recorded', async () => {
    const app = await juiceApp();
    await app.actions.saveBatch(input(app.productId, app.mango, { filled: {}, date: '2026-11-18' }));
    await app.actions.quickBatch({ date: '2026-11-19', productId: app.other, size: '500', bottles: 6 });
    expect(app.checks().map((c) => c.what).sort()).toEqual(['bottling', 'fruit', 'stock']);
  });
});

describe('changing a sale already recorded', () => {
  it('moves it to another day and customer, and changes the price, not below what is paid', async () => {
    const app = await juiceApp();
    const id = await app.actions.saveSale({ date: '2026-11-19', lines: app.bottle(2), customerName: 'Test One', method: 'On credit' });
    await app.actions.addPayment('sale', id, { amount: 3000, date: '2026-11-19', method: 'Cash' });
    await app.actions.updateSale(id, { date: '2026-11-18', customerName: 'Test Two', prices: [2500] });
    const s = app.records().sales.find((x) => x.id === id)!;
    expect(s).toMatchObject({ date: '2026-11-18', customerName: 'Test Two', lines: [{ qty: 2, price: 2500 }] });
    await expect(app.actions.updateSale(id, { date: '2026-11-18', customerName: 'Test Two', prices: [1000] })).rejects.toThrow(/already paid/);
    await expect(app.actions.updateSale(id, { date: '2999-01-01', customerName: 'Test Two', prices: [2500] })).rejects.toThrow(/not come yet/);
  });
});

describe('bottles tapped as the wrong juice', () => {
  it('a day of one juice becomes another, and comes off its bottles', async () => {
    const app = await juiceApp();
    await app.actions.quickBatch({ date: '2026-11-16', productId: app.productId, size: '500', bottles: 13 });
    for (let i = 0; i < 3; i++) await app.actions.saveSale({ date: '2026-11-16', lines: [{ productId: app.other, size: '500', qty: 1, price: 3000 }], customerName: 'Test One', method: 'Cash' });
    expect(app.checks().filter((c) => c.what === 'sold')).toEqual([expect.objectContaining({ productId: app.other, qty: 3 })]);
    expect(await app.actions.changeSoldJuice('2026-11-16', app.other, '500', app.productId)).toBe(3);
    expect(app.checks().filter((c) => c.what === 'sold')).toEqual([]);
    expect(app.records().sales.every((s) => s.lines[0].productId === app.productId)).toBe(true);
  });
  it('a single sale can change juice, size and number of bottles', async () => {
    const app = await juiceApp();
    const id = await app.actions.saveSale({ date: '2026-11-19', lines: app.bottle(2), customerName: 'Test One', method: 'Cash' });
    await app.actions.updateSale(id, { date: '2026-11-19', customerName: 'Test One', lines: [{ productId: app.other, size: '1000', qty: 1, price: 6000 }] });
    expect(app.records().sales[0].lines).toEqual([{ productId: app.other, size: '1000', qty: 1, price: 6000 }]);
  });
  it('deleting only the recipe keeps the juice', async () => {
    const app = await juiceApp();
    await app.actions.clearRecipe(app.productId);
    expect(app.product()).toMatchObject({ name: 'Mango', recipe: [], water: 0 });
  });
});

describe('money paid ahead, day by day (24 Nov 2026: it looked stuck at 11,000)', () => {
  it('moves with every bottle and top-up; the Day list shows what was left at the end of the day shown', async () => {
    const app = await juiceApp();
    const id = await app.actions.saveCustomer({ name: 'Test One', type: 'Person' });
    const tap = async (date: string, price: number) => app.actions.saveSale({ date, lines: [{ productId: app.productId, size: '500', qty: 1, price }], customerName: 'Test One', method: 'From money paid ahead' });
    await app.actions.receiveMoney(id, { amount: 11000, date: '2026-11-13', method: 'Cash' });
    await tap('2026-11-16', 3000);
    await tap('2026-11-17', 5000);
    await tap('2026-11-18', 3000);
    await app.actions.receiveMoney(id, { amount: 17000, date: '2026-11-19', method: 'Cash' });
    await tap('2026-11-20', 3000);
    await tap('2026-11-20', 3000);
    const r = app.records();
    const { advanceHistory, advancesAsOf, customerAdvances } = await import('../src/lib/juice');
    const asOf = (d: string) => advancesAsOf(r.customers, r.orders, r.sales, r.payments, d).get(id);
    expect(['2026-11-13', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(asOf)).toEqual([11000, 8000, 3000, 0, 17000, 11000]);
    expect(customerAdvances(r.customers, r.orders, r.sales, r.payments).get(id)).toBe(11000);
    expect(advanceHistory(id, r.orders, r.sales, r.payments).map((h) => [h.amount, h.balance])).toEqual([
      [11000, 11000],
      [-3000, 8000],
      [-5000, 3000],
      [-3000, 0],
      [17000, 17000],
      [-3000, 14000],
      [-3000, 11000],
    ]);
  });
});

describe('a sale linked to a batch that ran short', () => {
  it('is matched to other bottles, or shown as not recorded, never dropped', async () => {
    const app = await juiceApp();
    // 10 made on the 17th; 8 sold on the 18th from them
    await app.actions.quickBatch({ date: '2026-11-17', productId: app.productId, size: '500', bottles: 10 });
    await app.actions.saveSale({ date: '2026-11-18', lines: app.bottle(8), customerName: 'Test One', method: 'Cash' });
    // 6 sold on the 16th without a batch, then the batch is moved to the 16th: they take 6 of its 10
    await app.store.commit([{ op: 'set', col: 'sales', id: 'early', data: { number: 'S-9', date: '2026-11-16', time: '', customerId: '', customerName: 'Walk-in', lines: app.bottle(6), method: 'Cash', createdAt: 1, updatedAt: 1 } }]);
    const b = app.records().batches[0];
    await app.actions.updateBatch(b.id, { date: '2026-11-16', productId: app.productId, litres: 5, used: b.used, filled: { '500': 10 }, madeBy: '', checks: [] });
    // the 18th: 4 still come off the batch, the other 4 show as sold with nothing recorded
    const r = app.records();
    const { dayStock } = await import('../src/lib/day');
    expect(dayStock('2026-11-18', r.batches, r.sales, r.orders, r.writeOffs)).toMatchObject({ before: 4, sold: 4, left: 0, unrecorded: 4 });
    // once the 18th's own bottles are recorded, they come off those
    await app.actions.quickBatch({ date: '2026-11-18', productId: app.productId, size: '500', bottles: 12 });
    const r2 = app.records();
    expect(dayStock('2026-11-18', r2.batches, r2.sales, r2.orders, r2.writeOffs)).toMatchObject({ before: 4, made: 12, sold: 8, left: 8, unrecorded: 0 });
  });
});

describe('audit 24 Nov 2026', () => {
  it('a sale written in for an earlier day does not take bottles made later', async () => {
    const app = await juiceApp();
    await app.actions.quickBatch({ date: '2026-11-20', productId: app.productId, size: '500', bottles: 20 });
    await app.actions.saveSale({ date: '2026-11-16', lines: app.bottle(5), customerName: 'Test One', method: 'Cash' });
    expect(app.records().sales[0].lines[0].batchId).toBeUndefined();
    const r = app.records();
    const { dayStock } = await import('../src/lib/day');
    expect(dayStock('2026-11-16', r.batches, r.sales, r.orders, r.writeOffs)).toMatchObject({ sold: 0, unrecorded: 5 });
    expect(dayStock('2026-11-20', r.batches, r.sales, r.orders, r.writeOffs)).toMatchObject({ made: 20, left: 20 });
  });
});
