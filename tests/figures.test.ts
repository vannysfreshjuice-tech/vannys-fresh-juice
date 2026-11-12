// The figures: costs, reports, wages and reminders, worked out by hand and compared.
import { describe, expect, it } from 'vitest';
import { batchCost, bottleCost, latestCosts, averageCosts, nextNumber, priceOf, recipeCostPerLitre } from '../src/lib/juice';
import { reminderIcs, waNumber } from '../src/lib/reminders';
import { buildReport } from '../src/lib/reports';
import { wageLines, weekStart } from '../src/lib/staff';
import { DEFAULT_SIZES, type Product } from '../src/lib/types';
import { testApp } from './helpers';

const base = { createdAt: 0, updatedAt: 0 };

describe('costs and prices', () => {
  const mango: Product = { id: 'm', name: 'Mango', kind: 'single', icon: '', colour: '', premium: false, recipe: [{ itemId: 'mangoes', qty: 12 }, { itemId: 'sugar', qty: 1 }], water: 4, keepsDays: 3, ...base };
  const costs = new Map([
    ['mangoes', 2000],
    ['sugar', 4800],
  ]);
  it('works out the juice cost per litre from a 10-litre recipe', () => {
    expect(recipeCostPerLitre(mango, costs)).toBe(2880); // (12 x 2,000 + 4,800) / 10
  });
  it('adds the bottle, cap and label to the juice in the bottle', () => {
    expect(bottleCost(2880, DEFAULT_SIZES[1])).toBe(1840); // 0.5 x 2,880 + 400
  });
  it('uses the premium price for premium juices', () => {
    expect(priceOf(mango, DEFAULT_SIZES[1])).toBe(3000);
    expect(priceOf({ ...mango, premium: true }, DEFAULT_SIZES[1])).toBe(4000);
  });
  it('averages what was paid over all purchases, and knows the last price', () => {
    const p = [
      { id: '1', date: '2026-11-01', supplierName: '', itemId: 'mangoes', qty: 10, price: 1800, ...base },
      { id: '2', date: '2026-11-05', supplierName: '', itemId: 'mangoes', qty: 30, price: 2200, ...base },
    ];
    expect(averageCosts(p).get('mangoes')).toBe(2100); // (18,000 + 66,000) / 40
    expect(latestCosts(p).get('mangoes')).toBe(2200);
  });
  it('costs a batch from what really went in', () => {
    const b = { id: 'b', number: 'B-0001', date: '2026-11-12', productId: 'm', litres: 10, used: [{ itemId: 'mangoes', qty: 12 }, { itemId: 'sugar', qty: 1 }], filled: { '500': 20 }, madeBy: '', bestBefore: '', checks: [], ...base };
    expect(batchCost(b, mango, DEFAULT_SIZES, costs)).toEqual({ juice: 28800, packaging: 8000, total: 36800, perLitre: 2880, salesValue: 60000 });
  });
  it('numbers from the highest used', () => {
    expect(nextNumber('VJ', ['VJ-0007', 'VJ-0002', 'S-0100'])).toBe('VJ-0008');
    expect(nextNumber('B', [])).toBe('B-0001');
  });
});

