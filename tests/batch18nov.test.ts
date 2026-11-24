// Start again from a date, the Home chart of the last weeks, event quotes, and money received from
// someone not yet in the customer list.
import { describe, expect, it } from 'vitest';
import { customerAdvances, customerBalances, isMoneyIn, itemLevels, paymentsByRef } from '../src/lib/juice';
import { weeklySeries } from '../src/lib/performance';
import { eventQuote } from '../src/lib/quote';
import { buildReport, dayFigures } from '../src/lib/reports';
import { mostSold, regulars } from '../src/lib/day';
import { FROM_ADVANCE, OPENING_NOTE } from '../src/lib/types';
import { testApp } from './helpers';

async function juiceApp() {
  const app = await testApp();
  const productId = await app.actions.saveProduct({ name: 'Fresh juice', kind: 'single', icon: '🥤', colour: '#F7931E', premium: false, recipe: [], water: 0, keepsDays: 3 });
  const bottle = (qty = 1, price = 3000) => [{ productId, size: '500', qty, price }];
  const cust = (name: string) => app.records().customers.find((c) => c.name === name)!;
  const figures = () => {
    const r = app.records();
    const byRef = paymentsByRef(r.payments);
    return { owes: customerBalances(r.customers, r.orders, r.sales, byRef), ahead: customerAdvances(r.customers, r.orders, r.sales, r.payments) };
  };
  return { ...app, productId, bottle, cust, figures };
}

/** Old records before 14 Nov and new ones from 14 Nov, for two test customers. */
async function withHistory() {
  const app = await juiceApp();
  // Test One: two bottles on credit before, 2,000 paid before, 1,000 paid after the cut-off day
  const s1 = await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(2), customerName: 'Test One', method: 'On credit' });
  await app.actions.addPayment('sale', s1, { amount: 2000, date: '2026-11-11', method: 'Cash' });
  await app.actions.addPayment('sale', s1, { amount: 1000, date: '2026-11-16', method: 'Cash' });
  // Test Two: 10,000 paid ahead before, one bottle from it before, one after
  await app.actions.saveCustomer({ name: 'Test Two', type: 'Person' });
  await app.actions.receiveMoney(app.cust('Test Two').id, { amount: 10000, date: '2026-11-05', method: 'Cash' });
  await app.actions.saveSale({ date: '2026-11-06', lines: app.bottle(), customerName: 'Test Two', method: FROM_ADVANCE });
  await app.actions.saveSale({ date: '2026-11-17', lines: app.bottle(), customerName: 'Test Two', method: FROM_ADVANCE });
  // a sale paid in full before, a batch before and after, an expense before
  await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: '', method: 'Cash' });
  await app.actions.quickBatch({ date: '2026-11-08', productId: app.productId, size: '500', bottles: 10 });
  await app.actions.quickBatch({ date: '2026-11-14', productId: app.productId, size: '500', bottles: 12 });
  await app.actions.saveExpense({ date: '2026-11-07', category: 'Transport', description: 'Test', method: 'Cash', amount: 5000 });
  // new sale from the cut-off day on
  await app.actions.saveSale({ date: '2026-11-16', lines: app.bottle(), customerName: 'Test One', method: 'On credit' });
  return app;
}

