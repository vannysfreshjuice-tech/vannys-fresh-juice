// Customer and juice performance figures (the card views on Customers and Reports).
import { describe, expect, it } from 'vitest';
import { paymentsByRef } from '../src/lib/juice';
import { customerStats, juiceStats, previousPeriod, standing, statementText } from '../src/lib/performance';
import { buildReport } from '../src/lib/reports';
import { testApp } from './helpers';

async function app2() {
  const app = await testApp();
  const juice = await app.actions.saveProduct({ name: 'Fresh juice', kind: 'single', icon: '🥤', colour: '#F7931E', premium: false, recipe: [], water: 0, keepsDays: 3 });
  const mango = await app.actions.saveProduct({ name: 'Mango', kind: 'single', icon: '🥭', colour: '#FFA41B', premium: false, recipe: [], water: 0, keepsDays: 3 });
  const sell = (date: string, name: string, productId: string, qty: number, method: string) => app.actions.saveSale({ date, lines: [{ productId, size: '500', qty, price: 3000 }], customerName: name, method });
  return { ...app, juice, mango, sell };
}

describe('customer performance', () => {
  it('adds up billed, paid, owed, collection rate, bottles a week, last active and overdue days', async () => {
    const app = await app2();
    await app.sell('2026-10-15', 'Kato', app.juice, 1, 'On credit'); // older than a week, unpaid: overdue
    await app.sell('2026-11-10', 'Kato', app.juice, 2, 'On credit'); // recent, unpaid
    await app.sell('2026-11-12', 'Kato', app.juice, 1, 'Cash');
    const r = app.records();
    const kato = r.customers.find((c) => c.name === 'Kato')!.id;
    const s = customerStats(r.customers, r.sales, r.orders, r.payments, paymentsByRef(r.payments), '2026-11-16').get(kato)!;
    expect(s).toMatchObject({ billed: 12000, paid: 3000, owed: 9000, times: 3, bottles: 4, lastActive: '2026-11-12', overdue: 1, oldestUnpaid: '2026-10-15' });
    expect(s.rate).toBe(0.25);
    expect(s.perWeek).toBe(0.8); // 3 bottles in the last 4 weeks
  });
  it('writes the statement oldest day first, with money paid ahead', () => {
    const text = statementText('Kato', [{ kind: 'sale', id: 'a', number: 'S-0001', date: '2026-11-10', balance: 3000 }], 3000, 2000, { businessName: "Vanny's Fresh Juice", whatsapp: '+256 785 965536', currency: 'UGX' });
    expect(text.split('\n')).toEqual(["Vanny's Fresh Juice: statement for Kato", '10/11/2026: UGX 3,000', 'Total owed: UGX 3,000', 'Paid ahead, not used yet: UGX 2,000', 'Thank you. +256 785 965536']);
  });
});

describe('juice performance', () => {
  it('ranks juices by sales with share, customers, days sold and the change on the period before', async () => {
    const app = await app2();
    await app.sell('2026-10-05', 'Kato', app.juice, 2, 'Cash'); // October: Fresh juice 6,000
    await app.sell('2026-11-03', 'Kato', app.juice, 2, 'Cash');
    await app.sell('2026-11-04', 'Apio', app.juice, 1, 'Cash'); // November: Fresh juice 9,000 from 2 customers on 2 days
    await app.sell('2026-11-04', 'Apio', app.mango, 1, 'Cash'); // and Mango 3,000, new this month
    const r = app.records();
    const nov = { key: 'custom', label: '', from: '2026-11-01', to: '2026-11-30' };
    const before = previousPeriod(nov)!;
    expect(before).toMatchObject({ from: '2026-10-02', to: '2026-10-31' });
    const rep = buildReport(r, app.settings(), nov, new Map());
    const prev = buildReport(r, app.settings(), before, new Map());
    const js = juiceStats(rep, prev, r.sales, r.orders, r.batches, r.writeOffs);
    expect(js.map((j) => j.product.name)).toEqual(['Fresh juice', 'Mango']);
    expect(js[0]).toMatchObject({ bottles: 3, sales: 9000, customers: 2, daysSold: 2, lastSold: '2026-11-04', change: 0.5 });
    expect(js[0].share).toBe(0.75);
    expect(js[1].change).toBeNull(); // nothing to compare with
    expect(previousPeriod({ key: 'all', label: '', from: '', to: '' })).toBeNull();
  });
});

describe('profit by what was bought', () => {
  it('counts fruit and packaging bought in the period, used or not, in place of the cost of what was sold', async () => {
    const app = await app2();
    await app.actions.addStarterSet();
    const id = (n: string) => app.records().items.find((i) => i.name === n)!.id;
    await app.actions.savePurchase({ date: '2026-11-02', supplierName: 'Market', itemId: id('Mangoes'), qty: 10, price: 2000 });
    await app.actions.savePurchase({ date: '2026-11-02', supplierName: 'Market', itemId: id('Bottles 500 ml'), qty: 50, price: 300 });
    await app.actions.savePurchase({ date: '2026-10-30', supplierName: 'Market', itemId: id('Sugar'), qty: 5, price: 4800 }); // October: not in November
    await app.actions.saveExpense({ date: '2026-11-03', category: 'Transport', description: 'Boda', amount: 5000, method: 'Cash' });
    await app.sell('2026-11-04', 'Kato', app.juice, 20, 'Cash'); // 60,000
    const nov = { key: 'custom', label: '', from: '2026-11-01', to: '2026-11-30' };
    const rep = buildReport(app.records(), app.settings(), nov, new Map());
    expect(rep.bought).toMatchObject({ total: 35000, fruit: 20000, packaging: 15000, profit: 60000 - 35000 - 5000 });
    expect(rep.bought.items.map((x) => x.name)).toEqual(['Mangoes', 'Bottles 500 ml']);
    expect(rep.profit).toBe(60000 - 20 * 300 - 5000); // by recipe: Fresh juice has none, so only the bottle cost: 300, the price paid for the linked 500 ml bottles
  });
});

describe('the period before', () => {
  it('compares as many days as the period has had so far', () => {
    const nov = { key: 'thisMonth', label: '', from: '2026-11-01', to: '2026-11-30' };
    expect(previousPeriod(nov, '2026-11-16')).toMatchObject({ from: '2026-10-16', to: '2026-10-31' });
    expect(previousPeriod(nov, '2026-12-05')).toMatchObject({ from: '2026-10-02', to: '2026-10-31' });
  });
});

describe('the statement card figure', () => {
  it('shows one figure: owed less paid ahead', () => {
    expect(standing(30000, 0, 3000)).toEqual({ kind: 'owes', amount: 30000, bottles: 0 });
    expect(standing(3000, 2000, 3000)).toEqual({ kind: 'owes', amount: 1000, bottles: 0 });
    expect(standing(0, 9000, 3000)).toEqual({ kind: 'ahead', amount: 9000, bottles: 3 });
    expect(standing(1000, 11000, 3000)).toEqual({ kind: 'ahead', amount: 10000, bottles: 3 });
    expect(standing(0, 0, 3000)).toEqual({ kind: 'clear', amount: 0, bottles: 0 });
  });
});