describe('the report', () => {
  it('profit = bottles sold - their juice and bottles - expenses - wages - spoiled', async () => {
    const app = await testApp();
    await app.actions.addStarterSet();
    const r0 = app.records();
    const id = (n: string) => r0.items.find((i) => i.name === n)!.id;
    const mango = r0.products.find((p) => p.name === 'Mango')!;
    await app.actions.savePurchase({ date: '2026-11-01', supplierName: 'Mama Rose', itemId: id('Mangoes'), qty: 12, price: 2000 });
    await app.actions.savePurchase({ date: '2026-11-01', supplierName: 'Kikuubo', itemId: id('Sugar'), qty: 1, price: 4800 });
    await app.actions.saveBatch({ date: '2026-11-02', productId: mango.id, litres: 10, used: [{ itemId: id('Mangoes'), qty: 12 }, { itemId: id('Sugar'), qty: 1 }], filled: { '500': 20 }, madeBy: '', checks: [] });
    const batch = app.records().batches[0];
    // 4 sold at the counter, 10 delivered on an order, 2 written off
    await app.actions.saveSale({ lines: [{ productId: mango.id, size: '500', qty: 4, price: 3000 }], customerName: '', method: 'Cash' });
    const oid = await app.actions.saveOrder({ customerName: 'Kato', customerType: 'Shop', date: '2026-11-02', dueDate: '2026-11-03', lines: [{ productId: mango.id, size: '500', qty: 10, price: 2800 }], deliveryFee: 5000 });
    await app.actions.setOrderStage(oid, 'Delivered');
    await app.actions.writeOff({ batchId: batch.id, size: '500', qty: 2, reason: 'Went sour' });
    await app.actions.saveExpense({ date: '2026-11-03', category: 'Rent', description: 'Rent', amount: 20000, method: 'Cash' });
    const sid = await app.actions.saveStaff({ name: 'Aisha', role: 'production', job: '', payKind: 'day', rate: 15000, phone: '' });
    await app.actions.saveWage({ date: '2026-11-03', staffId: sid, kind: 'wage', amount: 15000, method: 'Cash' });

    const r = app.records();
    const all = { key: 'all', label: 'All', from: '', to: '' };
    const rep = buildReport(r, app.settings(), all, averageCosts(r.purchases));
    const perBottle = 0.5 * 2880 + 400; // 1,840
    expect(rep.bottles).toBe(14);
    expect(rep.sales).toBe(4 * 3000 + 10 * 2800); // 40,000
    expect(rep.deliveryFees).toBe(5000);
    expect(rep.juiceCost).toBeCloseTo(14 * perBottle, 6);
    expect(rep.spoiled).toBeCloseTo(2 * perBottle, 6);
    expect(rep.expenses).toBe(20000);
    expect(rep.wages).toBe(15000);
    expect(rep.profit).toBeCloseTo(40000 + 5000 - 14 * perBottle - 20000 - 15000 - 2 * perBottle, 6);
    expect(rep.moneyIn).toBe(12000); // the counter sale only; the order is unpaid
    expect(rep.byChannel.map((c) => c.channel).sort()).toEqual(['Counter', 'Orders: Shop']);
    expect(rep.kinds.find((k) => k.kind === 'single')!.bottles).toBe(14);
  });
});

describe('wages', () => {
  it('day workers: days present x rate - advances - paid this week', () => {
    const s = [{ id: 'a', name: 'Aisha', role: 'production' as const, job: '', payKind: 'day' as const, rate: 15000, ...base }];
    const att = ['2026-11-09', '2026-11-10', '2026-11-12'].map((d) => ({ id: `${d}_a`, date: d, staffId: 'a', present: true, ...base }));
    att.push({ id: '2026-11-11_a', date: '2026-11-11', staffId: 'a', present: false, ...base });
    const wages = [
      { id: 'w1', date: '2026-11-10', staffId: 'a', kind: 'advance' as const, amount: 20000, method: 'Cash', ...base },
      { id: 'w2', date: '2026-11-02', staffId: 'a', kind: 'wage' as const, amount: 90000, method: 'Cash', ...base }, // last week: not counted
    ];
    const [l] = wageLines(s, att, wages, '2026-11-12');
    expect(weekStart('2026-11-12')).toBe('2026-11-09');
    expect(weekStart('2026-11-15')).toBe('2026-11-09'); // Sunday belongs to the week before
    expect(l.week).toEqual([true, true, false, true, undefined, undefined, undefined]);
    expect(l.earned).toBe(45000);
    expect(l.due).toBe(25000);
  });
});

describe('reminders', () => {
  it('makes a calendar file with an alarm, a repeat and escaped text', () => {
    const ics = reminderIcs({ id: 'r1', date: '2026-11-13', time: '06:00', what: 'Make mango, passion; 40 bottles', repeat: 'daily', ways: ['calendar'], ...base }, 'Brian', "Vanny's", new Date(Date.UTC(2026, 10, 12, 9, 5)));
    expect(ics).toContain('DTSTART:20261113T060000');
    expect(ics).toContain('DTSTAMP:20261112T090500Z');
    expect(ics).toContain('RRULE:FREQ=DAILY');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics).toContain("SUMMARY:Vanny's: Make mango\\, passion\\; 40 bottles");
    expect(ics.split('\r\n')[0]).toBe('BEGIN:VCALENDAR');
  });
  it('turns Ugandan phone numbers into WhatsApp numbers', () => {
    expect(waNumber('0772 123 456')).toBe('256772123456');
    expect(waNumber('+256 785 965536')).toBe('256785965536');
    expect(waNumber('')).toBe('');
  });
});
