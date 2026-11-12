// Customers, expenses, staff and wages, and reminders.
import { CalendarPlus, MessageCircle, Phone, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PayBadge, StageBadge } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, DateInput, Field, FormError, Line, MoneyInput, Select, Sheet, SheetButtons, TextArea, TextInput, cx, useConfirm, useNotice, useSaver } from '../components/ui';
import { giveFile } from '../lib/backup';
import { PinInput, useLock } from '../components/Lock';
import { pinKeys, removePin, setPin } from '../lib/pinLock';
import { useData } from '../data/DataContext';
import { addDays, showDate, showDay } from '../lib/dates';
import { orderTotals, saleTotals } from '../lib/juice';
import { money } from '../lib/money';
import { reminderIcs, whatsappLink } from '../lib/reminders';
import { CUSTOMER_TYPES, ROLES, ROLE_NAMES, type Reminder, type ReminderWay, type Repeat, type Role, type Staff } from '../lib/types';

export function CustomerForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { customers, actions } = useData();
  const notify = useNotice();
  const c = id ? customers.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(c?.name ?? '');
  const [type, setType] = useState(c?.type ?? 'Shop');
  const [phone, setPhone] = useState(c?.phone ?? '');
  const [place, setPlace] = useState(c?.place ?? '');
  const [notes, setNotes] = useState(c?.notes ?? '');
  const { busy, error, run } = useSaver();
  return (
    <Sheet
      title={c ? `Change ${c.name}` : 'New customer'}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.saveCustomer({ name, type, phone, place, notes }, id), () => { notify('Saved'); onClose(); })}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select options={[...CUSTOMER_TYPES]} value={type} onChange={(e) => setType(e.target.value)} />
          </Field>
          <Field label="Phone">
            <TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Field label="Where">
          <TextInput value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Ntinda" />
        </Field>
        <Field label="Notes">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Favourite juices, delivery days..." />
        </Field>
      </div>
    </Sheet>
  );
}

export function CustomerView({ id, onClose }: { id: string; onClose: () => void }) {
  const { customers, orders, sales, byRef, customerBal, actions, settings } = useData();
  const sheets = useSheets();
  const confirm = useConfirm();
  const notify = useNotice();
  const c = customers.find((x) => x.id === id);
  if (!c) return null;
  const os = orders.filter((o) => o.customerId === id).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const credit = sales.filter((s) => s.customerId === id && saleTotals(s, byRef.get(s.id)).balance > 0);
  const owes = customerBal.get(id) ?? 0;
  const statement = [`${settings.businessName}: statement for ${c.name}`, ...os.filter((o) => orderTotals(o, byRef.get(o.id)).balance > 0).map((o) => `${o.number} (${showDate(o.dueDate)}): ${money(orderTotals(o, byRef.get(o.id)).balance, settings.currency)}`), ...credit.map((s) => `${s.number} (${showDate(s.date)}): ${money(saleTotals(s, byRef.get(s.id)).balance, settings.currency)}`), `Total owed: ${money(owes, settings.currency)}`, `Thank you. ${settings.whatsapp}`].join('\n');
  return (
    <Sheet
      title={c.name}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button variant="plain" onClick={() => sheets.open({ t: 'customer', id })}>
            Change
          </Button>
          <Button onClick={() => sheets.swap({ t: 'order', customerName: c.name })}>New order</Button>
        </SheetButtons>
      }
    >
      <p className="text-sm text-muted">
        {c.type} · {c.place || 'place not given'} · {c.phone || 'no phone'}
      </p>
      {c.notes && <p className="mt-2 rounded-xl bg-butter-soft px-3 py-2 text-sm">{c.notes}</p>}
      <div className="mt-3">
        <Line strong label="Owes" value={money(owes, settings.currency)} tone={owes ? 'bad' : 'good'} />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {c.phone && (
          <Button small variant="plain" icon={Phone} onClick={() => window.open(`tel:${c.phone}`)}>
            Call
          </Button>
        )}
        {owes > 0 && (
          <Button small variant="plain" icon={MessageCircle} onClick={() => window.open(whatsappLink(c.phone, statement), '_blank')}>
            Send statement
          </Button>
        )}
        <Button
          small
          variant="plain"
          onClick={async () => {
            if (c.archived) return actions.archiveCustomer(c.id, false);
            if (await confirm({ title: `Hide ${c.name}?`, body: 'Hidden customers leave the list but keep their history.', yes: 'Hide' })) {
              await actions.archiveCustomer(c.id, true);
              onClose();
            }
          }}
        >
          {c.archived ? 'Show again' : 'Hide'}
        </Button>
      </div>
      <h3 className="mt-4 mb-1 text-sm font-semibold">Orders</h3>
      {os.length === 0 && <p className="text-sm text-muted">No orders yet.</p>}
      <div className="divide-y divide-line">
        {os.map((o) => {
          const t = orderTotals(o, byRef.get(o.id));
          return (
            <button key={o.id} type="button" className="flex w-full items-center gap-3 py-2 text-left" onClick={() => sheets.open({ t: 'orderView', id: o.id })}>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{o.number}</span>
                <span className="text-sm text-muted">{showDay(o.dueDate)}</span>
              </span>
              <StageBadge stage={o.stage} />
              <span className="num w-24 text-right">{money(t.value, settings.currency)}</span>
            </button>
          );
        })}
      </div>
      {credit.length > 0 && (
        <>
          <h3 className="mt-4 mb-1 text-sm font-semibold">Sales on credit</h3>
          {credit.map((s) => (
            <button key={s.id} type="button" className="flex w-full items-center gap-3 py-2 text-left" onClick={() => sheets.open({ t: 'saleView', id: s.id })}>
              <span className="flex-1">
                {s.number} · {showDate(s.date)}
              </span>
              <PayBadge status={saleTotals(s, byRef.get(s.id)).status} />
            </button>
          ))}
        </>
      )}
      {!os.length && !credit.length && (
        <Button
          small
          variant="danger"
          icon={Trash2}
          className="mt-3"
          onClick={async () => {
            if (!(await confirm({ title: `Delete ${c.name}?`, yes: 'Delete', danger: true }))) return;
            await actions.deleteCustomer(c.id);
            notify('Customer deleted');
            onClose();
          }}
        >
          Delete
        </Button>
      )}
    </Sheet>
  );
}

