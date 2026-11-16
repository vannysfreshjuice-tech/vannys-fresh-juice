// Money paid ahead, one payment for several days, selling without recorded production, and the
// day list / week sheet figures (the owner's Excel sheet logic).
import { describe, expect, it } from 'vitest';
import { dayStock, daySummary, entryStatus, excelName, mostSold, regulars, weekStart } from '../src/lib/day';
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
    const id = await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Kato', method: 'On credit' });
    const s = app.records().sales.find((x) => x.id === id)!;
    expect(s.date).toBe('2026-11-09');
    expect(s.time).toBe('');
    expect(s.lines).toEqual([{ productId: app.productId, size: '500', qty: 1, price: 3000 }]);
    expect(app.figures().owes.get(app.cust('Kato').id)).toBe(3000);
  });
  it('refuses when Settings asks for recorded bottles only', async () => {
    const app = await juiceApp();
    await app.actions.saveSettings({ fridgeCheck: true });
    await expect(app.actions.saveSale({ lines: app.bottle(), customerName: '', method: 'Cash' })).rejects.toThrow(/Only 0/);
  });
  it('refuses a day still to come', async () => {
    const app = await juiceApp();
    await expect(app.actions.saveSale({ date: '2999-01-01', lines: app.bottle(), customerName: 'Kato', method: 'Cash' })).rejects.toThrow(/not come yet/);
  });
});

describe('money paid ahead', () => {
  it('is kept when a customer who owes nothing pays, and bottles then come out of it', async () => {
    const app = await juiceApp();
    await app.actions.saveCustomer({ name: 'Akello', type: 'Person' });
    const akello = app.cust('Akello').id;
    expect(await app.actions.receiveMoney(akello, { amount: 30000, date: '2026-09-01', method: 'Cash' })).toEqual({ paid: 0, kept: 30000 });
    for (const d of ['2026-09-08', '2026-09-10', '2026-09-11']) await app.actions.saveSale({ date: d, lines: app.bottle(), customerName: 'Akello', method: FROM_ADVANCE });
    expect(app.figures().ahead.get(akello)).toBe(21000);
    expect(app.figures().owes.get(akello)).toBe(0);
    // money in counts the 30,000 once, on the day it came; the bottles from it are not new money
    const r = app.records();
    const rep = buildReport(r, app.settings(), { key: 'custom', label: '', from: '2026-09-01', to: '2026-09-30' }, new Map());
    expect(rep.moneyIn).toBe(30000);
    expect(rep.sales).toBe(9000);
    expect(dayFigures(r, '2026-09-08').moneyIn).toBe(0);
    expect(entryStatus(r.sales[0], paymentsByRef(r.payments).get(r.sales[0].id))).toBe('ahead');
  });
  it('covers what it can; the rest of the bottle stays owed', async () => {
    const app = await juiceApp();
    await app.actions.saveCustomer({ name: 'Okello', type: 'Person' });
    const okello = app.cust('Okello').id;
    await app.actions.receiveMoney(okello, { amount: 2000, date: '2026-11-13', method: 'Cash' });
    const id = await app.actions.saveSale({ date: '2026-11-13', lines: app.bottle(), customerName: 'Okello', method: FROM_ADVANCE });
    expect(app.figures().ahead.get(okello)).toBe(0);
    expect(app.figures().owes.get(okello)).toBe(1000);
    expect(entryStatus(app.records().sales.find((s) => s.id === id)!, app.figures().byRef.get(id))).toBe('part');
    await expect(app.actions.saveSale({ lines: app.bottle(), customerName: 'Okello', method: FROM_ADVANCE })).rejects.toThrow(/no money paid ahead left/);
  });
  it('comes back when a sale paid from it is undone, and cannot be removed once used', async () => {
    const app = await juiceApp();
    await app.actions.saveCustomer({ name: 'Nakato', type: 'Person' });
    const nakato = app.cust('Nakato').id;
    await app.actions.receiveMoney(nakato, { amount: 15000, date: '2026-11-10', method: 'Cash' });
    const id = await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(2), customerName: 'Nakato', method: FROM_ADVANCE });
    expect(app.figures().ahead.get(nakato)).toBe(9000);
    const deposit = app.records().payments.find((p) => p.kind === 'advance')!;
    await expect(app.actions.deletePayment(deposit.id)).rejects.toThrow(/already used/);
    await app.actions.deleteSale(id);
    expect(app.figures().ahead.get(nakato)).toBe(15000);
    await app.actions.deletePayment(deposit.id);
    expect(app.figures().ahead.get(nakato)).toBe(0);
  });
});