describe('start again from a date', () => {
  it('keeps what is owed and paid ahead, moves later payments, removes the old records', async () => {
    const app = await withHistory();
    const before = app.figures();
    const one = app.cust('Test One').id;
    const two = app.cust('Test Two').id;
    expect(before.owes.get(one)).toBe(6000); // 6,000 - 3,000 paid + 3,000 new
    expect(before.ahead.get(two)).toBe(4000);

    const plan = await app.actions.startAgainFrom('2026-11-14', true);
    expect(plan.owedCarried).toBe(4000); // 6,000 less the 2,000 paid before the day
    expect(plan.aheadCarried).toBe(7000); // 10,000 less the bottle before the day
    expect(plan.removed.sales).toBe(3);
    expect(plan.removed.batches).toBe(1);
    expect(plan.removed.expenses).toBe(1);

    // what customers owe and have ahead today does not change
    const after = app.figures();
    expect(after.owes.get(one)).toBe(6000);
    expect(after.ahead.get(two)).toBe(4000);

    const r = app.records();
    expect(r.sales.every((s) => s.date >= '2026-11-13')).toBe(true);
    expect(r.batches.map((b) => b.date)).toEqual(['2026-11-14']);
    expect(r.expenses).toHaveLength(0);
    const opening = r.sales.find((s) => s.opening)!;
    expect(opening).toMatchObject({ date: '2026-11-13', customerId: one, method: 'On credit', lines: [{ productId: '', size: '', qty: 1, price: 4000 }] });
    // the 1,000 paid on 16 Nov now sits on the brought-forward line, and still counts as money in that day
    const later = r.payments.find((p) => p.amount === 1000)!;
    expect(later.refId).toBe(opening.id);
    expect(dayFigures(r, '2026-11-16').moneyIn).toBe(1000);
    // the carried amounts are not new sales or new money
    const carried = r.payments.find((p) => p.note === OPENING_NOTE)!;
    expect(carried).toMatchObject({ kind: 'advance', refId: two, amount: 7000, date: '2026-11-13' });
    expect(isMoneyIn(carried)).toBe(false);
    const rep = buildReport(r, app.settings(), { key: 'custom', label: '', from: '2026-11-01', to: '2026-11-30' }, new Map());
    expect(rep.sales).toBe(6000); // the two bottles sold from 14 Nov
    expect(rep.moneyIn).toBe(1000);
    // the brought-forward line does not count as a visit or a juice sold
    expect(regulars(r.sales, '2026-11-20')).not.toContain('');
    expect(mostSold(r.sales, '2026-11-20')).toEqual({ productId: app.productId, size: '500' });
  });

  it('forgets old debts when not carried, but always keeps money paid ahead', async () => {
    const app = await withHistory();
    const plan = await app.actions.startAgainFrom('2026-11-14', false);
    expect(plan.owedCarried).toBe(0);
    // 4,000 was still owed on 13 Nov; 1,000 of it was paid on 16 Nov, so 3,000 is forgotten
    expect(plan.owedDropped).toBe(3000);
    expect(plan.aheadCarried).toBe(7000);
    const after = app.figures();
    expect(after.owes.get(app.cust('Test One').id)).toBe(3000); // only the bottle of 16 Nov
    expect(after.ahead.get(app.cust('Test Two').id)).toBe(4000);
    // the 1,000 paid on 16 Nov for the old sale is kept (audit, 24 Nov 2026), on a fully paid line
    const r = app.records();
    expect(r.payments.some((p) => p.amount === 1000)).toBe(true);
    expect(dayFigures(r, '2026-11-16').moneyIn).toBe(1000);
  });

  it('refuses a day still to come', async () => {
    const app = await juiceApp();
    await expect(app.actions.startAgainFrom('2999-01-01', true)).rejects.toThrow(/day that has come/);
  });
});

describe('the last 8 weeks on Home', () => {
  it('adds sales, bottles and money in per week, Monday to Sunday', async () => {
    const app = await juiceApp();
    await app.actions.saveSale({ date: '2026-11-16', lines: app.bottle(2), customerName: '', method: 'Cash' }); // Monday
    await app.actions.saveSale({ date: '2026-11-15', lines: app.bottle(), customerName: 'Test One', method: 'On credit' }); // Sunday, week before
    const r = app.records();
    const pts = weeklySeries(r.sales, r.orders, r.payments, '2026-11-18', 8);
    expect(pts).toHaveLength(8);
    expect(pts[7]).toMatchObject({ start: '2026-11-16', sales: 6000, bottles: 2, moneyIn: 6000 });
    expect(pts[6]).toMatchObject({ start: '2026-11-09', sales: 3000, bottles: 1, moneyIn: 0 });
    expect(pts[0].start).toBe('2026-09-28');
  });
});

describe('event quote', () => {
  it('works out bottles, fruit against stock, cost, price and a half deposit', async () => {
    const app = await juiceApp();
    const mango = await app.actions.saveItem({ name: 'Mango', kind: 'fruit', unit: 'pcs', reorderLevel: 0 });
    await app.actions.savePurchase({ date: '2026-11-10', supplierName: 'Market', itemId: mango, qty: 20, price: 500 });
    const a = await app.actions.saveProduct({ name: 'Mango juice', kind: 'single', icon: '🥭', colour: '#F7931E', premium: false, recipe: [{ itemId: mango, qty: 30 }], water: 0, keepsDays: 3 });
    const r = app.records();
    const s = app.settings();
    const levels = itemLevels(r.items, r.purchases, r.batches, r.counts, s.sizes, s.perBottle);
    const q = eventQuote({ guests: 100, perGuest: 1.5, size: '300', productIds: [a, app.productId], price: 2500, deliveryFee: 20000 }, r.products, r.items, s.sizes, new Map([[mango, 500]]), levels);
    expect(q.bottles).toBe(150);
    expect(q.perJuice.map((x) => x.bottles)).toEqual([75, 75]);
    expect(q.litres).toBe(45);
    // 75 x 0.3 l = 22.5 l of mango juice; 30 mangoes per 10 l = 67.5
    expect(q.needs).toEqual([{ item: expect.objectContaining({ name: 'Mango' }), need: 67.5, have: 20, short: 47.5 }]);
    expect(q.noRecipe).toEqual(['Fresh juice']);
    expect(q.value).toBe(375000);
    expect(q.total).toBe(395000);
    expect(q.deposit).toBe(198000);
    expect(q.profit).toBe(q.total - q.cost);
  });
});

describe('money received from the Day list', () => {
  it('records money from someone new: they are added, and it is kept as money paid ahead', async () => {
    const app = await juiceApp();
    const id = await app.actions.saveCustomer({ name: 'Test Three', type: 'Person' });
    expect(await app.actions.receiveMoney(id, { amount: 9000, date: '2026-11-18', method: 'Airtel Money' })).toEqual({ paid: 0, kept: 9000 });
    expect(app.figures().ahead.get(id)).toBe(9000);
  });
});
