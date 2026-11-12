// Home: the day at a glance, and what needs doing.
import { AlertTriangle, Bell, Blend, Boxes, Droplet, Sparkles, Thermometer, Truck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, JuiceBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, StatCard, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, longToday, showDay } from '../lib/dates';
import { fridgeCount, fridgeTotal } from '../lib/juice';
import { qty as showQty, sum } from '../lib/money';
import { mayOpen } from '../lib/nav';
import { isOpen } from '../lib/reminders';
import { dayFigures } from '../lib/reports';
import type { OrderLine } from '../lib/types';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/** What the open orders due by a day need, against what is in the fridge. */
export function makePlan(orders: { stage: string; dueDate: string; lines: OrderLine[] }[], upTo: string) {
  const need = new Map<string, OrderLine>();
  for (const o of orders)
    if (o.stage === 'To make' && o.dueDate <= upTo)
      for (const l of o.lines) {
        const k = `${l.productId}|${l.size}`;
        const prev = need.get(k);
        if (prev) prev.qty += l.qty;
        else need.set(k, { ...l });
      }
  return [...need.values()];
}

interface Alert {
  tone: 'bad' | 'warn' | 'info';
  icon: typeof Bell;
  title: string;
  sub: string;
  action?: ReactNode;
}

export function Home() {
  const d = useData();
  const { role, me, today, settings, products, batches, fridge, items, levels, orders, customerBal, readings, reminders, ordersById, staffById, actions } = d;
  const j = useJuice();
  const sheets = useSheets();
  const navigate = useNavigate();
  const notify = useNotice();
  const starter = useSaver();
  const owner = role === 'owner';
  const counter = role === 'owner' || role === 'sales';
  const day = dayFigures(d, today);
  const madeToday = batches.filter((b) => b.date === today);
  const tomorrow = addDays(today, 1);
  const dueSoon = batches.filter((b) => (fridge.get(b.id)?.total ?? 0) > 0 && b.bestBefore <= tomorrow);
  const dueSoonBottles = sum(dueSoon, (b) => fridge.get(b.id)?.total ?? 0);
  const owed = sum([...customerBal.values()], (v) => v);
  const plan = makePlan(orders, tomorrow);
  const myReminders = reminders.filter((r) => isOpen(r, ordersById) && r.date <= today && (!me || owner || !r.staffId || r.staffId === me.id));

  const alerts: Alert[] = [];
  if (myReminders.length)
    alerts.push({ tone: 'info', icon: Bell, title: `${myReminders.length} reminder${myReminders.length > 1 ? 's' : ''} for today`, sub: myReminders.slice(0, 3).map((r) => `${r.time} ${r.what}${r.staffId && owner ? ` (${staffById.get(r.staffId)?.name ?? ''})` : ''}`).join(' · '), action: <Button small variant="plain" onClick={() => navigate('/reminders')}>Open</Button> });
  if (role !== 'rider') {
    for (const it of items.filter((i) => !i.archived && levels.get(i.id)?.low).slice(0, 4))
      alerts.push({ tone: 'bad', icon: it.kind === 'fruit' ? AlertTriangle : Boxes, title: `${it.name}: ${showQty(levels.get(it.id)?.onHand ?? 0)} ${it.unit} left`, sub: `Below your reorder level of ${showQty(it.reorderLevel)}`, action: mayOpen(role, '/buying') ? <Button small variant="plain" onClick={() => sheets.open({ t: 'purchase', itemId: it.id })}>Buy</Button> : undefined });
    if (dueSoonBottles)
      alerts.push({ tone: 'warn', icon: Droplet, title: `${dueSoonBottles} bottles reach their best-before by tomorrow`, sub: `${dueSoon.map((b) => `${j.name(b.productId)} ${b.number} (${fridge.get(b.id)?.total})`).join(', ')}. Sell these first.`, action: <Button small variant="plain" onClick={() => navigate('/stock')}>See</Button> });
  }
  const notMade = orders.filter((o) => o.stage === 'To make' && o.dueDate <= tomorrow);
  if (notMade.length && role !== 'rider')
    alerts.push({ tone: 'info', icon: Truck, title: `${notMade.length} order${notMade.length > 1 ? 's' : ''} due by tomorrow not yet ready`, sub: notMade.map((o) => `${o.number} ${d.customersById.get(o.customerId)?.name ?? ''} (${showDay(o.dueDate)})`).join(', '), action: <Button small variant="plain" onClick={() => navigate('/orders')}>Open</Button> });
  const toDeliver = orders.filter((o) => (o.stage === 'Ready' || o.stage === 'Out for delivery') && o.dueDate <= today);
  if (toDeliver.length)
    alerts.push({ tone: 'info', icon: Truck, title: `${toDeliver.length} order${toDeliver.length > 1 ? 's' : ''} to deliver today`, sub: toDeliver.map((o) => `${o.number} ${d.customersById.get(o.customerId)?.name ?? ''}`).join(', '), action: <Button small variant="plain" onClick={() => navigate('/orders')}>Open</Button> });
  const todayReadings = readings.filter((r) => r.date === today);
  for (const f of role === 'rider' ? [] : settings.fridges) {
    const last = todayReadings.filter((r) => r.fridge === f).sort((a, b) => b.time.localeCompare(a.time))[0];
    if (last && last.celsius > settings.fridgeMax) alerts.push({ tone: 'bad', icon: Thermometer, title: `${f} read ${last.celsius} °C at ${last.time}`, sub: `Keep juice at 0 to ${settings.fridgeMax} °C.` });
  }
  if (role !== 'rider' && !todayReadings.length && batches.length)
    alerts.push({ tone: 'warn', icon: Thermometer, title: 'No fridge temperature today', sub: 'Read both fridges in the morning.', action: <Button small variant="plain" onClick={() => sheets.open({ t: 'reading' })}>Record</Button> });

  const tone = { bad: 'bg-cherry-soft text-cherry', warn: 'bg-amber-soft text-amber', info: 'bg-purple-soft text-purple' };
  const live = products.filter((p) => !p.archived);

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-4 overflow-hidden rounded-3xl bg-gradient-to-r from-orange via-[#fbb040] to-mango p-5 text-white shadow-lg shadow-orange/30">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold md:text-2xl">
            {greeting()}
            {me ? `, ${me.name}` : ''}
          </h1>
          <p className="text-sm opacity-95">{longToday()}</p>
          {counter ? (
            <>
              <p className="num mt-3 text-3xl font-extrabold">{j.money(day.soldValue)}</p>
              <p className="text-sm opacity-95">
                sold today · {day.bottles} bottles · {day.salesCount} counter sales
              </p>
            </>
          ) : (
            <p className="mt-3 text-2xl font-extrabold">{role === 'rider' ? `${toDeliver.length} to deliver today` : `${madeToday.length} batches today`}</p>
          )}
        </div>
        <img src="./brand/logo.jpg" alt="" className="hidden w-36 rounded-2xl shadow-md sm:block" />
      </section>

      {owner && live.length === 0 && (
        <Card title="Getting started" icon={<Sparkles size={18} className="text-accent-dark" aria-hidden />}>
          <p className="text-[15px] text-muted">The app is empty. Add the usual juices and cocktails with their recipes, the fruit and the bottles in one go, then change anything on Recipes and prices and in Stock.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button busy={starter.busy} onClick={() => starter.run(() => actions.addStarterSet(), () => notify('Added 12 juices, 19 stock items and bottle sizes'))}>
              Add the usual juices, fruit and bottles
            </Button>
            <Button variant="plain" onClick={() => navigate('/staff')}>
              Add the staff
            </Button>
          </div>
          {starter.error && <p className="mt-2 text-sm text-cherry">{starter.error}</p>}
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {counter && <StatCard label="Money in today" value={j.money(day.moneyIn)} sub={`Cash ${j.money(day.cash)} · Mobile ${j.money(day.mobile)}`} />}
        {role !== 'rider' && <StatCard label="Made today" value={`${showQty(sum(madeToday, (b) => b.litres))} L`} sub={`${madeToday.length} batches`} onClick={mayOpen(role, '/make') ? () => navigate('/make') : undefined} />}
        {role !== 'rider' && <StatCard label="Juice in the fridge" value={`${fridgeTotal(fridge)} bottles`} sub={dueSoonBottles ? `${dueSoonBottles} best before tomorrow` : 'All fresh'} onClick={() => navigate('/stock')} />}
        {owner && <StatCard label="Customers owe you" value={j.money(owed)} sub={`${[...customerBal.values()].filter((v) => v > 0).length} customers`} tone="warn" onClick={() => navigate('/customers')} />}
        {role === 'rider' && <StatCard label="Orders to deliver" value={String(toDeliver.length)} sub="today" onClick={() => navigate('/orders')} />}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Needs attention" icon={<AlertTriangle size={18} className="text-cherry" aria-hidden />}>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted">Nothing needs attention. 🍹</p>
          ) : (
            <div className="divide-y divide-line">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone[a.tone]}`}>
                    <a.icon size={18} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{a.title}</span>
                    <span className="block text-sm text-muted">{a.sub}</span>
                  </span>
                  {a.action}
                </div>
              ))}
            </div>
          )}
        </Card>

        {role !== 'rider' && (
          <Card title="What the orders need by tomorrow" icon={<Blend size={18} className="text-accent-dark" aria-hidden />} action={mayOpen(role, '/make') ? <Button small variant="plain" onClick={() => sheets.open({ t: 'batch' })}>New batch</Button> : undefined}>
            {plan.length === 0 ? (
              <p className="text-sm text-muted">No orders waiting to be made by tomorrow.</p>
            ) : (
              <div className="divide-y divide-line">
                {plan.map((l) => {
                  const have = fridgeCount(fridge, l.productId, l.size);
                  const short = Math.max(0, l.qty - have);
                  return (
                    <div key={`${l.productId}|${l.size}`} className="flex items-center gap-3 py-2">
                      <JuiceBadge product={d.productsById.get(l.productId)} size={34} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {j.name(l.productId)} {j.sizeLabel(l.size)}
                        </span>
                        <span className="text-sm text-muted">
                          orders need {l.qty} · {have} in the fridge
                        </span>
                      </span>
                      <span className={`text-sm font-semibold ${short ? 'text-cherry' : 'text-leaf'}`}>{short ? `make ${short}` : 'enough'}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