describe('one payment for several days', () => {
  it('pays the oldest days first and keeps the extra as paid ahead', async () => {
    const app = await juiceApp();
    for (const d of ['2026-10-27', '2026-10-26', '2026-10-28']) await app.actions.saveSale({ date: d, lines: app.bottle(), customerName: 'Mukasa', method: 'On credit' });
    const mukasa = app.cust('Mukasa').id;
    expect(await app.actions.receiveMoney(mukasa, { amount: 7000, date: '2026-11-16', method: 'MTN MoMo' })).toEqual({ paid: 7000, kept: 0 });
    const r = app.records();
    const debts = debtsOf(mukasa, r.orders, r.sales, paymentsByRef(r.payments));
    expect(debts).toHaveLength(1);
    expect(debts[0]).toMatchObject({ date: '2026-10-28', balance: 2000 });
    expect(await app.actions.receiveMoney(mukasa, { amount: 5000, date: '2026-11-16', method: 'Cash' })).toEqual({ paid: 2000, kept: 3000 });
    expect(app.figures().owes.get(mukasa)).toBe(0);
    expect(app.figures().ahead.get(mukasa)).toBe(3000);
  });
  it('can use money paid ahead for what is owed', async () => {
    const app = await juiceApp();
    await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(), customerName: 'Okello', method: 'On credit' });
    const okello = app.cust('Okello').id;
    await app.actions.receiveMoney(okello, { amount: 2000, date: '2026-11-13', method: 'Cash' });
    expect(app.figures().owes.get(okello)).toBe(1000); // the 2,000 went to the bottle owed first
    expect(app.figures().ahead.get(okello)).toBe(0);
    await app.actions.receiveMoney(okello, { amount: 5000, date: '2026-11-14', method: 'Cash' });
    expect(app.figures().ahead.get(okello)).toBe(4000);
    await app.actions.saveSale({ date: '2026-11-14', lines: app.bottle(), customerName: 'Okello', method: 'On credit' });
    await expect(app.actions.receiveMoney(okello, { amount: 9000, date: '2026-11-16', method: FROM_ADVANCE })).rejects.toThrow(/only/);
    expect(await app.actions.receiveMoney(okello, { amount: 4000, date: '2026-11-16', method: FROM_ADVANCE })).toEqual({ paid: 3000, kept: 0 });
    expect(app.figures().owes.get(okello)).toBe(0);
    expect(app.figures().ahead.get(okello)).toBe(1000);
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
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Apio', method: 'Cash' });
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(2), customerName: 'Babirye', method: 'On credit' });
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(1, 5000), customerName: 'Wasswa', method: 'Cash' });
    const names = app.records().sales.map((s) => excelName(s, 3000)).sort();
    expect(names).toEqual(['Apio', 'Babirye-2', 'Wasswa-5k']);
  });
  it('colours a day with juice, a weekday without, and the weekend', async () => {
    const app = await juiceApp();
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Apio', method: 'Cash' });
    await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Opio', method: 'On credit' });
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
    for (const n of ['Opio', 'Kato', 'Opio', 'Apio', 'Opio', 'Kato']) await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: n, method: 'Cash' });
    const names = (day: string) => regulars(app.records().sales, day).map((id) => app.records().customers.find((c) => c.id === id)!.name);
    expect(names('2026-11-10')).toEqual(['Opio', 'Kato', 'Apio']);
    // tapping names on the day does not move the buttons; someone new goes at the end
    for (const n of ['Apio', 'Apio', 'Apio', 'Namata']) await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(), customerName: n, method: 'Cash' });
    expect(names('2026-11-10')).toEqual(['Opio', 'Kato', 'Apio', 'Namata']);
  });
});

