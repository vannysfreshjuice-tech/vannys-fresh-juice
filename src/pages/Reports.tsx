// Reports: profit for a period, profit by juice (single fruit and cocktails apart), how customers paid,
// where sales came from. Print gives a PDF (the phone's print screen has "Save as PDF").
import { Download, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, JuiceBadge, Margin, share, useViewMode, ViewToggle } from '../components/bits';
import { Badge, Bars, Button, Choice, Line, PageHead, PeriodPicker, StatCard, cx, usePeriod } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDay } from '../lib/dates';
import { juiceStats, previousPeriod, type JuiceStats } from '../lib/performance';
import { giveFile, toCsv } from '../lib/backup';
import { money as m, qty as showQty } from '../lib/money';
import { recipeCostPerLitre } from '../lib/juice';
import { buildReport } from '../lib/reports';

type Basis = 'recipe' | 'bought';
const BASIS_KEY = 'vannys.profitBasis';

export function Reports() {
  const d = useData();
  const { settings, avgCosts } = d;
  const period = usePeriod('thisMonth');
  const r = useMemo(() => buildReport(d, settings, period.period, avgCosts), [d, settings, period.period, avgCosts]);
  const money = (n: number) => m(n, settings.currency);
  const [view, setView] = useViewMode('juices', 'cards');
  const [basis, setBasis] = useState<Basis>(() => (localStorage.getItem(BASIS_KEY) === 'bought' ? 'bought' : 'recipe'));
  const pickBasis = (b: Basis) => {
    localStorage.setItem(BASIS_KEY, b);
    setBasis(b);
  };
  const profit = basis === 'bought' ? r.bought.profit : r.profit;
  const prevPeriod = previousPeriod(period.period, d.today);
  const before = useMemo(() => (prevPeriod ? buildReport(d, settings, prevPeriod, avgCosts) : null), [d, settings, prevPeriod?.from, prevPeriod?.to, avgCosts]); // eslint-disable-line react-hooks/exhaustive-deps
  const juices = useMemo(() => juiceStats(r, before, d.sales, d.orders, d.batches, d.writeOffs), [r, before, d.sales, d.orders, d.batches, d.writeOffs]);
  // Juices sold whose fruit costs nothing in the records: their profit is overstated.
  const noCost = r.rows.filter((x) => x.bottles > 0 && recipeCostPerLitre(x.product, avgCosts) <= 0).map((x) => x.product.name);
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
      {noCost.length > 0 && basis === 'recipe' && (
        <p className="mb-4 rounded-xl bg-amber-soft px-3 py-2 text-sm text-amber">
          {noCost.join(', ')} {noCost.length === 1 ? 'has' : 'have'} no fruit cost yet (no recipe, or its fruit was never bought in the app), so the profit shown is too high. Add the recipe on Recipes and prices and record fruit on Buying, or see the profit by what was bought.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Sales" value={money(r.sales + r.deliveryFees)} sub={`${r.bottles} bottles`} />
        <StatCard label={basis === 'bought' ? 'Profit (by what was bought)' : 'Profit'} value={money(profit)} tone={profit >= 0 ? 'good' : 'warn'} sub={r.sales ? `${Math.round(share(profit, r.sales + r.deliveryFees) * 100)}% of sales` : undefined} />
        <StatCard label="Money in" value={money(r.moneyIn)} sub="payments received" />
        <StatCard label="Juice made" value={`${showQty(r.litresMade)} L`} sub={`${r.batches} batches`} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Profit">
          <div className="no-print mb-3">
            <Choice
              options={[
                { value: 'recipe', label: 'By recipe' },
                { value: 'bought', label: 'By what was bought' },
              ]}
              value={basis}
              onChange={pickBasis}
            />
          </div>
          <Line label={`Bottles sold (${r.bottles})`} value={money(r.sales)} />
          {r.deliveryFees > 0 && <Line label="Delivery charges" value={money(r.deliveryFees)} />}
          {basis === 'recipe' ? (
            <Line label="Juice and bottles of what was sold" value={`− ${money(r.juiceCost)}`} tone="bad" />
          ) : (
            <>
              <Line label="Fruit and ingredients bought" value={`− ${money(r.bought.fruit)}`} tone="bad" />
              <Line label="Bottles and packaging bought" value={`− ${money(r.bought.packaging)}`} tone="bad" />
            </>
          )}
          <Line label="Running costs (expenses)" value={`− ${money(r.expenses)}`} tone="bad" />
          <Line label="Wages and advances" value={`− ${money(r.wages)}`} tone="bad" />
          {basis === 'recipe' && <Line label={`Spoiled juice (${r.spoiledBottles} bottles)`} value={`− ${money(r.spoiled)}`} tone="bad" />}
          <div className="mt-1 border-t border-line pt-1">
            <Line strong label="Profit" value={money(profit)} tone={profit >= 0 ? 'good' : 'bad'} />
          </div>
          <p className="mt-2 text-xs text-muted">
            {basis === 'recipe'
              ? 'Each bottle sold costs its juice (from the recipe or its batch, at the prices paid on Buying) and its bottle, cap and label. Fruit bought but not yet used is not a cost until its juice is sold.'
              : 'Everything bought on Buying in this period counts as its cost, used or not; spoiled juice is not taken off again. Simple to check against the receipts; a big purchase at the end of the month makes that month look lower.'}{' '}
            The other way: {basis === 'recipe' ? money(r.bought.profit) : money(r.profit)}.
          </p>
        </Card>
        <div className="space-y-4">
          <Card title="How customers paid">{r.byMethod.length ? <Bars currency={settings.currency} rows={r.byMethod.map((x) => ({ label: x.method, amount: x.amount, share: share(x.amount, r.moneyIn) }))} /> : <p className="text-sm text-muted">No payments in this period.</p>}</Card>
          <Card title="Where sales came from">
            {r.byChannel.length ? <Bars currency={settings.currency} rows={r.byChannel.map((x) => ({ label: x.channel, amount: x.amount, share: share(x.amount, r.sales) }))} /> : <p className="text-sm text-muted">No sales in this period.</p>}
          </Card>
        </div>
      </div>
      <Card title="How each juice is doing" className="mt-4" action={<ViewToggle value={view} onChange={setView} />}>
        {r.rows.length === 0 ? (
          <p className="text-sm text-muted">No sales in this period.</p>
        ) : view === 'cards' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {juices.map((x, i) => (
              <JuiceCard key={x.product.id} x={x} rank={i + 1} hasBefore={!!before} />
            ))}
          </div>
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
      {r.bought.items.length > 0 && (
        <Card title={`Fruit, ingredients and packaging bought · ${money(r.bought.total)}`} className="mt-4">
          <Bars currency={settings.currency} rows={r.bought.items.map((x) => ({ label: x.name, amount: x.amount, share: share(x.amount, r.bought.total) }))} />
          <p className="mt-2 text-xs text-muted">From Buying. Running costs (rent, power, transport...) are under Expenses and shown below.</p>
        </Card>
      )}
      {r.expenseGroups.length > 0 && (
        <Card title="Running costs by group" className="mt-4">
          <Bars currency={settings.currency} rows={r.expenseGroups.map((x) => ({ label: x.group, amount: x.amount, share: share(x.amount, r.expenses) }))} />
        </Card>
      )}
    </div>
  );
}

/** One juice for the period: sales, bottles, profit and margin, its share, customers, and the change on the period before. */
function JuiceCard({ x, rank, hasBefore }: { x: JuiceStats; rank: number; hasBefore: boolean }) {
  const { settings } = useData();
  const cur = (n: number) => m(n, settings.currency).replace(`${settings.currency} `, '');
  const ch = x.change;
  return (
    <div className="flex flex-col rounded-2xl border border-line bg-page p-4">
      <div className="flex items-start gap-3">
        <JuiceBadge product={x.product} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{x.product.name}</span>
          <span className="block text-sm text-muted">
            No. {rank} · {x.product.kind === 'cocktail' ? 'Juice cocktail' : 'Single fruit'}
          </span>
        </span>
        {hasBefore && ch !== null ? <Badge tone={ch >= 0 ? 'green' : 'red'}>{`${ch >= 0 ? '+' : ''}${Math.round(ch * 100)}%`}</Badge> : hasBefore ? <Badge tone="amber">New</Badge> : null}
      </div>
      <div className="num mt-3 grid grid-cols-3 divide-x divide-line border-y border-line py-2 text-center">
        <span>
          <span className="block text-[11px] text-muted">Bottles</span>
          <span className="text-sm font-semibold">{x.bottles}</span>
        </span>
        <span>
          <span className="block text-[11px] text-muted">Sales</span>
          <span className="text-sm font-semibold">{cur(x.sales)}</span>
        </span>
        <span>
          <span className="block text-[11px] text-muted">Profit</span>
          <span className={cx('text-sm font-semibold', x.profit >= 0 ? 'text-leaf' : 'text-cherry')}>{cur(x.profit)}</span>
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
        <span>Share of sales</span>
        <span className="num text-base text-ink">{Math.round(x.share * 100)}%</span>
      </div>
      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-line">
        <span className="block h-full rounded-full" style={{ width: `${Math.round(x.share * 100)}%`, background: x.product.colour || 'var(--accent)' }} />
      </span>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <span className="text-muted">Margin</span>
        <span className="text-right">
          <Margin value={x.margin} />
        </span>
        <span className="text-muted">Customers</span>
        <span className="num text-right">{x.customers}</span>
        <span className="text-muted">Days sold</span>
        <span className="num text-right">{x.daysSold}</span>
        {x.spoiled > 0 && (
          <>
            <span className="text-muted">Spoiled</span>
            <span className="num text-right text-cherry">{x.spoiled} bottles</span>
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">
        {x.lastSold ? `Last sold ${showDay(x.lastSold)}` : ''}
        {hasBefore && ch !== null && ` · ${ch >= 0 ? 'up' : 'down'} ${Math.abs(Math.round(ch * 100))}% on the period before`}
      </p>
    </div>
  );
}
