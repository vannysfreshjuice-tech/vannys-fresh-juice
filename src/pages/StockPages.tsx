// Stock (the fridge, fruit, packaging, temperatures) and Buying and suppliers.
import { Boxes, Droplet, Plus, ShoppingBasket, Thermometer } from 'lucide-react';
import { useState } from 'react';
import { Card, JuiceBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Badge, Button, Choice, Empty, PageHead, StatCard, cx } from '../components/ui';
import { useData } from '../data/DataContext';
import { relativeDay, showDate } from '../lib/dates';
import { fridgeCount, fridgeTotal, purchaseTotals } from '../lib/juice';
import { qty as showQty, sum } from '../lib/money';
import type { ItemKind, ProductKind } from '../lib/types';

type Tab = 'fridge' | ItemKind;

export function Stock() {
  const { products, settings, fridge, batches, items, levels, avgCosts, readings, today, role, productsById } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const [tab, setTab] = useState<Tab>('fridge');
  const live = products.filter((p) => !p.archived);
  const inFridge = batches.filter((b) => (fridge.get(b.id)?.total ?? 0) > 0).sort((a, b) => a.bestBefore.localeCompare(b.bestBefore));
  const todays = readings.filter((r) => r.date === today).sort((a, b) => b.time.localeCompare(a.time));
  const canChange = role === 'owner' || role === 'production';
  return (
    <div>
      <PageHead title="Stock" />
      <Choice
        scroll
        options={[
          { value: 'fridge' as Tab, label: 'Juice in the fridge' },
          { value: 'fruit' as Tab, label: 'Fruit and ingredients' },
          { value: 'packaging' as Tab, label: 'Bottles and packaging' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'fridge' ? (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card title="Bottles ready to sell">
              {live.length === 0 ? (
                <p className="text-sm text-muted">No juices yet.</p>
              ) : (
                <div className="-mx-1 overflow-x-auto px-1">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Juice</th>
                        {settings.sizes.map((s) => (
                          <th key={s.key} className="n">
                            {s.label}
                          </th>
                        ))}
                        <th className="n">All</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(['single', 'cocktail'] as ProductKind[]).map((k) => {
                        const ps = live.filter((p) => p.kind === k);
                        if (!ps.length) return null;
                        return [
                          <tr key={k} className="grp">
                            <td colSpan={settings.sizes.length + 2}>{k === 'single' ? 'Single fruit' : 'Juice cocktails'}</td>
                          </tr>,
                          ...ps.map((p) => (
                            <tr key={p.id}>
                              <td className="whitespace-nowrap">
                                {p.icon} {p.name}
                              </td>
                              {settings.sizes.map((s) => {
                                const n = fridgeCount(fridge, p.id, s.key);
                                return (
                                  <td key={s.key} className={cx('n num', n === 0 && 'text-faint')}>
                                    {n}
                                  </td>
                                );
                              })}
                              <td className="n num font-semibold">{fridgeTotal(fridge, p.id)}</td>
                            </tr>
                          )),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-muted">Worked out from the batches: bottles filled, less those sold, packed for orders or written off.</p>
            </Card>
            <Card title="Fridge temperatures today" icon={<Thermometer size={18} className="text-accent-dark" aria-hidden />} action={<Button small variant="plain" onClick={() => sheets.open({ t: 'reading' })}>Record</Button>}>
              {settings.fridges.map((f) => {
                const r = todays.find((x) => x.fridge === f);
                const warm = r && r.celsius > settings.fridgeMax;
                return (
                  <div key={f} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                    <span className="flex-1 font-medium">{f}</span>
                    {r ? (
                      <>
                        <span className="num">{r.celsius} °C</span>
                        <span className="text-xs text-muted">{r.time}</span>
                        <Badge tone={warm ? 'red' : 'green'}>{warm ? 'Too warm' : 'OK'}</Badge>
                      </>
                    ) : (
                      <Badge tone="amber">Not read today</Badge>
                    )}
                  </div>
                );
              })}
              <p className="mt-2 text-xs text-muted">Keep juice at 0 to {settings.fridgeMax} °C.</p>
            </Card>
          </div>
          <Card title="By batch · sell the oldest first" action={canChange && inFridge.length > 0 && <Button small variant="plain" icon={Droplet} onClick={() => sheets.open({ t: 'writeOff' })}>Write off spoiled</Button>}>
            {inFridge.length === 0 ? (
              <p className="text-sm text-muted">The fridge is empty.</p>
            ) : (
              <div className="divide-y divide-line">
                {inFridge.map((b) => {
                  const left = fridge.get(b.id)!;
                  const days = relativeDay(b.bestBefore, today);
                  const soon = b.bestBefore <= today;
                  const tomorrow = days === 'Tomorrow';
                  return (
                    <button key={b.id} type="button" className="flex w-full items-center gap-3 py-2.5 text-left" onClick={() => sheets.open({ t: 'batchView', id: b.id })}>
                      <JuiceBadge product={productsById.get(b.productId)} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold">
                          {j.name(b.productId)} · {b.number}
                        </span>
                        <span className="text-sm text-muted">
                          {Object.entries(left.left)
                            .filter(([, n]) => n > 0)
                            .map(([k, n]) => `${n} × ${j.sizeLabel(k)}`)
                            .join(', ')}
                        </span>
                      </span>
                      <Badge tone={soon ? 'red' : tomorrow ? 'amber' : 'green'}>{b.bestBefore < today ? 'Past best-before' : soon ? 'Best before today' : tomorrow ? 'Best before tomorrow' : `Best before ${showDate(b.bestBefore).slice(0, 5)}`}</Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      ) : (
        <div className="mt-4">
          {(() => {
            const list = items.filter((i) => i.kind === tab && !i.archived);
            const value = sum(list, (i) => (levels.get(i.id)?.onHand ?? 0) * (avgCosts.get(i.id) ?? 0));
            return (
              <>
                {list.length === 0 ? (
                  <Empty icon={Boxes} title="Nothing here yet" body={tab === 'fruit' ? 'Add the fruit, sugar and other ingredients you buy.' : 'Add the bottles, caps and labels you buy.'} />
                ) : (
                  <div className="card divide-y divide-line overflow-hidden">
                    {list.map((it) => {
                      const l = levels.get(it.id);
                      const on = l?.onHand ?? 0;
                      return (
                        <div key={it.id} className="flex items-center gap-3 px-4 py-3">
                          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => canChange && sheets.open({ t: 'item', id: it.id })}>
                            <span className="block font-semibold">{it.name}</span>
                            <span className="mt-1 block h-2 overflow-hidden rounded-full bg-line">
                              <span className={cx('block h-full rounded-full', l?.low ? 'bg-cherry' : 'bg-leaf')} style={{ width: `${Math.min(100, it.reorderLevel ? (on / (it.reorderLevel * 2)) * 100 : 60)}%` }} />
                            </span>
                            <span className="mt-0.5 block text-xs text-muted">
                              reorder at {showQty(it.reorderLevel)} {it.unit}
                              {role === 'owner' && avgCosts.get(it.id) ? ` · ${j.money(avgCosts.get(it.id) ?? 0)} per ${it.unit}` : ''}
                            </span>
                          </button>
                          <span className={cx('num text-right font-semibold', l?.low && 'text-cherry')}>
                            {showQty(on)} {it.unit}
                          </span>
                          {canChange && (
                            <div className="flex flex-col gap-1">
                              <Button small variant="plain" onClick={() => sheets.open({ t: 'purchase', itemId: it.id })}>
                                Buy
                              </Button>
                              <Button small variant="plain" onClick={() => sheets.open({ t: 'count', itemId: it.id })}>
                                Count
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {role === 'owner' && list.length > 0 && <p className="mt-2 text-sm text-muted">Worth about {j.money(value)} at what it cost.</p>}
                {canChange && (
                  <Button variant="soft" icon={Plus} className="mt-3" onClick={() => sheets.open({ t: 'item', kind: tab })}>
                    New {tab === 'fruit' ? 'fruit or ingredient' : 'packaging item'}
                  </Button>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

export function Buying() {
  const { purchases, suppliers, itemsById, byRef, supplierBal, today, lastCosts, items } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const month = today.slice(0, 7);
  const thisMonth = purchases.filter((p) => p.date.slice(0, 7) === month);
  const spent = sum(thisMonth, (p) => p.qty * p.price);
  const owed = sum([...supplierBal.values()], (v) => v);
  const list = [...purchases].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  // Price history of the most bought fruit, newest last.
  const counts = new Map<string, number>();
  for (const p of purchases) if (itemsById.get(p.itemId)?.kind === 'fruit') counts.set(p.itemId, (counts.get(p.itemId) ?? 0) + 1);
  const topFruit = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const history = topFruit ? purchases.filter((p) => p.itemId === topFruit).sort((a, b) => a.date.localeCompare(b.date)).slice(-8) : [];
  const maxP = Math.max(1, ...history.map((h) => h.price));
  return (
    <div>
      <PageHead title="Buying and suppliers" action={<Button icon={Plus} onClick={() => sheets.open({ t: 'purchase' })}>Buy</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Bought this month" value={j.money(spent)} sub={`${thisMonth.length} purchases`} />
        <StatCard label="You owe suppliers" value={j.money(owed)} tone="warn" />
        {topFruit && <StatCard label={`${itemsById.get(topFruit)?.name} now`} value={`${j.money(lastCosts.get(topFruit) ?? 0)}`} sub={`per ${itemsById.get(topFruit)?.unit}`} />}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          {list.length === 0 ? (
            <Empty icon={ShoppingBasket} title="No purchases yet" body={items.length ? 'Each time fruit, sugar or bottles are bought, save it here. Stock goes up and recipe costs use the new price.' : 'Add your fruit and packaging in Stock first, or the usual set from Home.'} />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {list.map((p) => {
                const t = purchaseTotals(p, byRef.get(p.id));
                const it = itemsById.get(p.itemId);
                return (
                  <button key={p.id} type="button" className="row" onClick={() => sheets.open({ t: 'purchaseView', id: p.id })}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">
                        {it?.name ?? 'Item'} · {showQty(p.qty)} {it?.unit}
                      </span>
                      <span className="block truncate text-sm text-muted">
                        {showDate(p.date)} · {p.supplierName} · {j.money(p.price)}/{it?.unit}
                        {p.quality ? ` · ${p.quality}` : ''}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="num block font-semibold">{j.money(t.value)}</span>
                      <span className={`text-xs ${t.balance ? 'text-cherry' : 'text-leaf'}`}>{t.balance ? `owe ${j.money(t.balance)}` : 'paid'}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="space-y-4">
          <Card title="Suppliers" action={<Button small variant="plain" icon={Plus} onClick={() => sheets.open({ t: 'supplier' })}>Add</Button>}>
            {suppliers.filter((s) => !s.archived).length === 0 && <p className="text-sm text-muted">Suppliers are added as you buy.</p>}
            <div className="divide-y divide-line">
              {suppliers
                .filter((s) => !s.archived)
                .map((s) => (
                  <button key={s.id} type="button" className="flex w-full items-center gap-3 py-2 text-left" onClick={() => sheets.open({ t: 'supplier', id: s.id })}>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{s.name}</span>
                      <span className="text-xs text-muted">
                        {s.supplies || ''}
                        {s.phone ? ` · ${s.phone}` : ''}
                      </span>
                    </span>
                    {(supplierBal.get(s.id) ?? 0) > 0 && <span className="num text-sm font-semibold text-cherry">{j.money(supplierBal.get(s.id) ?? 0)}</span>}
                  </button>
                ))}
            </div>
          </Card>
          {history.length > 1 && (
            <Card title={`Price of ${itemsById.get(topFruit!)?.name?.toLowerCase()}, last buys`}>
              <div className="flex h-32 items-end gap-1.5">
                {history.map((h) => (
                  <div key={h.id} className="flex flex-1 flex-col items-center justify-end gap-1">
                    <span className="num text-[10px] text-muted">{Math.round(h.price / 100) / 10}k</span>
                    <span className="w-full rounded-t-md bg-accent" style={{ height: `${(h.price / maxP) * 90}px` }} />
                    <span className="text-[10px] text-muted">{showDate(h.date).slice(0, 5)}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">Shows the season: buy more when prices drop, and check juice prices when they rise.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