describe('bottles made on the day list', () => {
  it('counts made, sold and left, rolling the rest over to the next day', async () => {
    const app = await juiceApp();
    await app.actions.quickBatch({ date: '2026-11-09', productId: app.productId, size: '500', bottles: 20 });
    const b = app.records().batches[0];
    expect(b).toMatchObject({ date: '2026-11-09', litres: 10, filled: { '500': 20 }, number: 'B-0001' });
    for (let i = 0; i < 14; i++) await app.actions.saveSale({ date: '2026-11-09', lines: app.bottle(), customerName: 'Kato', method: 'Cash' });
    const st = (day: string) => {
      const r = app.records();
      return dayStock(day, r.batches, r.sales, r.orders, r.writeOffs);
    };
    expect(st('2026-11-09')).toEqual({ made: 20, left: 6, spoiled: 0 });
    // next day: 10 more made; the 6 left are sold first, then 4 of the new ones; 2 go bad
    await app.actions.quickBatch({ date: '2026-11-10', productId: app.productId, size: '500', bottles: 10 });
    await app.actions.saveSale({ date: '2026-11-10', lines: app.bottle(10), customerName: 'Kato', method: 'Cash' });
    const sold = app.records().sales.find((s) => s.date === '2026-11-10')!;
    expect(sold.lines.map((l) => l.qty)).toEqual([6, 4]);
    await app.actions.writeOff({ batchId: app.records().batches.find((x) => x.date === '2026-11-10')!.id, size: '500', qty: 2, reason: 'Went sour', date: '2026-11-10' });
    expect(st('2026-11-10')).toEqual({ made: 10, left: 4, spoiled: 2 });
    expect(st('2026-11-09')).toEqual({ made: 20, left: 6, spoiled: 0 }); // that evening stays as it was
  });
  it('takes the fruit of the recipe for those litres, and refuses nothing made', async () => {
    const app = await juiceApp();
    await app.actions.addStarterSet();
    const mango = app.records().products.find((p) => p.name === 'Mango')!;
    await app.actions.quickBatch({ date: '2026-11-09', productId: mango.id, size: '1000', bottles: 5 });
    const b = app.records().batches[0];
    expect(b.litres).toBe(5);
    expect(b.used.map((u) => u.qty)).toEqual([15, 0.5]); // half of the 10-litre recipe: 30 mangoes, 1 kg sugar
    await expect(app.actions.quickBatch({ date: '2026-11-09', productId: mango.id, size: '1000', bottles: 0 })).rejects.toThrow(/how many bottles/);
  });
});

describe('a recipe typed by name', () => {
  it('adds new fruit and ingredients to Stock in the same save and reuses those already there', async () => {
    const app = await testApp();
    await app.actions.saveItem({ name: 'Mangoes', kind: 'fruit', unit: 'pcs', reorderLevel: 50 });
    const id = await app.actions.saveProductByNames({ name: 'Mango Ginger', kind: 'cocktail', icon: '🥭', colour: '#FFA41B', premium: false, water: 2, keepsDays: 3 }, [
      { name: 'mangoes', unit: 'kg', qty: 25 },
      { name: 'Ginger', unit: 'pcs', qty: 4 },
      { name: 'Sugar', unit: 'kg', qty: 1 },
      { name: '', unit: 'pcs', qty: 0 },
    ]);
    const r = app.records();
    expect(r.items.map((i) => `${i.name} ${i.unit}`).sort()).toEqual(['Ginger pcs', 'Mangoes pcs', 'Sugar kg']);
    const p = r.products.find((x) => x.id === id)!;
    expect(p.recipe.map((l) => [r.items.find((i) => i.id === l.itemId)!.name, l.qty])).toEqual([
      ['Mangoes', 25],
      ['Ginger', 4],
      ['Sugar', 1],
    ]);
    await expect(app.actions.saveProductByNames({ name: 'Plain', kind: 'single', icon: '🥤', colour: '#F7931E', premium: false, water: 0, keepsDays: 3 }, [{ name: 'Lemons', unit: 'pcs', qty: 0 }])).rejects.toThrow(/how much Lemons/);
  });
});

describe('a recipe worked out from a batch', () => {
  it('turns what was used and the bottles filled into a recipe for 10 litres, and can record the batch', async () => {
    const app = await testApp();
    await app.actions.saveItem({ name: 'Mangoes', kind: 'fruit', unit: 'pcs', reorderLevel: 0 });
    const r0 = await app.actions.saveProductFromBatch(
      { name: 'Mango', kind: 'single', icon: '🥭', colour: '#FFA41B', premium: false, keepsDays: 3 },
      [
        { name: 'Mangoes', unit: 'pcs', qty: 15 },
        { name: 'Sugar', unit: 'kg', qty: 0.5 },
      ],
      1,
      { '500': 6, '300': 2, '1000': 1 }, // 3 + 0.6 + 1 = 4.6 litres
      true,
      'Aisha',
    );
    expect(r0.litres).toBe(4.6);
    const r = app.records();
    const p = r.products.find((x) => x.id === r0.id)!;
    const name = (itemId: string) => r.items.find((i) => i.id === itemId)!.name;
    expect(p.recipe.map((l) => [name(l.itemId), l.qty])).toEqual([
      ['Mangoes', 32.609],
      ['Sugar', 1.087],
    ]);
    expect(p.water).toBe(2.174);
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]).toMatchObject({ productId: p.id, litres: 4.6, filled: { '500': 6, '300': 2, '1000': 1 }, madeBy: 'Aisha' });
    expect(r.batches[0].used.map((u) => [name(u.itemId), u.qty])).toEqual([
      ['Mangoes', 15],
      ['Sugar', 0.5],
    ]);
    await expect(app.actions.saveProductFromBatch({ name: 'Other', kind: 'single', icon: '🥤', colour: '#F7931E', premium: false, keepsDays: 3 }, [{ name: 'Mangoes', unit: 'pcs', qty: 5 }], 0, {}, false)).rejects.toThrow(/how many bottles/);
  });
});

