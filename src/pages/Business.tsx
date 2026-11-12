// Customers, Expenses, and Staff and wages.
import { Plus, ReceiptText, UserRound, Users } from 'lucide-react';
import { useState } from 'react';
import { Card, share } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Bars, Button, Choice, Empty, PageHead, SearchBox, StatCard, cx, useNotice } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDate, weekdayShort } from '../lib/dates';
import { money, sum } from '../lib/money';
import { wageLines, weekDays } from '../lib/staff';
import { ROLE_NAMES } from '../lib/types';

export function Customers() {
  const { customers, customerBal, orders, settings } = useData();
  const sheets = useSheets();
  const [q, setQ] = useState('');
  const [type, setType] = useState('All');
  const types = ['All', ...new Set(customers.filter((c) => !c.archived).map((c) => c.type)), 'Owing', 'Hidden'];
  const list = customers
    .filter((c) => (type === 'Hidden' ? c.archived : !c.archived))
    .filter((c) => type === 'All' || type === 'Hidden' || (type === 'Owing' ? (customerBal.get(c.id) ?? 0) > 0 : c.type === type))
    .filter((c) => !q.trim() || `${c.name} ${c.place} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (customerBal.get(b.id) ?? 0) - (customerBal.get(a.id) ?? 0) || a.name.localeCompare(b.name));
  const owed = sum([...customerBal.values()], (v) => v);
  return (
    <div>
      <PageHead title="Customers" action={<Button icon={Plus} onClick={() => sheets.open({ t: 'customer' })}>Customer</Button>} />
      <div className="mb-3 grid grid-cols-2 gap-3">
        <StatCard label="Customers" value={String(customers.filter((c) => !c.archived).length)} />
        <StatCard label="They owe you" value={money(owed, settings.currency)} tone="warn" />
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Search customers" />
      <div className="mt-3">
        <Choice scroll options={types} value={type} onChange={setType} />
      </div>
      <div className="mt-3">
        {list.length === 0 ? (
          <Empty icon={Users} title="No customers here" body="Customers are added from orders and credit sales, or with the Customer button." />
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {list.map((c) => {
              const b = customerBal.get(c.id) ?? 0;
              return (
                <button key={c.id} type="button" className="row" onClick={() => sheets.open({ t: 'customerView', id: c.id })}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{c.name}</span>
                    <span className="block truncate text-sm text-muted">
                      {c.type}
                      {c.place ? ` · ${c.place}` : ''} · {orders.filter((o) => o.customerId === c.id).length} orders
                    </span>
                  </span>
                  <span className={cx('num text-right font-semibold', b ? 'text-cherry' : 'text-leaf')}>
                    {money(b, settings.currency)}
                    <span className="block text-xs font-normal text-muted">{b ? 'owes' : 'nothing owed'}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function Expenses() {
  const { expenses, settings, today } = useData();
  const sheets = useSheets();
  const month = today.slice(0, 7);
  const thisMonth = expenses.filter((e) => e.date.slice(0, 7) === month);
  const total = sum(thisMonth, (e) => e.amount);
  const groups = [...new Set(thisMonth.map((e) => e.category))].map((g) => ({ label: g, amount: sum(thisMonth.filter((e) => e.category === g), (e) => e.amount) })).sort((a, b) => b.amount - a.amount);
  const list = [...expenses].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return (
    <div>
      <PageHead title="Expenses" action={<Button icon={Plus} onClick={() => sheets.open({ t: 'expense' })}>Expense</Button>} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`This month · ${money(total, settings.currency)}`}>
          {groups.length ? <Bars currency={settings.currency} rows={groups.map((g) => ({ ...g, share: share(g.amount, total) }))} /> : <p className="text-sm text-muted">No expenses this month.</p>}
          <p className="mt-3 text-xs text-muted">Running costs only: fruit and bottles are under Buying, wages under Staff.</p>
        </Card>
        <div>
          {list.length === 0 ? (
            <Empty icon={ReceiptText} title="No expenses yet" body="Rent, power, water, gas, transport, repairs, cleaning, market dues." />
          ) : (
            <div className="card divide-y divide-line overflow-hidden">
              {list.map((e) => (
                <button key={e.id} type="button" className="row" onClick={() => sheets.open({ t: 'expense', id: e.id })}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{e.description}</span>
                    <span className="text-sm text-muted">
                      {showDate(e.date)} · {e.category} · {e.method}
                    </span>
                  </span>
                  <span className="num font-semibold">{money(e.amount, settings.currency)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function StaffPage() {
  const { staff, attendance, wages, today, actions, settings, staffById } = useData();
  const sheets = useSheets();
  const notify = useNotice();
  const lines = wageLines(staff, attendance, wages, today);
  const days = weekDays(today);
  const recent = [...wages].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 10);
  const cycle = async (staffId: string, date: string, now: boolean | undefined) => {
    if (date > today) return notify('That day has not come yet', 'info');
    await actions.setAttendance(staffId, date, now === undefined ? true : now ? false : null);
  };
  return (
    <div>
      <PageHead title="Staff and wages" action={<Button icon={Plus} onClick={() => sheets.open({ t: 'staff' })}>Person</Button>} />
      <p className="mb-4 rounded-2xl bg-purple-soft px-4 py-3 text-sm text-purple">
        Tap a day to mark it: once for present (green), again for absent (red), again to clear. Day workers are owed the days present times their day rate, less advances and wages already paid this week. Each person's "part of the app" decides what they can open.
      </p>
      {lines.length === 0 ? (
        <Empty icon={UserRound} title="No staff yet" body="Add everyone who works at Vanny's, the owner too, and choose the part of the app each one uses." action={<Button icon={Plus} onClick={() => sheets.open({ t: 'staff' })}>Add a person</Button>} />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {lines.map((l) => (
            <div key={l.staff.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button type="button" className="min-w-40 flex-1 text-left" onClick={() => sheets.open({ t: 'staff', id: l.staff.id })}>
                <span className="block font-semibold">{l.staff.name}</span>
                <span className="text-sm text-muted">
                  {l.staff.job || ROLE_NAMES[l.staff.role]} · {l.staff.payKind === 'day' ? `${money(l.staff.rate, settings.currency)} a day` : l.staff.payKind === 'month' ? `${money(l.staff.rate, settings.currency)} a month` : 'no wage'}
                </span>
              </button>
              <div className="flex gap-1">
                {days.map((d, i) => {
                  const v = l.week[i];
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-label={`${weekdayShort(d)} ${showDate(d)}: ${v === true ? 'present' : v === false ? 'absent' : 'not marked'}`}
                      onClick={() => cycle(l.staff.id, d, v)}
                      className={cx('h-9 w-9 rounded-lg text-[11px] font-bold', v === true ? 'bg-leaf-soft text-leaf' : v === false ? 'bg-cherry-soft text-cherry' : 'bg-line text-muted', d === today && 'ring-2 ring-accent')}
                    >
                      {weekdayShort(d).slice(0, 2)}
                    </button>
                  );
                })}
              </div>
              {l.staff.payKind !== 'none' && (
                <div className="flex items-center gap-2">
                  <span className="text-right">
                    <span className="num block font-semibold">{money(l.due, settings.currency)}</span>
                    <span className="text-xs text-muted">due {l.period}</span>
                  </span>
                  <Button small variant="plain" onClick={() => sheets.open({ t: 'wage', staffId: l.staff.id, kind: 'wage', amount: l.due })}>
                    Pay
                  </Button>
                  <Button small variant="plain" onClick={() => sheets.open({ t: 'wage', staffId: l.staff.id, kind: 'advance' })}>
                    Advance
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <Card title="Wages and advances paid" className="mt-4">
          <div className="divide-y divide-line">
            {recent.map((w) => (
              <div key={w.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-20 text-muted">{showDate(w.date)}</span>
                <span className="flex-1">
                  {staffById.get(w.staffId)?.name} · {w.kind === 'advance' ? 'advance' : 'wages'}
                </span>
                <span className="num">{money(w.amount, settings.currency)}</span>
                <button
                  type="button"
                  className="text-xs text-cherry underline"
                  onClick={async () => {
                    await actions.deleteWage(w.id);
                    notify('Removed');
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
      {staff.some((s) => s.archived) && (
        <p className="mt-3 text-sm text-muted">
          Have left:{' '}
          {staff
            .filter((s) => s.archived)
            .map((s) => (
              <button key={s.id} type="button" className="mr-2 underline" onClick={() => sheets.open({ t: 'staff', id: s.id })}>
                {s.name}
              </button>
            ))}
        </p>
      )}
    </div>
  );
}