export function ExpenseForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { expenses, actions, settings, today } = useData();
  const notify = useNotice();
  const confirm = useConfirm();
  const e0 = id ? expenses.find((x) => x.id === id) : undefined;
  const [description, setDescription] = useState(e0?.description ?? '');
  const [amount, setAmount] = useState(e0?.amount ?? 0);
  const [date, setDate] = useState(e0?.date ?? today);
  const [category, setCategory] = useState(e0?.category ?? settings.expenseGroups[0]);
  const [method, setMethod] = useState(e0?.method ?? settings.methods[0]);
  const { busy, error, run } = useSaver();
  return (
    <Sheet
      title={e0 ? 'Change expense' : 'New expense'}
      onClose={onClose}
      footer={
        <SheetButtons>
          {e0 && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (!(await confirm({ title: 'Delete this expense?', yes: 'Delete', danger: true }))) return;
                await actions.deleteExpense(e0.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button busy={busy} onClick={() => run(() => actions.saveExpense({ description, amount, date, category, method }, id), () => { notify('Saved'); onClose(); })}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Field label="What for">
          <TextInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Gas refill" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Date">
            <DateInput value={date} onChange={setDate} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Group">
            <Select options={settings.expenseGroups} value={category} onChange={(e) => setCategory(e.target.value)} />
          </Field>
          <Field label="Paid by">
            <Select options={settings.methods} value={method} onChange={(e) => setMethod(e.target.value)} />
          </Field>
        </div>
        <p className="text-xs text-muted">Fruit and bottles go under Buying, and wages under Staff, so they are not counted twice.</p>
      </div>
    </Sheet>
  );
}

export function StaffForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { staff, actions } = useData();
  const notify = useNotice();
  const confirm = useConfirm();
  const s = id ? staff.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(s?.name ?? '');
  const [role, setRole] = useState<Role>(s?.role ?? 'production');
  const [job, setJob] = useState(s?.job ?? '');
  const [payKind, setPayKind] = useState<Staff['payKind']>(s?.payKind ?? 'day');
  const [rate, setRate] = useState(s?.rate ?? 0);
  const [phone, setPhone] = useState(s?.phone ?? '');
  const { busy, error, run } = useSaver();
  const lock = useLock();
  return (
    <Sheet
      title={s ? `Change ${s.name}` : 'New person'}
      onClose={onClose}
      footer={
        <SheetButtons>
          {s && (
            <Button
              variant="plain"
              onClick={async () => {
                if (!(await confirm({ title: s.archived ? `Bring ${s.name} back?` : `${s.name} has left?`, body: s.archived ? undefined : 'They leave the staff list. Their attendance and wages stay on the record.', yes: s.archived ? 'Bring back' : 'Has left' }))) return;
                await actions.archiveStaff(s.id, !s.archived);
                if (!s.archived) {
                  removePin(s.id);
                  lock.refresh();
                }
                onClose();
              }}
            >
              {s.archived ? 'Bring back' : 'Has left'}
            </Button>
          )}
          <Button busy={busy} onClick={() => run(() => actions.saveStaff({ name, role, job, payKind, rate, phone }, id), () => { notify('Saved'); onClose(); })}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Part of the app they use" hint="Decides what they can open">
            <Select options={ROLES.map((r) => ({ value: r, label: ROLE_NAMES[r] }))} value={role} onChange={(e) => setRole(e.target.value as Role)} />
          </Field>
          <Field label="Job">
            <TextInput value={job} onChange={(e) => setJob(e.target.value)} placeholder="e.g. Juice maker" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid">
            <Select
              options={[
                { value: 'day', label: 'By the day' },
                { value: 'month', label: 'By the month' },
                { value: 'none', label: 'Not paid a wage' },
              ]}
              value={payKind}
              onChange={(e) => setPayKind(e.target.value as Staff['payKind'])}
            />
          </Field>
          {payKind !== 'none' && (
            <Field label={payKind === 'day' ? 'Pay for a day' : 'Pay for a month'}>
              <MoneyInput value={rate} onChange={setRate} />
            </Field>
          )}
        </div>
        <Field label="Phone (for WhatsApp reminders)">
          <TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        {s && !s.archived && s.role !== 'owner' && <PersonPin staffId={s.id} name={s.name} />}
        {s && s.role === 'owner' && lock.on && <p className="text-xs text-muted">The owner's PIN is set and changed in Settings.</p>}
      </div>
    </Sheet>
  );
}

/** The owner gives a person their own PIN (only once the owner's own PIN is set). */
function PersonPin({ staffId, name }: { staffId: string; name: string }) {
  const lock = useLock();
  const notify = useNotice();
  const [pin, setP] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const has = pinKeys().includes(staffId);
  if (!lock.on) return <p className="rounded-xl bg-butter-soft px-3 py-2 text-sm">To give {name} a PIN, first set your own PIN in Settings &gt; PIN lock.</p>;
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="mb-2 text-sm font-semibold">
        {name}'s PIN {has ? <span className="font-normal text-leaf">(set)</span> : <span className="font-normal text-muted">(not set)</span>}
      </p>
      {err && <p className="mb-2 text-sm text-cherry">{err}</p>}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <PinInput label={has ? 'New PIN' : 'PIN (6 digits)'} value={pin} onChange={setP} />
        </div>
        <Button
          busy={busy}
          onClick={async () => {
            setErr('');
            setBusy(true);
            try {
              await setPin(staffId, pin);
              lock.refresh();
              setP('');
              notify(`${name} can now open the app with that PIN`);
            } catch (e) {
              setErr((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save PIN
        </Button>
      </div>
      {has && (
        <Button
          small
          variant="plain"
          className="mt-2"
          onClick={() => {
            removePin(staffId);
            lock.refresh();
            notify(`${name}'s PIN removed`);
          }}
        >
          Remove PIN
        </Button>
      )}
      <p className="mt-2 text-xs text-muted">Tell {name} the PIN yourself. It opens only {name}'s part of the app.</p>
    </div>
  );
}

export function WageForm({ staffId, kind, amount, onClose }: { staffId?: string; kind?: 'wage' | 'advance'; amount?: number; onClose: () => void }) {
  const { staff, actions, settings, today } = useData();
  const notify = useNotice();
  const paid = staff.filter((s) => !s.archived && s.payKind !== 'none');
  const [sid, setSid] = useState(staffId ?? paid[0]?.id ?? '');
  const [k, setK] = useState<'wage' | 'advance'>(kind ?? 'wage');
  const [amt, setAmt] = useState(amount ?? 0);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(settings.methods[0]);
  const { busy, error, run } = useSaver();
  return (
    <Sheet
      title={k === 'advance' ? 'Advance' : 'Pay wages'}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.saveWage({ staffId: sid, kind: k, amount: amt, date, method }), () => { notify('Saved'); onClose(); })}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Field label="Person">
          <Select options={paid.map((s) => ({ value: s.id, label: s.name }))} value={sid} onChange={(e) => setSid(e.target.value)} />
        </Field>
        <Field label="This is">
          <Select options={[{ value: 'wage', label: 'Wages' }, { value: 'advance', label: 'An advance (taken off the next wages)' }]} value={k} onChange={(e) => setK(e.target.value as 'wage' | 'advance')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <MoneyInput value={amt} onChange={setAmt} />
          </Field>
          <Field label="Date">
            <DateInput value={date} onChange={setDate} />
          </Field>
        </div>
        <Field label="Paid by">
          <Select options={settings.methods} value={method} onChange={(e) => setMethod(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

/** Downloads the calendar file for a reminder (the phone opens it in its calendar). */
export async function addToCalendar(r: Reminder, who: string, businessName: string) {
  await giveFile(`reminder-${r.date}.ics`, reminderIcs(r, who, businessName), 'text/calendar');
}

export function ReminderForm({ id, orderId, onClose }: { id?: string; orderId?: string; onClose: () => void }) {
  const { reminders, staff, staffById, actions, today, ordersById, customersById, settings, me } = useData();
  const notify = useNotice();
  const r0 = id ? reminders.find((x) => x.id === id) : undefined;
  const o = orderId ? ordersById.get(orderId) : undefined;
  const people = staff.filter((s) => !s.archived);
  const [what, setWhat] = useState(r0?.what ?? (o ? `${o.number} for ${customersById.get(o.customerId)?.name ?? ''}: ` : ''));
  const [date, setDate] = useState(r0?.date ?? (o ? addDays(o.dueDate, -1) : addDays(today, 1)));
  const [time, setTime] = useState(r0?.time ?? '06:00');
  const [sid, setSid] = useState(r0?.staffId ?? me?.id ?? people[0]?.id ?? '');
  const [repeat, setRepeat] = useState<Repeat>(r0?.repeat ?? '');
  const [ways, setWays] = useState<ReminderWay[]>(r0?.ways ?? ['calendar']);
  const { busy, error, run } = useSaver();
  const toggle = (w: ReminderWay, on: boolean) => setWays((ws) => (on ? [...new Set([...ws, w])] : ws.filter((x) => x !== w)));
  const save = () =>
    run(async () => {
      const rid = await actions.saveReminder({ what, date, time, staffId: sid, orderId: r0?.orderId ?? orderId ?? '', repeat, ways }, id);
      const saved: Reminder = { id: rid, what, date, time, staffId: sid, orderId, repeat, ways, createdAt: 0, updatedAt: 0 };
      const who = staffById.get(sid);
      if (ways.includes('calendar')) await addToCalendar(saved, who?.name ?? '', settings.businessName);
      if (ways.includes('whatsapp') && who?.phone) window.open(whatsappLink(who.phone, `Reminder for ${showDay(date)} ${time}: ${what}`), '_blank');
      notify(ways.includes('calendar') ? 'Saved. Open the calendar file to add it to the phone.' : 'Reminder saved');
      onClose();
    });
  return (
    <Sheet
      title={r0 ? 'Change reminder' : 'New reminder'}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} icon={CalendarPlus} onClick={save}>
            Save reminder
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Field label="Remind about">
          <TextArea rows={2} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Make 40 × Mango 500 ml for Kato" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day">
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label="Time">
            <input type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="For">
            <Select options={people.length ? people.map((s) => ({ value: s.id, label: s.name })) : [{ value: '', label: 'Anyone' }]} value={sid} onChange={(e) => setSid(e.target.value)} />
          </Field>
          <Field label="Repeat">
            <Select
              options={[
                { value: '', label: 'Once' },
                { value: 'daily', label: 'Every day' },
                { value: 'weekly', label: 'Every week' },
              ]}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as Repeat)}
            />
          </Field>
        </div>
        <div>
          <span className="label">How it reaches the phone</span>
          <div className="card divide-y divide-line px-3">
            <label className="flex min-h-11 items-center gap-3 py-1 text-[15px]">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={ways.includes('calendar')} onChange={(e) => toggle('calendar', e.target.checked)} />
              The phone's calendar (rings 15 minutes before)
            </label>
            <label className={cx('flex min-h-11 items-center gap-3 py-1 text-[15px]', !staffById.get(sid)?.phone && 'text-muted')}>
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={ways.includes('whatsapp')} onChange={(e) => toggle('whatsapp', e.target.checked)} />
              WhatsApp message to {staffById.get(sid)?.name ?? 'the person'}
              {!staffById.get(sid)?.phone && ' (add their phone in Staff)'}
            </label>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