describe('deleting a juice', () => {
  it('deletes one nothing refers to, and keeps one that was sold', async () => {
    const app = await testApp();
    const a = await app.actions.saveProductByNames({ name: 'Trial mix', kind: 'cocktail', icon: '🍹', colour: '#3BA935', premium: false, water: 0, keepsDays: 2 }, [{ name: 'Lemons', unit: 'pcs', qty: 3 }]);
    await app.actions.deleteProduct(a);
    expect(app.records().products).toHaveLength(0);
    expect(app.records().items.map((i) => i.name)).toEqual(['Lemons']); // the ingredient stays in Stock
    const b = await app.actions.saveProductByNames({ name: 'Sold one', kind: 'single', icon: '🥤', colour: '#F7931E', premium: false, water: 0, keepsDays: 3 }, []);
    await app.actions.saveSale({ lines: [{ productId: b, size: '500', qty: 1, price: 3000 }], customerName: '', method: 'Cash' });
    await expect(app.actions.deleteProduct(b)).rejects.toThrow(/Hide instead/);
  });
});

describe('reconciling bottles already made', () => {
  it('shares what went in over the chosen batches by litres and updates the recipe', async () => {
    const app = await testApp();
    const pid = await app.actions.saveProductByNames({ name: 'Mango', kind: 'single', icon: '🥭', colour: '#FFA41B', premium: false, water: 0, keepsDays: 3 }, []);
    await app.actions.quickBatch({ date: '2026-11-09', productId: pid, size: '500', bottles: 20 }); // 10 L
    await app.actions.quickBatch({ date: '2026-11-11', productId: pid, size: '1000', bottles: 10 }); // 10 L
    await app.actions.quickBatch({ date: '2026-11-12', productId: pid, size: '300', bottles: 10 }); // 3 L, not chosen
    const [b1, b2, b3] = app.records().batches.sort((a, b) => a.date.localeCompare(b.date));
    const r = await app.actions.reconcileBatches(pid, [b1.id, b2.id], [
      { name: 'Mangoes', unit: 'pcs', qty: 50 },
      { name: 'Sugar', unit: 'kg', qty: 2 },
    ], 4, true);
    expect(r).toEqual({ litres: 20, batches: 2 });
    const rec = app.records();
    const name = (id: string) => rec.items.find((i) => i.id === id)!.name;
    const used = (id: string) => rec.batches.find((b) => b.id === id)!.used.map((u) => [name(u.itemId), u.qty]);
    expect(used(b1.id)).toEqual([['Mangoes', 25], ['Sugar', 1]]);
    expect(used(b2.id)).toEqual([['Mangoes', 25], ['Sugar', 1]]);
    expect(used(b3.id)).toEqual([]);
    const p = rec.products.find((x) => x.id === pid)!;
    expect(p.recipe.map((l) => [name(l.itemId), l.qty])).toEqual([['Mangoes', 25], ['Sugar', 1]]);
    expect(p.water).toBe(2);
  });
  it('can leave the recipe as it is, and refuses with no batch chosen', async () => {
    const app = await testApp();
    const pid = await app.actions.saveProductByNames({ name: 'Passion', kind: 'single', icon: '🟣', colour: '#8E3FA0', premium: false, water: 1, keepsDays: 3 }, [{ name: 'Passion fruit', unit: 'pcs', qty: 80 }]);
    await app.actions.quickBatch({ date: '2026-11-10', productId: pid, size: '500', bottles: 10 });
    const b = app.records().batches[0];
    await app.actions.reconcileBatches(pid, [b.id], [{ name: 'Passion fruit', unit: 'pcs', qty: 45 }], 0, false);
    const p = app.records().products.find((x) => x.id === pid)!;
    expect(p.recipe[0].qty).toBe(80);
    expect(app.records().batches[0].used[0].qty).toBe(45);
    await expect(app.actions.reconcileBatches(pid, [], [{ name: 'Passion fruit', unit: 'pcs', qty: 1 }], 0, true)).rejects.toThrow(/Choose the bottles/);
  });
  it('records a batch worked out in the recipe form on an earlier day', async () => {
    const app = await testApp();
    await app.actions.saveProductFromBatch({ name: 'Orange', kind: 'single', icon: '🍊', colour: '#F7811E', premium: true, keepsDays: 3 }, [{ name: 'Oranges', unit: 'pcs', qty: 40 }], 0, { '500': 10 }, true, '', undefined, '2026-11-05');
    expect(app.records().batches[0].date).toBe('2026-11-05');
    await expect(app.actions.saveProductFromBatch({ name: 'Orange 2', kind: 'single', icon: '🍊', colour: '#F7811E', premium: true, keepsDays: 3 }, [{ name: 'Oranges', unit: 'pcs', qty: 40 }], 0, { '500': 10 }, true, '', undefined, '2999-01-01')).rejects.toThrow(/future/);
  });
});

