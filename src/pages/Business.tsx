// Customers, Expenses, and Staff and wages.
import { ChevronRight, HandCoins, MessageCircle, Plus, ReceiptText, UserRound, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Card, RateBar, share, useViewMode, ViewToggle } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Badge, Bars, Button, Choice, Empty, IconButton, PageHead, SearchBox, Select, StatCard, cx, useNotice } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDate, showDay, weekdayShort } from '../lib/dates';
import { money, sum } from '../lib/money';
import { customerStats, OVERDUE_DAYS, type CustomerStats } from '../lib/performance';
import { wageLines, weekDays } from '../lib/staff';
import { ROLE_NAMES, type Customer } from '../lib/types';

export function Customers() {
  const { customers, customerBal, customerAdv, orders, sales, payments, byRef, settings, today } = useData();
  const sheets = useSheets();
  const [view, setView] = useViewMode('customers', 'cards');
  const [q, setQ] = useState('');
  const [type, setType] = useState('All');
  const [sortBy, setSortBy] = useState<CustomerSort>('Owes most');
  const [asc, setAsc] = useState(false);
  const stats = useMemo(() => customerStats(customers, sales, orders, payments, byRef, today), [customers, sales, orders, payments, byRef, today]);
  const st = (id: string) => stats.get(id)!;
  const types = ['All', ...new Set(customers.filter((c) => !c.archived).map((c) => c.type)), 'Owing', 'Overdue', 'Paid ahead', 'Hidden'];
  const key: Record<CustomerSort, (c: Customer) => number | string> = {
    'Owes most': (c) => st(c.id).owed,
    'Collection rate': (c) => st(c.id).rate,
    Billed: (c) => st(c.id).billed,
    'Bottles a week': (c) => st(c.id).perWeek,
    'Last active': (c) => st(c.id).lastActive,
    Name: (c) => c.name.toLowerCase(),
  };
  const list = customers
    .filter((c) => (type === 'Hidden' ? c.archived : !c.archived))
    .filter((c) => {
      if (type === 'All' || type === 'Hidden') return true;
      if (type === 'Owing') return st(c.id).owed > 0;
      if (type === 'Overdue') return st(c.id).overdue > 0;
      if (type === 'Paid ahead') return st(c.id).ahead > 0;
      return c.type === type;
    })
    .filter((c) => !q.trim() || `${c.name} ${c.place} ${c.phone}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => {
      const ka = key[sortBy](a);
      const kb = key[sortBy](b);
      const d = ka < kb ? -1 : ka > kb ? 1 : 0;
      // Name reads A to Z by default; the figures read biggest first
      return (sortBy === 'Name' ? (asc ? -d : d) : asc ? d : -d) || a.name.localeCompare(b.name);
    });
  const owed = sum([...customerBal.values()], (v) => v);
  const ahead = sum([...customerAdv.values()], (v) => Math.max(0, v));
  const all = [...stats.values()];
  const billed = sum(all, (s) => s.billed);
  const rate = billed > 0 ? (billed - owed) / billed : 1;
  return (
    <div>
      <PageHead title="Customers" action={<Button icon={Plus} onClick={() => sheets.open({ t: 'customer' })}>Customer</Button>} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Customers" value={String(customers.filter((c) => !c.archived).length)} sub={`${all.filter((s) => s.perWeek > 0).length} active in 4 weeks`} />
        <StatCard label="They owe you" value={money(owed, settings.currency)} tone="warn" sub={`${all.filter((s) => s.overdue > 0).length} overdue (${OVERDUE_DAYS}+ days)`} />
        <StatCard label="Collection rate" value={`${Math.round(rate * 100)}%`} sub="of all billed is paid" />
        <StatCard label="Paid ahead" value={money(ahead, settings.currency)} sub="Not used yet" />
      </div>
      <div className="card p-3">
        <SearchBox value={q} onChange={setQ} placeholder="Search customers" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select aria-label="Sort by" options={[...CUSTOMER_SORTS]} value={sortBy} onChange={(e) => setSortBy(e.target.value as CustomerSort)} className="w-auto" />
          <Button small variant="plain" onClick={() => setAsc(!asc)}>
            {sortBy === 'Name' ? (asc ? 'Z to A' : 'A to Z') : asc ? 'Lowest first' : 'Highest first'}
          </Button>
          <span className="flex-1" />
          <ViewToggle value={view} onChange={setView} />
        </div>
        <div className="mt-2">
          <Choice scroll options={types} value={type} onChange={setType} />
        </div>
      </div>
      <div className="mt-3">
        {list.length === 0 ? (
          <Empty icon={Users} title="No customers here" body="Customers are added from the Day list, orders and credit sales, or with the Customer button." />
        ) : view === 'cards' ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((c) => (
              <CustomerCard key={c.id} c={c} s={st(c.id)} />
            ))}
          </div>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {list.map((c) => {
              const s = st(c.id);
              return (
                <button key={c.id} type="button" className="row" onClick={() => sheets.open({ t: 'customerView', id: c.id })}>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 font-semibold">
                      {c.name}
                      {s.overdue > 0 && <Badge tone="red">{s.overdue} overdue</Badge>}
                    </span>
                    <span className="block truncate text-sm text-muted">
                      {c.type}
                      {c.place ? ` · ${c.place}` : ''}
                      {s.times > 0 && (s.times === 1 ? ' · bought once' : ` · bought ${s.times} times`)}
                      {s.billed > 0 && ` · ${Math.round(s.rate * 100)}% paid`}
                    </span>
                    {s.ahead > 0 && <span className="block text-sm font-medium text-leaf">{money(s.ahead, settings.currency)} paid ahead</span>}
                  </span>
                  <span className={cx('num text-right font-semibold', s.owed ? 'text-cherry' : 'text-leaf')}>
                    {money(s.owed, settings.currency)}
                    <span className="block text-xs font-normal text-muted">{s.owed ? 'owes' : 'nothing owed'}</span>
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

const CUSTOMER_SORTS = ['Owes most', 'Collection rate', 'Billed', 'Bottles a week', 'Last active', 'Name'] as const;
type CustomerSort = (typeof CUSTOMER_SORTS)[number];

/** One customer as a card: what was billed, paid and owed, the collection rate, and quick actions. */
function CustomerCard({ c, s }: { c: Customer; s: CustomerStats }) {
  const { settings } = useData();
  const sheets = useSheets();
  const cur = (n: number) => money(n, settings.currency).replace(`${settings.currency} `, '');
  const initials = c.name
    .split(/[\s.(]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const statement = () => sheets.open({ t: 'statementCard', customerId: c.id });
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-sm font-bold text-accent-dark">{initials || '?'}</span>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => sheets.open({ t: 'customerView', id: c.id })}>
          <span className="block truncate font-semibold">{c.name}</span>
          <span className="block truncate text-sm text-muted">
            {s.times === 1 ? 'Bought once' : `Bought ${s.times} times`}
            {s.perWeek > 0 && ` · ${s.perWeek} a week`}
          </span>
        </button>
        {s.overdue > 0 ? <Badge tone="red">{s.overdue} overdue</Badge> : s.ahead > 0 ? <Badge tone="green">Paid ahead</Badge> : s.owed === 0 && s.billed > 0 ? <Badge tone="green">Paid up</Badge> : null}
      </div>
      <div className="num mt-3 grid grid-cols-3 divide-x divide-line border-y border-line py-2 text-center">
        <span>
          <span className="block text-[11px] text-muted">Billed</span>
          <span className="text-sm font-semibold">{cur(s.billed)}</span>
        </span>
        <span>
          <span className="block text-[11px] text-muted">Paid</span>
          <span className="text-sm font-semibold text-sky">{cur(s.paid)}</span>
        </span>
        <span>
          <span className="block text-[11px] text-muted">Owes</span>
          <span className={cx('text-sm font-semibold', s.owed ? 'text-cherry' : 'text-leaf')}>{cur(s.owed)}</span>
        </span>
      </div>
      {s.ahead > 0 && <p className="num mt-2 rounded-lg bg-leaf-soft px-2 py-1 text-center text-sm text-leaf">Paid ahead, not used yet: {cur(s.ahead)}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button small variant="plain" icon={MessageCircle} onClick={statement}>
          Statement
        </Button>
        <Button small icon={HandCoins} onClick={() => sheets.open({ t: 'receive', customerId: c.id })}>
          Money received
        </Button>
      </div>
      <div className="mt-3 flex items-center justify-between text-xs font-semibold tracking-wide text-muted uppercase">
        <span>Collection rate</span>
        <span className={cx('num text-base', s.rate >= 0.85 ? 'text-leaf' : s.rate >= 0.6 ? 'text-orange' : 'text-cherry')}>{Math.round(s.rate * 100)}%</span>
      </div>
      <div className="mt-1">
        <RateBar value={s.rate} />
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted">
        <span className="min-w-0 flex-1 truncate">
          {s.lastActive ? `Last bought ${showDay(s.lastActive)}` : 'Not bought yet'}
          {s.oldestUnpaid && ` · oldest unpaid ${showDay(s.oldestUnpaid)}`}
        </span>
        <IconButton icon={ChevronRight} label={`Open ${c.name}`} onClick={() => sheets.open({ t: 'customerView', id: c.id })} />
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
