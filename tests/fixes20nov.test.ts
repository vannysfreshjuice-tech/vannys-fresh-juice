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

  it('cannot go below the bottles already sold, nor change juice once any are gone', async () => {
    const app = await juiceApp();
    await app.actions.saveBatch(input(app.productId, app.mango));
    await app.actions.saveSale({ date: '2026-11-18', lines: app.bottle(5), customerName: 'Test One', method: 'Cash' });
    const id = app.batch().id;
    await expect(app.actions.updateBatch(id, input(app.productId, app.mango, { filled: { '500': 4 } }))).rejects.toThrow(/5 × 500 ml .* cannot have fewer/);
    await expect(app.actions.updateBatch(id, input(app.other, app.mango))).rejects.toThrow(/juice stays the same/);
    await app.actions.updateBatch(id, input(app.productId, app.mango, { filled: { '500': 5 }, litres: 2.5 }));
    expect(app.batch().filled).toEqual({ '500': 5 });
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
