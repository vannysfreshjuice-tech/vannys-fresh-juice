// Production (batches) and Recipes and prices.
import { Blend, CupSoda, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BatchBadge, Card, JuiceBadge, Margin, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Badge, Button, Choice, Empty, PageHead, StatCard, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, showDate, weekdayShort } from '../lib/dates';
import { batchCost, bottleCost, bottledLitres, fridgeCount, priceOf, recipeCostPerLitre } from '../lib/juice';
import { qty as showQty, sum } from '../lib/money';
import { weekStart } from '../lib/staff';
import type { ProductKind } from '../lib/types';
import { makePlan } from './Home';

export function Production() {
  const { batches, productsById, settings, avgCosts, orders, fridge, today, role } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const from = weekStart(today);
  const week = batches.filter((b) => b.date >= from);
  const L = sum(week, (b) => b.litres);
  const juiceCost = sum(week, (b) => batchCost(b, productsById.get(b.productId), settings.sizes, avgCosts).juice);
  const list = [...batches].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const plan = makePlan(orders, addDays(today, 1));
  return (
    <div>
      <PageHead title="Production" action={<Button icon={Plus} onClick={() => sheets.open({ t: 'batch' })}>New batch</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Made this week" value={`${showQty(L)} L`} sub={`${week.length} batches since ${weekdayShort(from)} ${showDate(from).slice(0, 5)}`} />
        {role === 'owner' && <StatCard label="Juice cost per litre" value={j.money(L ? juiceCost / L : 0)} sub="this week, average" />}
        <StatCard label="Bottled this week" value={`${showQty(sum(week, (b) => bottledLitres(b, settings.sizes)))} L`} />
        <StatCard label="Being made" value={String(batches.filter((b) => !Object.values(b.filled ?? {}).some((n) => n > 0)).length)} sub="not bottled yet" />
      </div>
      {plan.length > 0 && (
        <Card title="What to make for tomorrow's orders" className="mb-4">
          <table className="tbl">
            <thead>
              <tr>
                <th>Juice</th>
                <th className="n">Orders need</th>
                <th className="n">In fridge</th>
                <th className="n">Make</th>
              </tr>
            </thead>
            <tbody>
              {plan.map((l) => {
                const have = fridgeCount(fridge, l.productId, l.size);
                return (
                  <tr key={`${l.productId}|${l.size}`}>
                    <td>
                      {productsById.get(l.productId)?.icon} {j.name(l.productId)} {j.sizeLabel(l.size)}
                    </td>
                    <td className="n num">{l.qty}</td>
                    <td className="n num">{have}</td>
                    <td className="n num font-semibold">{Math.max(0, l.qty - have) || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {list.length === 0 ? (
        <Empty icon={Blend} title="No batches yet" body="Each time juice is made, save it as a batch: what went in, the bottles filled and the best-before date." />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {list.map((b) => {
            const p = productsById.get(b.productId);
            const cost = batchCost(b, p, settings.sizes, avgCosts);
            return (
              <button key={b.id} type="button" className="row" onClick={() => sheets.open({ t: 'batchView', id: b.id })}>
                <JuiceBadge product={p} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {p?.name ?? 'Juice'} · {showQty(b.litres)} L
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {b.number} · {showDate(b.date)} · {b.madeBy || 'someone'} · {Object.entries(b.filled).map(([k, n]) => `${n}×${j.sizeLabel(k)}`).join(', ') || 'not bottled yet'}
                  </span>
                  <span className="text-xs text-muted">
                    best before {showDate(b.bestBefore)}
                    {role === 'owner' ? ` · ${j.money(cost.perLitre)} a litre` : ''}
                  </span>
                </span>
                <BatchBadge batch={b} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Recipes() {
  const { products, settings, avgCosts, lastCosts, itemsById, actions, role } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const notify = useNotice();
  const starter = useSaver();
  const [kind, setKind] = useState<'all' | ProductKind | 'hidden'>('all');
  const costs = useMemo(() => new Map([...avgCosts, ...lastCosts]), [avgCosts, lastCosts]);
  const list = products.filter((p) => (kind === 'hidden' ? p.archived : !p.archived && (kind === 'all' || p.kind === kind)));
  const live = products.filter((p) => !p.archived);
  return (
    <div>
      <PageHead title="Recipes and prices" action={role === 'owner' && <Button icon={Plus} onClick={() => sheets.open({ t: 'product', kind: 'cocktail' })}>New cocktail</Button>} />
      <p className="mb-4 rounded-2xl bg-purple-soft px-4 py-3 text-sm text-purple">
        Each recipe makes 10 litres. The cost of a bottle is worked out from the last price you paid for each fruit, plus the bottle, cap and label. When mangoes get dearer, every juice with mango shows it straight away.
      </p>
      <Choice
        scroll
        options={[
          { value: 'all', label: 'All', count: live.length },
          { value: 'single', label: 'Single fruit', count: live.filter((p) => p.kind === 'single').length },
          { value: 'cocktail', label: 'Juice cocktails', count: live.filter((p) => p.kind === 'cocktail').length },
          { value: 'hidden', label: 'Hidden', count: products.filter((p) => p.archived).length },
        ]}
        value={kind}
        onChange={setKind}
      />
      {products.length === 0 && (
        <div className="mt-4">
          <Empty
            icon={CupSoda}
            title="No juices yet"
            body="Start from the usual 5 juices and 7 juice cocktails with their recipes, or add your own."
            action={
              role === 'owner' && (
                <Button busy={starter.busy} onClick={() => starter.run(() => actions.addStarterSet(), () => notify('Added the usual juices, fruit and bottles'))}>
                  Add the usual juices
                </Button>
              )
            }
          />
        </div>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {list.map((p) => {
          const perL = recipeCostPerLitre(p, costs);
          return (
            <section key={p.id} className="card p-4">
              <div className="mb-1 flex items-center gap-3">
                <JuiceBadge product={p} size={38} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">
                    {p.name} {p.kind === 'cocktail' && <Badge tone="green">Cocktail</Badge>} {p.premium && <Badge tone="brown">Premium</Badge>}
                  </h2>
                  {p.tag && <p className="text-xs text-muted">{p.tag}</p>}
                </div>
                {role === 'owner' && <span className="num text-sm text-muted">{j.money(perL)} / L</span>}
              </div>
              <p className="mb-2 text-sm text-muted">
                {p.recipe.map((r) => `${showQty(r.qty)} ${itemsById.get(r.itemId)?.unit ?? ''} ${(itemsById.get(r.itemId)?.name ?? '?').toLowerCase()}`).join(' · ') || 'No recipe yet'}
                {p.water ? ` · ${showQty(p.water)} L water` : ''} · keeps {p.keepsDays} days
              </p>
              {role === 'owner' && (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Size</th>
                      <th className="n">Cost</th>
                      <th className="n">Price</th>
                      <th className="n">Profit</th>
                      <th className="n">Margin</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settings.sizes.map((s) => {
                      const c = bottleCost(perL, s);
                      const pr = priceOf(p, s);
                      return (
                        <tr key={s.key}>
                          <td>{s.label}</td>
                          <td className="n num">{j.money(c)}</td>
                          <td className="n num">{j.money(pr)}</td>
                          <td className="n num font-semibold">{j.money(pr - c)}</td>
                          <td className="n">
                            <Margin value={pr ? (pr - c) / pr : 0} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {role === 'owner' && (
                <Button small variant="plain" className="mt-2" onClick={() => sheets.open({ t: 'product', id: p.id })}>
                  Change recipe
                </Button>
              )}
            </section>
          );
        })}
      </div>
      {role === 'owner' && products.length > 0 && (
        <Button variant="soft" icon={Plus} className="mt-4" onClick={() => sheets.open({ t: 'product', kind: 'single' })}>
          New single-fruit juice
        </Button>
      )}
    </div>
  );
}
