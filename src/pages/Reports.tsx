// Reports: profit for a period, profit by juice (single fruit and cocktails apart), how customers paid,
// where sales came from. Print gives a PDF (the phone's print screen has "Save as PDF").
import { Download, Printer } from 'lucide-react';
import { useMemo } from 'react';
import { Card, JuiceBadge, Margin, share } from '../components/bits';
import { Bars, Button, Line, PageHead, PeriodPicker, StatCard, usePeriod } from '../components/ui';
import { useData } from '../data/DataContext';
import { giveFile, toCsv } from '../lib/backup';
import { money as m, qty as showQty } from '../lib/money';
import { buildReport } from '../lib/reports';

export function Reports() {
  const d = useData();
  const { settings, avgCosts } = d;
  const period = usePeriod('thisMonth');
  const r = useMemo(() => buildReport(d, settings, period.period, avgCosts), [d, settings, period.period, avgCosts]);
  const money = (n: number) => m(n, settings.currency);
  const csv = () =>
    giveFile(
      `vannys-report-${period.period.from || 'start'}-${period.period.to || 'today'}.csv`,
      toCsv(
        ['Juice', 'Kind', 'Bottles', 'Litres', 'Sales', 'Cost', 'Profit'],
        r.rows.map((x) => [x.product.name, x.product.kind === 'cocktail' ? 'Juice cocktail' : 'Single fruit', x.bottles, Math.round(x.litres * 10) / 10, Math.round(x.sales), Math.round(x.cost), Math.round(x.profit)]),
      ),
      'text/csv',
    );
  return (
    <div>
      <PageHead
        title="Reports"
        eyebrow={period.period.label}
        action={
          <div className="no-print flex gap-2">
            <Button variant="plain" icon={Printer} onClick={() => window.print()}>
              Print / PDF
            </Button>
            <Button variant="plain" icon={Download} onClick={csv}>
              Excel
            </Button>
          </div>
        }
      />
      <div className="no-print mb-4">
        <PeriodPicker state={period} />
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sales" value={money(r.sales + r.deliveryFees)} sub={`${r.bottles} bottles`} />
        <StatCard label="Profit" value={money(r.profit)} tone={r.profit >= 0 ? 'good' : 'warn'} sub={r.sales ? `${Math.round(share(r.profit, r.sales + r.deliveryFees) * 100)}% of sales` : undefined} />
        <StatCard label="Money in" value={money(r.moneyIn)} sub="payments received" />
        <StatCard label="Juice made" value={`${showQty(r.litresMade)} L`} sub={`${r.batches} batches`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Profit">
          <Line label={`Bottles sold (${r.bottles})`} value={money(r.sales)} />
          {r.deliveryFees > 0 && <Line label="Delivery charges" value={money(r.deliveryFees)} />}
          <Line label="Juice and bottles of what was sold" value={`− ${money(r.juiceCost)}`} tone="bad" />
          <Line label="Running costs (expenses)" value={`− ${money(r.expenses)}`} tone="bad" />
          <Line label="Wages and advances" value={`− ${money(r.wages)}`} tone="bad" />
          <Line label={`Spoiled juice (${r.spoiledBottles} bottles)`} value={`− ${money(r.spoiled)}`} tone="bad" />
          <div className="mt-1 border-t border-line pt-1">
            <Line strong label="Profit" value={money(r.profit)} tone={r.profit >= 0 ? 'good' : 'bad'} />
          </div>
          <p className="mt-2 text-xs text-muted">Sold = counter sales on their day and orders on the day they were delivered. Fruit bought but not yet used is not a cost until the juice is sold.</p>
        </Card>
        <div className="space-y-4">
          <Card title="How customers paid">{r.byMethod.length ? <Bars currency={settings.currency} rows={r.byMethod.map((x) => ({ label: x.method, amount: x.amount, share: share(x.amount, r.moneyIn) }))} /> : <p className="text-sm text-muted">No payments in this period.</p>}</Card>
          <Card title="Where sales came from">
            {r.byChannel.length ? <Bars currency={settings.currency} rows={r.byChannel.map((x) => ({ label: x.channel, amount: x.amount, share: share(x.amount, r.sales) }))} /> : <p className="text-sm text-muted">No sales in this period.</p>}
          </Card>
        </div>
      </div>
      <Card title="Profit by juice" className="mt-4">
        {r.rows.length === 0 ? (
          <p className="text-sm text-muted">No sales in this period.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Juice</th>
                  <th className="n">Bottles</th>
                  <th className="n">Sales</th>
                  <th className="n">Cost</th>
                  <th className="n">Profit</th>
                  <th className="n">Margin</th>
                </tr>
              </thead>
              <tbody>
                {r.kinds.map((k) => {
                  const g = r.rows.filter((x) => x.product.kind === k.kind);
                  if (!g.length) return null;
                  return [
                    <tr key={k.kind} className="grp">
                      <td colSpan={6}>
                        {k.kind === 'single' ? 'Single fruit' : 'Juice cocktails'} · {Math.round(share(k.sales, r.sales) * 100)}% of sales
                      </td>
                    </tr>,
                    ...g.map((x) => (
                      <tr key={x.product.id}>
                        <td>
                          <span className="flex items-center gap-2 whitespace-nowrap">
                            <JuiceBadge product={x.product} size={26} />
                            {x.product.name}
                          </span>
                        </td>
                        <td className="n num">{x.bottles}</td>
                        <td className="n num">{money(x.sales)}</td>
                        <td className="n num">{money(x.cost)}</td>
                        <td className="n num font-semibold">{money(x.profit)}</td>
                        <td className="n">
                          <Margin value={share(x.profit, x.sales)} />
                        </td>
                      </tr>
                    )),
                    <tr key={`${k.kind}-sub`} className="text-muted">
                      <td className="font-semibold">All {k.kind === 'single' ? 'single fruit' : 'juice cocktails'}</td>
                      <td className="n num">{k.bottles}</td>
                      <td className="n num">{money(k.sales)}</td>
                      <td className="n num">{money(k.cost)}</td>
                      <td className="n num font-semibold">{money(k.sales - k.cost)}</td>
                      <td className="n">{Math.round(share(k.sales - k.cost, k.sales) * 100)}%</td>
                    </tr>,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {r.expenseGroups.length > 0 && (
        <Card title="Running costs by group" className="mt-4">
          <Bars currency={settings.currency} rows={r.expenseGroups.map((x) => ({ label: x.group, amount: x.amount, share: share(x.amount, r.expenses) }))} />
        </Card>
      )}
    </div>
  );
}
