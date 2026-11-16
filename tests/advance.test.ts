// Money paid ahead, one payment for several days, selling without recorded production, and the
// day list / week sheet figures (the owner's Excel sheet logic).
import { describe, expect, it } from 'vitest';
import { daySummary, entryStatus, excelName, regulars, weekStart } from '../src/lib/day';
import { customerAdvances, customerBalances, debtsOf, paymentsByRef } from '../src/lib/juice';
import { buildReport, dayFigures } from '../src/lib/reports';
import { FROM_ADVANCE } from '../src/lib/types';
import { testApp } from './helpers';

async function juiceApp() {
  const app = await testApp();
  const productId = await app.actions.saveProduct({ name: 'Fresh juice', kind: 'single', icon: '🥤', colour: '#F7931E', premium: false, recipe: [], water: 0, keepsDays: 3 });
  const bottle = (qty = 1, price = 3000) => [{ productId, size: '500', qty, price }];
  const cust = (name: string) => app.records().customers.find((c) => c.name === name)!;
  const figures = () => {
    const r = app.records();
    const byRef = paymentsByRef(r.payments);
    return { byRef, owes: customerBalances(r.customers, r.orders, r.sales, byRef), ahead: customerAdvances(r.customers, r.orders, r.sales, r.payments) };
  };
  return { ...app, productId, bottle, cust, figures };
}

describe('selling without recorded production', () => {
  it('sells with no batch in the fridge by default, on the day chosen', async () => {
    const app = await juiceApp();
    const id = await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Joram', method: 'On credit' });
    const s = app.records().sales.find((x) => x.id === id)!;
    expect(s.date).toBe('2026-11-09');
    expect(s.time).toBe('');
    expect(s.lines).toEqual([{ productId: app.productId, size: '500', qty: 1, price: 3000 }]);
    expect(app.figures().owes.get(app.cust('Joram').id)).toBe(3000);
  });
  it('refuses when Settings asks for recorded bottles only', async () => {
    const app = await juiceApp();
    await app.actions.saveSettings({ fridgeCheck: true });
    await expect(app.actions.saveSale({ lines: app.bottle(), customerName: '', method: 'Cash' })).rejects.toThrow(/Only 0/);
  });
  it('refuses a day still to come', async () => {
    const app = await juiceApp();
    await expect(app.actions.saveSale({ date: '2999-01-01', lines: app.bottle(), customerName: 'Joram', method: 'Cash' })).rejects.toThrow(/not come yet/);
  });
});

describe('money paid ahead', () => {
  it('is kept when a customer who owes nothing pays, and bottles then come out of it', async () => {
    const app = await juiceApp();
    await app.actions.saveCustomer({ name: 'Alvin', type: 'Person' });
    const alvin = app.cust('Alvin').id;
    expect(await app.actions.receiveMoney(alvin, { amount: 42000, date: '2026-09-01', method: 'Cash' })).toEqual({ paid: 0, kept: 42000 });
    for (const d of ['2026-09-08', '2026-09-10', '2026-09-11']) await app.actions.saveSale({ date: d, lines: app.bottle(), customerName: 'Alvin', method: FROM_ADVANCE });
    expect(app.figures().ahead.get(alvin)).toBe(33000);
    expect(app.figures().owes.get(alvin)).toBe(0);
    // money in counts the 42,000 once, on the day it came; the bottles from it are not new money
    const r = app.records();
    const rep = buildReport(r, app.settings(), { key: 'custom', label: '', from: '2026-09-01', to: '2026-09-30' }, new Map());
    expect(rep.moneyIn).toBe(42000);
    expect(rep.sales).toBe(9000);
    expect(dayFigures(r, '2026-09-08').moneyIn).toBe(0);
    expect(entryStatus(r.sales[0], paymentsByRef(r.payments).get(r.sales[0].id))).toBe('ahead');
  });
  it('covers what it can; the rest of the bottle stays owed', async () => {
    const app = await juiceApp();
    await app.actions.saveCustomer({ name: 'Derek', type: 'Person' });
    const derek = app.cust('Derek').id;
    await app.actions.receiveMoney(derek, { amount: 2000, date: '2026-11-13', method: 'Cash' });
    const id = await app.actions.saveSale({ date: '2026-11-13', lines: app.bottle(), customerName: 'Derek', method: FROM_ADVANCE });
    expect(app.figures().ahead.get(derek)).toBe(0);
    expect(app.figures().owes.get(derek)).toBe(1000);
    expect(entryStatus(app.records().sales.find((s) => s.id === id)!, app.figures().byRef.get(id))).toBe('part');
    await expect(app.actions.saveSale({ lines: app.bottle(), customerName: 'Derek', method: FROM_ADVANCE })).rejects.toThrow(/no money paid ahead left/);
  });
  it('comes back when a sale paid from it is undone, and cannot be removed once used', async () => {
    const app = await juiceApp();
    await app.actions.saveCustomer({ name: 'MDM', type: 'Person' });
    const mdm = app.cust('MDM').id;
    await app.actions.receiveMoney(mdm, { amount: 20000, date: '2026-11-10', method: 'Cash' });
    const id = await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(2), customerName: 'MDM', method: FROM_ADVANCE });
    expect(app.figures().ahead.get(mdm)).toBe(14000);
    const deposit = app.records().payments.find((p) => p.kind === 'advance')!;
    await expect(app.actions.deletePayment(deposit.id)).rejects.toThrow(/already used/);
    await app.actions.deleteSale(id);
    expect(app.figures().ahead.get(mdm)).toBe(20000);
    await app.actions.deletePayment(deposit.id);
    expect(app.figures().ahead.get(mdm)).toBe(0);
  });
});

