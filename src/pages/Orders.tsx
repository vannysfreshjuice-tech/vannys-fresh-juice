// Orders and deliveries, and Reminders.
import { Bell, CalendarPlus, Check, MessageCircle, Plus, Truck } from 'lucide-react';
import { useState } from 'react';
import { StageBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, Choice, Empty, IconButton, PageHead, StatCard, useNotice } from '../components/ui';
import { useData } from '../data/DataContext';
import { relativeDay, showDay } from '../lib/dates';
import { orderTotals } from '../lib/juice';
import { sum } from '../lib/money';
import { isOpen, whatsappLink } from '../lib/reminders';
import type { Reminder } from '../lib/types';
import { addToCalendar } from '../sheets/people';

const FILTERS = ['Open', 'To make', 'Ready', 'Out for delivery', 'Delivered', 'Unpaid', 'All'] as const;
type Filter = (typeof FILTERS)[number];

export function Orders() {
  const { orders, byRef, customersById, role, today } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const [filter, setFilter] = useState<Filter>('Open');
  const money = role !== 'production';
  const list = orders
    .filter((o) => {
      const t = orderTotals(o, byRef.get(o.id));
      if (filter === 'All') return true;
      if (filter === 'Open') return o.stage !== 'Delivered' && o.stage !== 'Cancelled';
      if (filter === 'Unpaid') return t.balance > 0;
      return o.stage === filter;
    })
    .sort((a, b) => (filter === 'Delivered' || filter === 'All' ? b.dueDate.localeCompare(a.dueDate) : a.dueDate.localeCompare(b.dueDate)));
  const count = (f: Filter) => orders.filter((o) => (f === 'Open' ? o.stage !== 'Delivered' && o.stage !== 'Cancelled' : f === 'Unpaid' ? orderTotals(o, byRef.get(o.id)).balance > 0 : o.stage === f)).length;
  const unpaid = sum(orders, (o) => orderTotals(o, byRef.get(o.id)).balance);
  return (
    <div>
      <PageHead title="Orders and deliveries" action={role !== 'rider' && <Button icon={Plus} onClick={() => sheets.open({ t: 'order' })}>New order</Button>} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="To make" value={String(count('To make'))} />
        <StatCard label="Ready to go" value={String(count('Ready'))} />
        <StatCard label="On the road" value={String(count('Out for delivery'))} />
        {money && <StatCard label="Unpaid on orders" value={j.money(unpaid)} tone="warn" />}
      </div>
      <Choice scroll options={FILTERS.map((f) => ({ value: f, label: f, count: f === 'All' || f === 'Delivered' ? undefined : count(f) }))} value={filter} onChange={setFilter} />
      <div className="mt-3">
        {list.length === 0 ? (
          <Empty icon={Truck} title="No orders here" body={filter === 'Open' ? 'Orders from shops, schools, offices and events show here until they are delivered.' : undefined} />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {list.map((o) => {
              const t = orderTotals(o, byRef.get(o.id));
              const late = o.dueDate < today && o.stage !== 'Delivered' && o.stage !== 'Cancelled';
              return (
                <button key={o.id} type="button" className="row" onClick={() => sheets.open({ t: 'orderView', id: o.id })}>
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-dark">
                    <Truck size={18} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{customersById.get(o.customerId)?.name ?? 'Customer'}</span>
                    <span className="block truncate text-sm text-muted">
                      {o.number} · {o.lines.map(j.lineText).join(', ')}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-sm">
                      <span className={late ? 'font-semibold text-cherry' : 'text-muted'}>
                        {showDay(o.dueDate)} ({relativeDay(o.dueDate, today)})
                      </span>
                      <StageBadge stage={o.stage} />
                    </span>
                  </span>
                  {money && (
                    <span className="text-right">
                      <span className="num block font-semibold">{j.money(t.value)}</span>
                      <span className={`text-xs ${t.balance ? 'text-cherry' : 'text-leaf'}`}>{t.balance ? `owes ${j.money(t.balance)}` : 'paid'}</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function Reminders() {
  const { reminders, ordersById, staffById, actions, today, me, role, settings } = useData();
  const sheets = useSheets();
  const notify = useNotice();
  const open = reminders
    .filter((r) => isOpen(r, ordersById))
    .filter((r) => role === 'owner' || !me || !r.staffId || r.staffId === me.id)
    .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const once = open.filter((r) => !r.repeat);
  const repeating = open.filter((r) => r.repeat);
  const groupOf = (r: Reminder) => (r.date < today ? 'Overdue' : r.date === today ? 'Today' : relativeDay(r.date, today) === 'Tomorrow' ? 'Tomorrow' : showDay(r.date));
  const groups = [...new Set(once.map(groupOf))];
  const row = (r: Reminder) => {
    const who = staffById.get(r.staffId ?? '');
    return (
      <div key={r.id} className="flex items-start gap-3 py-2.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-soft text-purple">
          <Bell size={17} aria-hidden />
        </span>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => sheets.open({ t: 'reminder', id: r.id })}>
          <span className="block font-semibold">{r.what}</span>
          <span className="block text-sm text-muted">
            {r.repeat ? `${r.repeat === 'daily' ? 'Every day' : 'Every week'} at ${r.time}` : r.time} · {who ? `for ${who.name}` : 'for anyone'}
            {r.orderId ? ` · ${ordersById.get(r.orderId)?.number ?? ''}` : ''}
          </span>
        </button>
        <div className="flex shrink-0 gap-1">
          <IconButton icon={CalendarPlus} label="Add to the phone's calendar" onClick={() => addToCalendar(r, who?.name ?? '', settings.businessName)} />
          {who?.phone && <IconButton icon={MessageCircle} label={`Send to ${who.name} on WhatsApp`} onClick={() => window.open(whatsappLink(who.phone, `Reminder for ${showDay(r.date)} ${r.time}: ${r.what}`), '_blank')} />}
          <IconButton
            icon={Check}
            label="Done"
            onClick={async () => {
              await actions.setReminderDone(r.id, true);
              notify('Reminder done');
            }}
          />
        </div>
      </div>
    );
  };
  return (
    <div>
      <PageHead title="Reminders" action={<Button icon={Plus} onClick={() => sheets.open({ t: 'reminder' })}>New reminder</Button>} />
      <p className="mb-4 rounded-2xl bg-purple-soft px-4 py-3 text-sm text-purple">
        A reminder reaches a phone through its <b>calendar</b> (it rings 15 minutes before, even with no internet) or a <b>WhatsApp</b> message to the person it is for. Saving an order makes its own reminders: make the juice the day before, deliver on the day.
      </p>
      {open.length === 0 && <Empty icon={Bell} title="No reminders" body="Reminders you add, and those made by orders, show here." />}
      <div className="grid gap-4 md:grid-cols-2">
        {once.length > 0 && (
          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Coming up</h2>
            {groups.map((g) => (
              <div key={g}>
                <h3 className={`mt-3 text-xs font-bold tracking-wide uppercase ${g === 'Overdue' ? 'text-cherry' : 'text-accent-dark'}`}>{g}</h3>
                <div className="divide-y divide-line">{once.filter((r) => groupOf(r) === g).map(row)}</div>
              </div>
            ))}
          </section>
        )}
        {repeating.length > 0 && (
          <section className="card p-4">
            <h2 className="mb-1 font-semibold">Repeating</h2>
            <div className="divide-y divide-line">{repeating.map(row)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
