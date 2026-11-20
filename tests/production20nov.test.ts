// 20 Nov 2026: bottles sold before the production was recorded, the day's fridge sum, and recipes
// that are the average of real batches.
import { describe, expect, it } from 'vitest';
import { dayStock } from '../src/lib/day';
import { fridgeTotal } from '../src/lib/juice';
import { fridgeByBatch } from '../src/lib/juice';
import { testApp } from './helpers';

async function juiceApp() {
  const app = await testApp();
  const mango = await app.actions.saveItem({ name: 'Mangoes', kind: 'fruit', unit: 'pcs', reorderLevel: 0 });
  const productId = await app.actions.saveProduct({ name: 'Mango', kind: 'single', icon: '🥭', colour: '#F7931E', premium: false, recipe: [{ itemId: mango, qty: 12 }], water: 4, keepsDays: 3 });
  const bottle = (qty = 1) => [{ productId, size: '500', qty, price: 3000 }];
  const st = (day: string) => {
    const r = app.records();
    return dayStock(day, r.batches, r.sales, r.orders, r.writeOffs);
  };
  const fridge = () => {
    const r = app.records();
    return fridgeTotal(fridgeByBatch(r.batches, r.sales, r.orders, r.writeOffs));
  };
  const product = () => app.records().products.find((p) => p.id === productId)!;
  return { ...app, mango, productId, bottle, st, fridge, product };
}

describe('bottles sold before the production was recorded', () => {
  it('come off the bottles recorded later that day, not added to the fridge again', async () => {
    const app = await juiceApp();
    for (let i = 0; i < 5; i++) await app.actions.saveSale({ date: '2026-11-19', lines: app.bottle(), customerName: 'Test One', method: 'Cash' });
    expect(app.st('2026-11-19')).toMatchObject({ before: 0, made: 0, sold: 0, left: 0, unrecorded: 5 });
    // the production is written in afterwards
    await app.actions.quickBatch({ date: '2026-11-19', productId: app.productId, size: '500', bottles: 17 });
    expect(app.st('2026-11-19')).toEqual({ before: 0, made: 17, sold: 5, spoiled: 0, left: 12, unrecorded: 0 });
    expect(app.fridge()).toBe(12);
    // new sales take from the 12 left
    await app.actions.saveSale({ date: '2026-11-19', lines: app.bottle(2), customerName: 'Test One', method: 'Cash' });
    expect(app.fridge()).toBe(10);
    expect(app.st('2026-11-19').left).toBe(10);
  });

  it('do not come off bottles made on a later day', async () => {
    const app = await juiceApp();
    await app.actions.saveSale({ date: '2026-11-18', lines: app.bottle(3), customerName: 'Test One', method: 'Cash' });
    await app.actions.quickBatch({ date: '2026-11-19', productId: app.productId, size: '500', bottles: 10 });
    expect(app.fridge()).toBe(10);
    expect(app.st('2026-11-18').unrecorded).toBe(3);
  });
});

describe("the day's fridge sum", () => {
  it('carries what is left to the next day, and agrees with the fridge', async () => {
    const app = await juiceApp();
    await app.actions.quickBatch({ date: '2026-11-17', productId: app.productId, size: '500', bottles: 17 });
    await app.actions.saveSale({ date: '2026-11-17', lines: app.bottle(14), customerName: 'Test One', method: 'Cash' });
    expect(app.st('2026-11-17')).toMatchObject({ before: 0, made: 17, sold: 14, left: 3 });
    // next day: the last 2 are sold, nothing new made
    await app.actions.saveSale({ date: '2026-11-18', lines: app.bottle(2), customerName: 'Test Two', method: 'Cash' });
    expect(app.st('2026-11-18')).toMatchObject({ before: 3, made: 0, sold: 2, left: 1 });
    expect(app.fridge()).toBe(1);
    // the day after: 1 goes bad
    const b = app.records().batches[0];
    await app.actions.writeOff({ batchId: b.id, size: '500', qty: 1, reason: 'Went sour', date: '2026-11-19' });
    expect(app.st('2026-11-19')).toMatchObject({ before: 1, made: 0, sold: 0, spoiled: 1, left: 0 });
    expect(app.fridge()).toBe(0);
    // every day: before + made - sold - spoiled = left, and the evening's left is the next morning's before
    for (const d of ['2026-11-17', '2026-11-18', '2026-11-19']) {
      const s = app.st(d);
      expect(s.before + s.made - s.sold - s.spoiled).toBe(s.left);
    }
    expect(app.st('2026-11-18').before).toBe(app.st('2026-11-17').left);
  });
});

describe('recipe = the average of real batches', () => {
  it('follows the batches, weighted by litres; a Day list count does not change it', async () => {
    const app = await juiceApp();
    // 10 mangoes gave 8.5 litres (17 x 500 ml), then 12 mangoes gave 6 litres
    await app.actions.saveBatch({ date: '2026-11-17', productId: app.productId, litres: 8.5, used: [{ itemId: app.mango, qty: 10 }], filled: { '500': 17 }, madeBy: '', checks: [], water: 4 });
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 11.765 }]);
    expect(app.product().recipeAvg).toEqual({ batches: 1, litres: 8.5, last: '2026-11-17' });
    await app.actions.saveBatch({ date: '2026-11-18', productId: app.productId, litres: 6, used: [{ itemId: app.mango, qty: 12 }], filled: { '500': 12 }, madeBy: '', checks: [], water: 3 });
    // (10 + 12) x 10 / 14.5 = 15.172; water (4 + 3) x 10 / 14.5 = 4.828
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 15.172 }]);
    expect(app.product().water).toBe(4.828);
    expect(app.product().recipeAvg?.batches).toBe(2);
    await app.actions.quickBatch({ date: '2026-11-19', productId: app.productId, size: '500', bottles: 10 });
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 15.172 }]);
    // deleting a batch takes it out of the average
    const first = app.records().batches.find((b) => b.date === '2026-11-17')!;
    await app.actions.deleteBatch(first.id);
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 20 }]);
  });

  it('a recipe worked out from a batch, recorded, joins the average', async () => {
    const app = await juiceApp();
    await app.actions.saveBatch({ date: '2026-11-17', productId: app.productId, litres: 5, used: [{ itemId: app.mango, qty: 10 }], filled: { '500': 10 }, madeBy: '', checks: [] });
    const p = app.product();
    await app.actions.saveProductFromBatch({ name: p.name, kind: p.kind, icon: p.icon, colour: p.colour, premium: false, keepsDays: 3 }, [{ name: 'Mangoes', qty: 20, unit: 'pcs' }], 0, { '500': 10 }, true, '', p.id, '2026-11-18');
    // (10 + 20) x 10 / (5 + 5) = 30
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 30 }]);
    expect(app.product().recipeAvg?.batches).toBe(2);
  });

  it('typing the recipe by hand clears the "average of" note until the next batch', async () => {
    const app = await juiceApp();
    await app.actions.saveBatch({ date: '2026-11-17', productId: app.productId, litres: 5, used: [{ itemId: app.mango, qty: 10 }], filled: { '500': 10 }, madeBy: '', checks: [] });
    const p = app.product();
    await app.actions.saveProductByNames({ name: p.name, kind: p.kind, icon: p.icon, colour: p.colour, premium: false, keepsDays: 3, water: 2 }, [{ name: 'Mangoes', qty: 25, unit: 'pcs' }], p.id);
    expect(app.product().recipe).toEqual([{ itemId: app.mango, qty: 25 }]);
    expect(app.product().recipeAvg ?? null).toBeNull();
  });
});