describe('one payment for several days', () => {
  it('pays the oldest days first and keeps the extra as paid ahead', async () => {
    const app = await juiceApp();
    for (const d of ['2026-10-27', '2026-10-26', '2026-10-28']) await app.actions.saveSale({ date: d, lines: app.bottle(), customerName: 'Douglas', method: 'On credit' });
    const douglas = app.cust('Douglas').id;
    expect(await app.actions.receiveMoney(douglas, { amount: 7000, date: '2026-11-16', method: 'MTN MoMo' })).toEqual({ paid: 7000, kept: 0 });
    const r = app.records();
    const debts = debtsOf(douglas, r.orders, r.sales, paymentsByRef(r.payments));
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ date: '2026-10-28', balance: 2000 });
    expect(await app.actions.receiveMoney(douglas, { amount: 5000, date: '2026-11-16', method: 'Cash' })).toEqual({ paid: 2000, kept: 3000 });
    expect(app.figures().owes.get(douglas)).toBe(0);
    expect(app.figures().ahead.get(douglas)).toBe(3000);
  });
  it('can use money paid ahead for what is owed', async () => {
    const app = await juiceApp();
    await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(), customerName: 'Derek', method: 'On credit' });
    const derek = app.cust('Derek').id;
    await app.actions.receiveMoney(derek, { amount: 2000, date: '2026-11-13', method: 'Cash' });
    expect(app.figures().owes.get(derek)).toBe(1000); // the 2,000 went to the bottle owed first
    expect(app.figures().ahead.get(derek)).toBe(0);
    await app.actions.receiveMoney(derek, { amount: 5000, date: '2026-11-14', method: 'Cash' });
    expect(app.figures().ahead.get(derek)).toBe(4000);
    await app.actions.saveSale({ date: '2026-11-14', lines: app.bottle(), customerName: 'Derek', method: 'On credit' });
    await expect(app.actions.receiveMoney(derek, { amount: 9000, date: '2026-11-16', method: FROM_ADVANCE })).rejects.toThrow(/only/);
    expect(await app.actions.receiveMoney(derek, { amount: 4000, date: '2026-11-16', method: FROM_ADVANCE })).toEqual({ paid: 3000, kept: 0 });
    expect(app.figures().owes.get(derek)).toBe(0);
    expect(app.figures().ahead.get(derek)).toBe(1000);
  });
});

describe('day list and week sheet', () => {
  it('finds the Monday of a week', () => {
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
    expect(weekStart('2026-11-13')).toBe('2026-11-09');
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday belongs to the week before
  });
  it('writes names the Excel way', async () => {
    const app = await juiceApp();
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Solo', method: 'Cash' });
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(2), customerName: 'Bridgette', method: 'On credit' });
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(1, 5000), customerName: 'Esther', method: 'Cash' });
    const names = app.records().sales.map((s) => excelName(s, 3000)).sort();
    expect(names).toEqual(['Bridgette-2', 'Esther-5k', 'Solo']);
  });
  it('colours a day with juice, a weekday without, and the weekend', async () => {
    const app = await juiceApp();
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Solo', method: 'Cash' });
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'CP', method: 'On credit' });
    const r = app.records();
    const byRef = paymentsByRef(r.payments);
    const mon = daySummary('2026-11-09', '2026-11-16', '2026-11-09', r.sales, r.orders, byRef);
    expect(mon).toMatchObject({ state: 'supplied', bottles: 2, value: 6000, paid: 3000, owed: 3000 });
    expect(daySummary('2026-11-11', '2026-11-16', '2026-11-09', r.sales, r.orders, byRef).state).toBe('none');
    expect(daySummary('2026-11-14', '2026-11-16', '2026-11-09', r.sales, r.orders, byRef).state).toBe('weekend');
    expect(daySummary('2026-11-06', '2026-11-16', '2026-11-09', r.sales, r.orders, byRef).state).toBe('before');
    expect(daySummary('2026-11-20', '2026-11-16', '2026-11-09', r.sales, r.orders, byRef).state).toBe('later');
    expect(daySummary('2026-11-16', '2026-11-16', '2026-11-09', r.sales, r.orders, byRef).state).toBe('today'); // not red while the day is on
  });
  it('puts the most frequent customers first', async () => {
    const app = await juiceApp();
    for (const n of ['CP', 'Joram', 'CP', 'Solo', 'CP', 'Joram']) await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: n, method: 'Cash' });
    const names = (day: string) => regulars(app.records().sales, day).map((id) => app.records().customers.find((c) => c.id === id)!.name);
    expect(names('2026-11-10')).toEqual(['CP', 'Joram', 'Solo']);
    // tapping names on the day does not move the buttons; someone new goes at the end
    for (const n of ['Solo', 'Solo', 'Solo', 'Amos']) await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(), customerName: n, method: 'Cash' });
    expect(names('2026-11-10')).toEqual(['CP', 'Joram', 'Solo', 'Amos']);
  });
});