describe('moving a juice history and deleting it', () => {
  it('moves sales and batches to the other juice, keeps amounts and payments, then deletes', async () => {
    const app = await testApp();
    const stand = await app.actions.saveProductByNames({ name: 'Fresh juice', kind: 'single', icon: '🥤', colour: '#F7931E', premium: false, water: 0, keepsDays: 3 }, []);
    const mango = await app.actions.saveProductByNames({ name: 'Mango', kind: 'single', icon: '🥭', colour: '#FFA41B', premium: false, water: 0, keepsDays: 3 }, []);
    await app.actions.quickBatch({ date: '2026-11-09', productId: stand, size: '500', bottles: 5 });
    await app.actions.saveSale({ date: '2026-11-09', lines: [{ productId: stand, size: '500', qty: 2, price: 3000 }], customerName: 'Kato', method: 'On credit' });
    const moved = await app.actions.moveJuiceAndDelete(stand, mango);
    expect(moved).toBe(2);
    const r = app.records();
    expect(r.products.map((p) => p.name)).toEqual(['Mango']);
    expect(r.sales[0].lines.every((l) => l.productId === mango)).toBe(true);
    expect(r.batches[0].productId).toBe(mango);
    expect(customerBalances(r.customers, r.orders, r.sales, paymentsByRef(r.payments)).get(r.customers[0].id)).toBe(6000);
  });
});

describe('bottle sizes link to the bottles bought', () => {
  it('reads the volume in a name', async () => {
    const { volumeIn } = await import('../src/data/actions');
    expect([volumeIn('Bottles 500 ml'), volumeIn('Bottles 500mls'), volumeIn('Bottles 1liter'), volumeIn('1 litre bottle'), volumeIn('Jerrycan 5 L'), volumeIn('300ml'), volumeIn('Caps')]).toEqual([0.5, 0.5, 1, 1, 5, 0.3, 0]);
  });
  it('links a new bottle to its size, prices the size from what was paid, and leaves caps alone', async () => {
    const app = await testApp();
    const b500 = await app.actions.saveItem({ name: 'Bottles 500mls', kind: 'packaging', unit: 'pcs', reorderLevel: 0 });
    const caps = await app.actions.saveItem({ name: 'Caps 500 ml', kind: 'packaging', unit: 'pcs', reorderLevel: 0 });
    const size = (k: string) => app.settings().sizes.find((z) => z.key === k)!;
    expect(size('500').bottleItemId).toBe(b500);
    expect(app.settings().sizes.filter((z) => z.bottleItemId === caps)).toHaveLength(0);
    await app.actions.savePurchase({ date: '2026-11-15', supplierName: 'Market', itemId: b500, qty: 12, price: 350 });
    expect(size('500').packCost).toBe(350);
    // caps used by every bottle: the size costs bottle + cap
    await app.actions.saveSettings({ perBottle: [caps] });
    await app.actions.savePurchase({ date: '2026-11-15', supplierName: 'Market', itemId: caps, qty: 100, price: 50 });
    expect(size('500').packCost).toBe(400);
    // a bottle linked by hand is kept: a second 500 ml item does not take its place
    const other = await app.actions.saveItem({ name: 'Glass bottles 500 ml', kind: 'packaging', unit: 'pcs', reorderLevel: 0 });
    expect(size('500').bottleItemId).toBe(b500);
    expect(other).toBeTruthy();
  });
  it('links bottles bought before this rule, on their next purchase', async () => {
    const app = await testApp();
    await app.store.commit([{ op: 'set', col: 'items', id: 'old1', data: { name: 'Bottles 1 litre', kind: 'packaging', unit: 'pcs', reorderLevel: 0, archived: false, createdAt: 1, updatedAt: 1 } }]);
    expect(app.settings().sizes.find((z) => z.key === '1000')!.bottleItemId ?? '').toBe('');
    await app.actions.savePurchase({ date: '2026-11-15', supplierName: 'Market', itemId: 'old1', qty: 1, price: 500 });
    expect(app.settings().sizes.find((z) => z.key === '1000')).toMatchObject({ bottleItemId: 'old1', packCost: 500 });
  });
});

