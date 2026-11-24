// Sales and production as plain lists, and production against sales for a period (Vanessa, 24 Nov 2026):
// not the Day list's taps, just every record, with totals, so made and sold can be checked against each other.
import { useMemo, useState } from 'react';
import { Card, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Choice, DateInput, Field, PageHead, Select, TextInput } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, showDate, showDay } from '../lib/dates';
import { dayStock, productionBalance } from '../lib/day';
import { batchCost, orderTotals, saleTotals } from '../lib/juice';
import { num, qty as showQty, sum } from '../lib/money';

type Tab = 'sales' | 'production' | 'balance';

export function Records() {
  const d = useData();
  const { sales, orders, batches, writeOffs, byRef, settings, today, itemsById, productsById, avgCosts } = d;
  const j = useJuice();
  const sheets = useSheets();
  const [tab, setTab] = useState<Tab>('balance');
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [juice, setJuice] = useState('');
  const [find, setFind] = useState('');
  const inRange = (date: string) => date >= from && date <= to;
  const juiceOk = (lines: { productId: string }[]) => !juice || lines.some((l) => l.productId === juice);
  const sizeLabel = (k: string) => j.sizeLabel(k);
  const cur = j.money;

  // ---------- sales: counter and Day list sales, and orders delivered ----------
  const saleRows = useMemo(() => {
    const rows: { key: string; date: string; number: string; who: string; lines: { productId: string; size: string; qty: number; batchId?: string }[]; value: number; paid: number; balance: number; how: string; open: () => void }[] = [];
    for (const s of sales) {
      if (s.opening || !inRange(s.date) || !juiceOk(s.lines)) continue;
      const t = saleTotals(s, byRef.get(s.id));
      rows.push({ key: s.id, date: s.date, number: s.number, who: s.customerName || 'Walk-in', lines: s.lines, value: t.value, paid: t.paid, balance: t.balance, how: s.method, open: () => sheets.open({ t: 'saleView', id: s.id }) });
    }
    for (const o of orders) {
      const day = o.deliveredOn;
      if (o.stage !== 'Delivered' || !day || !inRange(day) || !juiceOk(o.lines)) continue;
      const t = orderTotals(o, byRef.get(o.id));
      rows.push({ key: o.id, date: day, number: o.number, who: d.customersById.get(o.customerId)?.name || '', lines: o.packed?.length ? o.packed : o.lines, value: t.value, paid: t.paid, balance: t.balance, how: 'Order', open: () => sheets.open({ t: 'orderView', id: o.id }) });
    }
    const q = find.trim().toLowerCase();
    return rows.filter((r) => !q || r.who.toLowerCase().includes(q) || r.number.toLowerCase().includes(q)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, orders, byRef, from, to, juice, find]);

  // ---------- production: every batch ----------
  const batchRows = useMemo(
    () =>
      batches
        .filter((b) => inRange(b.date) && (!juice || b.productId === juice))
        .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number))
        .map((b) => ({ b, bottles: sum(Object.values(b.filled ?? {}), (n) => num(n)), cost: batchCost(b, productsById.get(b.productId), settings.sizes, avgCosts).total })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batches, from, to, juice, productsById, settings.sizes, avgCosts],
  );

  // ---------- production against sales ----------
  const balance = useMemo(() => productionBalance(batches, sales, orders, writeOffs, from, to).filter((r) => !juice || r.productId === juice), [batches, sales, orders, writeOffs, from, to, juice]);
  const days = useMemo(() => {
    const out: { day: string; st: ReturnType<typeof dayStock> }[] = [];
    for (let day = from; day <= to && out.length < 62; day = addDays(day, 1)) out.push({ day, st: dayStock(day, batches, sales, orders, writeOffs) });
    return out.filter((x) => x.st.made || x.st.sold || x.st.spoiled || x.st.unrecorded || x.st.before).reverse();
  }, [batches, sales, orders, writeOffs, from, to]);

  const linesText = (ls: { productId: string; size: string; qty: number }[]) => ls.map((l) => `${l.qty} × ${j.name(l.productId)} ${sizeLabel(l.size)}`).join(', ');
  const total = (rows: typeof balance, k: keyof Omit<(typeof balance)[number], 'productId' | 'size'>) => sum(rows, (r) => r[k]);

  return (
    <div>
      <PageHead title="Sales and production" />
      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="From">
            <DateInput value={from} max={to} onChange={(v) => v && setFrom(v)} />
          </Field>
          <Field label="To">
            <DateInput value={to} onChange={(v) => v && setTo(v)} />
          </Field>
          <Field label="Juice">
            <Select options={[{ value: '', label: 'All juices' }, ...d.products.map((p) => ({ value: p.id, label: p.name }))]} value={juice} onChange={(e) => setJuice(e.target.value)} />
          </Field>
          {tab === 'sales' && (
            <Field label="Customer or number">
              <TextInput value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search" />
            </Field>
          )}
        </div>
        <div className="mt-3">
          <Choice
            options={[
              { value: 'balance', label: 'Made against sold' },
              { value: 'sales', label: `All sales (${saleRows.length})` },
              { value: 'production', label: `All production (${batchRows.length})` },
            ]}
            value={tab}
            onChange={(v) => setTab(v as Tab)}
          />
        </div>
      </Card>

      {tab === 'balance' && (
        <>
          <Card title={`Made against sold, ${showDate(from)} to ${showDate(to)}`}>
            <p className="mb-2 text-sm text-muted">For each juice and size: left from before + made − sold − went bad = left. "Not recorded" are bottles sold with no bottles made recorded for them: add the bottles made, or correct the juice on the Day list.</p>
            {balance.length === 0 ? (
              <p className="text-sm text-muted">Nothing made or sold in these days.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl num">
                  <thead>
                    <tr>
                      <th className="text-left">Juice</th>
                      <th>Left from before</th>
                      <th>+ Made</th>
                      <th>− Sold</th>
                      <th>− Went bad</th>
                      <th>= Left</th>
                      <th>Not recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balance.map((r) => (
                      <tr key={`${r.productId}|${r.size}`}>
                        <td className="text-left">
                          {j.name(r.productId)} {sizeLabel(r.size)}
                        </td>
                        <td>{r.before}</td>
                        <td>{r.made}</td>
                        <td>{r.sold}</td>
                        <td>{r.spoiled}</td>
                        <td className="font-semibold">{r.left}</td>
                        <td className={r.unrecorded ? 'font-semibold text-cherry' : ''}>{r.unrecorded}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="text-left">All</td>
                      <td>{total(balance, 'before')}</td>
                      <td>{total(balance, 'made')}</td>
                      <td>{total(balance, 'sold')}</td>
                      <td>{total(balance, 'spoiled')}</td>
                      <td>{total(balance, 'left')}</td>
                      <td className={total(balance, 'unrecorded') ? 'text-cherry' : ''}>{total(balance, 'unrecorded')}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Day by day (all juices)" className="mt-4">
            {days.length === 0 ? (
              <p className="text-sm text-muted">Nothing made or sold in these days.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl num">
                  <thead>
                    <tr>
                      <th className="text-left">Day</th>
                      <th>Left from before</th>
                      <th>+ Made</th>
                      <th>− Sold</th>
                      <th>− Went bad</th>
                      <th>= Left</th>
                      <th>Not recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {days.map(({ day, st }) => (
                      <tr key={day}>
                        <td className="text-left">{showDay(day)}</td>
                        <td>{st.before}</td>
                        <td>{st.made}</td>
                        <td>{st.sold}</td>
                        <td>{st.spoiled}</td>
                        <td className="font-semibold">{st.left}</td>
                        <td className={st.unrecorded ? 'font-semibold text-cherry' : ''}>{st.unrecorded}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'sales' && (
        <Card title={`All sales, ${showDate(from)} to ${showDate(to)}`}>
          <p className="mb-2 text-sm text-muted">
            {saleRows.length} sales · {sum(saleRows, (r) => sum(r.lines, (l) => num(l.qty)))} bottles · {cur(sum(saleRows, (r) => r.value))} · paid {cur(sum(saleRows, (r) => r.paid))} · not paid {cur(sum(saleRows, (r) => r.balance))}. Tap a sale to change or undo it.
          </p>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="text-left">Day</th>
                  <th className="text-left">No.</th>
                  <th className="text-left">Customer</th>
                  <th className="text-left">What</th>
                  <th>Total</th>
                  <th>Paid</th>
                  <th>Not paid</th>
                  <th className="text-left">How</th>
                </tr>
              </thead>
              <tbody>
                {saleRows.map((r) => (
                  <tr key={r.key} className="cursor-pointer hover:bg-page" onClick={r.open}>
                    <td className="text-left whitespace-nowrap">{showDate(r.date)}</td>
                    <td className="text-left">{r.number}</td>
                    <td className="text-left">{r.who}</td>
                    <td className="text-left">{linesText(r.lines)}</td>
                    <td className="num">{cur(r.value)}</td>
                    <td className="num">{cur(r.paid)}</td>
                    <td className={r.balance ? 'num text-cherry' : 'num'}>{cur(r.balance)}</td>
                    <td className="text-left">{r.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'production' && (
        <Card title={`All production, ${showDate(from)} to ${showDate(to)}`}>
          <p className="mb-2 text-sm text-muted">
            {batchRows.length} batches · {sum(batchRows, (r) => r.bottles)} bottles · {showQty(sum(batchRows, (r) => num(r.b.litres)))} litres · cost {cur(sum(batchRows, (r) => r.cost))}. Tap a batch to change or delete it.
          </p>
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="text-left">Day</th>
                  <th className="text-left">Batch</th>
                  <th className="text-left">Juice</th>
                  <th className="text-left">Bottles</th>
                  <th>Litres</th>
                  <th className="text-left">What went in</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.map(({ b, cost }) => (
                  <tr key={b.id} className="cursor-pointer hover:bg-page" onClick={() => sheets.open({ t: 'batchView', id: b.id })}>
                    <td className="text-left whitespace-nowrap">{showDate(b.date)}</td>
                    <td className="text-left">{b.number}</td>
                    <td className="text-left">{j.name(b.productId)}</td>
                    <td className="text-left">
                      {Object.entries(b.filled ?? {})
                        .filter(([, n]) => num(n) > 0)
                        .map(([k, n]) => `${n} × ${sizeLabel(k)}`)
                        .join(', ') || 'not bottled yet'}
                    </td>
                    <td className="num">{showQty(num(b.litres))}</td>
                    <td className="text-left">{(b.used ?? []).map((u) => `${showQty(u.qty)} ${itemsById.get(u.itemId)?.name ?? '?'}`).join(', ') || 'nothing recorded'}</td>
                    <td className="num">{cur(cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