describe('the usual bottle on the day list', () => {
  it('is the juice and size sold most, not the last one sold', async () => {
    const app = await juiceApp();
    for (const n of ['Kato', 'Apio', 'Opio']) await app.actions.saveSale({ date: '2026-11-16', lines: app.bottle(), customerName: n, method: 'Cash' });
    await app.actions.saveSale({ date: '2026-11-16', lines: [{ productId: app.productId, size: '1000', qty: 1, price: 10000 }], customerName: 'Reagan', method: 'Cash' });
    expect(mostSold(app.records().sales, '2026-11-16')).toEqual({ productId: app.productId, size: '500' });
    expect(mostSold([], '2026-11-16')).toBeNull();
  });
});

describe('discounts and one price', () => {
  it('takes a discount off the bottles, whole shillings, from the last bottle back', async () => {
    const { applyDiscount, linesValue } = await import('../src/lib/juice');
    const out = applyDiscount([{ productId: 'm', size: '500', qty: 3, price: 3000 }], 2000);
    expect(out).toEqual([
      { productId: 'm', size: '500', qty: 2, price: 3000 },
      { productId: 'm', size: '500', qty: 1, price: 1000, fullPrice: 3000 },
    ]);
    expect(linesValue(out)).toBe(7000);
    const big = applyDiscount([{ productId: 'm', size: '500', qty: 2, price: 3000 }], 4000);
    expect(linesValue(big)).toBe(2000);
    expect(applyDiscount([{ productId: 'm', size: '500', qty: 1, price: 3000 }], 0)).toEqual([{ productId: 'm', size: '500', qty: 1, price: 3000 }]);
  });
  it('saves a discounted sale: the total, the payment and what is owed all follow the discount', async () => {
    const app = await juiceApp();
    const id = await app.actions.saveSale({ date: '2026-11-16', lines: app.bottle(1, 10000), customerName: 'Kato', method: 'Cash', discount: 3000 });
    const r = app.records();
    const s = r.sales.find((x) => x.id === id)!;
    expect(s.discount).toBe(3000);
    expect(r.payments.find((p) => p.refId === id)!.amount).toBe(7000);
    const owed = await app.actions.saveSale({ date: '2026-11-16', lines: app.bottle(2), customerName: 'Apio', method: 'On credit', discount: 2000 });
    expect(app.figures().owes.get(app.cust('Apio').id)).toBe(4000);
    expect(app.records().sales.find((x) => x.id === owed)!.lines.reduce((t, l) => t + l.qty, 0)).toBe(2);
    await expect(app.actions.saveSale({ lines: app.bottle(), customerName: '', method: 'Cash', discount: 5000 })).rejects.toThrow(/more than the sale/);
  });
  it('keeps a standing discount on the customer, and stops it at 0', async () => {
    const app = await juiceApp();
    await app.actions.setCustomerDiscount('Opio', 3000);
    expect(app.cust('Opio').discount).toBe(3000);
    await app.actions.setCustomerDiscount('Opio', 0);
    expect(app.cust('Opio').discount).toBe(0);
  });
  it('has one price per size for every juice', async () => {
    const { priceOf } = await import('../src/lib/juice');
    const size = { key: '500', label: '500 ml', litres: 0.5, price: 3000, premiumPrice: 4000, packCost: 400 };
    expect(priceOf({ premium: true } as never, size)).toBe(3000);
  });
});
