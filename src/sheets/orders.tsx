// Orders from shops, schools, offices and events: the form and the order's own window.
import { Bell, MessageCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { JuiceBadge, PayBadge, StageBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, DateInput, Field, FormError, IconButton, Line, MoneyInput, Select, Sheet, SheetButtons, TextArea, TextInput, cx, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, showDay } from '../lib/dates';
import { fridgeCount, orderTotals, orderValue } from '../lib/juice';
import { whatsappLink } from '../lib/reminders';
import { CUSTOMER_TYPES, ORDER_STAGES, type OrderLine, type OrderStage, type Reminder } from '../lib/types';

const STEPS: OrderStage[] = ['To make', 'Ready', 'Out for delivery', 'Delivered'];

export function OrderForm({ id, customerName, onClose }: { id?: string; customerName?: string; onClose: () => void }) {
  const { actions, orders, customers, customersById, products, settings, today, staff, fridge } = useData();
  const j = useJuice();
  const notify = useNotice();
  const o = id ? orders.find((x) => x.id === id) : undefined;
  const live = products.filter((p) => !p.archived);
  const [name, setName] = useState(o ? (customersById.get(o.customerId)?.name ?? '') : (customerName ?? ''));
  const [type, setType] = useState('Shop');
  const [phone, setPhone] = useState('');
  const [dueDate, setDueDate] = useState(o?.dueDate ?? addDays(today, 1));
  const [dueTime, setDueTime] = useState(o?.dueTime ?? '');
  const riders = staff.filter((s) => !s.archived && s.role === 'rider').map((s) => s.name);
  const [rider, setRider] = useState(o?.rider ?? riders[0] ?? 'Customer collects');
  const [place, setPlace] = useState(o?.place ?? '');
  const firstProduct = live[0]?.id ?? '';
  const firstSize = settings.sizes[1]?.key ?? settings.sizes[0]?.key ?? '';
  const [lines, setLines] = useState<OrderLine[]>(o?.lines.map((l) => ({ ...l })) ?? [{ productId: firstProduct, size: firstSize, qty: 0, price: j.price(firstProduct, firstSize) }]);
  const [fee, setFee] = useState(o?.deliveryFee ?? 0);
  const [deposit, setDeposit] = useState(0);
  const [method, setMethod] = useState(settings.methods[0]);
  const [notes, setNotes] = useState(o?.notes ?? '');
  const maker = staff.find((s) => !s.archived && s.role === 'production');
  const riderStaff = staff.find((s) => !s.archived && s.role === 'rider' && s.name === rider);
  const owner = staff.find((s) => !s.archived && s.role === 'owner');
  const [remMake, setRemMake] = useState(true);
  const [remDeliver, setRemDeliver] = useState(true);
  const [remCollect, setRemCollect] = useState(false);
  const { busy, error, run } = useSaver();
  const known = customers.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const setLine = (i: number, patch: Partial<OrderLine>) =>
    setLines((ls) =>
      ls.map((l, n) => {
        if (n !== i) return l;
        const next = { ...l, ...patch };
        if (patch.productId !== undefined || patch.size !== undefined) next.price = j.price(next.productId, next.size);
        return next;
      }),
    );
  const total = orderValue({ lines, deliveryFee: fee });

  const save = () =>
    run(async () => {
      const what = lines.filter((l) => l.qty > 0).map(j.lineText).join(', ');
      const reminders: Omit<Reminder, 'id' | 'createdAt' | 'updatedAt' | 'orderId'>[] = [];
      if (!id) {
        if (remMake) reminders.push({ date: addDays(dueDate, -1), time: '06:00', what: `Make ${what} for ${name.trim()}`, staffId: maker?.id ?? '', repeat: '', ways: ['calendar'] });
        if (remDeliver && rider !== 'Customer collects') reminders.push({ date: dueDate, time: '07:00', what: `Deliver ${what} to ${name.trim()}${place ? `, ${place}` : ''}`, staffId: riderStaff?.id ?? '', repeat: '', ways: ['calendar', 'whatsapp'] });
        if (remCollect) reminders.push({ date: dueDate, time: dueTime || '17:00', what: `Collect the balance from ${name.trim()}`, staffId: owner?.id ?? '', repeat: '', ways: ['calendar'] });
      }
      await actions.saveOrder({ customerName: name, customerType: type, phone, date: o?.date ?? today, dueDate, dueTime, rider, place, lines, deliveryFee: fee, notes }, id, { amount: deposit, method }, reminders);
      notify(id ? 'Order changed' : reminders.length ? `Order saved with ${reminders.length} reminder${reminders.length > 1 ? 's' : ''}` : 'Order saved');
      onClose();
    });

  return (
    <Sheet
      wide
      title={o ? `Change ${o.number}` : 'New order'}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={save}>
            Save order · {j.money(total)}
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Field label="Customer">
          <TextInput list="order-customers" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop, school, office..." />
          <datalist id="order-customers">
            {customers.filter((c) => !c.archived).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </Field>
        {!o && name.trim() && !known && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type of customer">
              <Select options={[...CUSTOMER_TYPES]} value={type} onChange={(e) => setType(e.target.value)} />
            </Field>
            <Field label="Phone">
              <TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Deliver on">
            <DateInput value={dueDate} onChange={setDueDate} />
          </Field>
          <Field label="Time (optional)">
            <input type="time" className="input" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rider">
            <Select options={[...riders, 'Customer collects']} value={rider} onChange={(e) => setRider(e.target.value)} />
          </Field>
          <Field label="Where">
            <TextInput value={place} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. Ntinda" />
          </Field>
        </div>

        <div>
          <span className="label">What they want</span>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="card p-2.5">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Select options={live.map((p) => ({ value: p.id, label: `${p.icon} ${p.name}` }))} value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })} />
                  <IconButton icon={X} label="Remove this line" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))} disabled={lines.length === 1} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Select options={settings.sizes.map((s) => ({ value: s.key, label: s.label }))} value={l.size} onChange={(e) => setLine(i, { size: e.target.value })} />
                  <TextInput inputMode="numeric" aria-label="How many" placeholder="How many" value={l.qty ? String(l.qty) : ''} onChange={(e) => setLine(i, { qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} className="num text-right" />
                  <MoneyInput aria-label="Price each" value={l.price} onChange={(n) => setLine(i, { price: n })} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {fridgeCount(fridge, l.productId, l.size)} in the fridge now · {j.money(l.qty * l.price)}
                </p>
              </div>
            ))}
          </div>
          <Button small variant="soft" icon={Plus} className="mt-2" onClick={() => setLines((ls) => [...ls, { productId: firstProduct, size: firstSize, qty: 0, price: j.price(firstProduct, firstSize) }])}>
            Add a line
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Delivery charge">
            <MoneyInput value={fee} onChange={setFee} />
          </Field>
          {!o && (
            <Field label="Deposit paid now">
              <MoneyInput value={deposit} onChange={setDeposit} />
            </Field>
          )}
        </div>
        {!o && deposit > 0 && (
          <Field label="Deposit paid by">
            <Select options={settings.methods} value={method} onChange={(e) => setMethod(e.target.value)} />
          </Field>
        )}
        <Field label="Notes">
          <TextArea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {!o && (
          <div>
            <span className="label">Reminders</span>
            <div className="card divide-y divide-line px-3">
              <Check on={remMake} set={setRemMake} text={`Remind ${maker?.name ?? 'production'} to make it the day before at 6:00 am`} />
              {rider !== 'Customer collects' && <Check on={remDeliver} set={setRemDeliver} text={`Remind ${rider} on the delivery morning at 7:00 am`} />}
              <Check on={remCollect} set={setRemCollect} text="Remind me to collect the balance on the delivery day" />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Check({ on, set, text }: { on: boolean; set: (v: boolean) => void; text: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 py-1 text-[15px]">
      <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={on} onChange={(e) => set(e.target.checked)} />
      {text}
    </label>
  );
}

export function OrderView({ id, onClose }: { id: string; onClose: () => void }) {
  const { orders, byRef, customersById, actions, role, productsById, settings, reminders, staffById } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const confirm = useConfirm();
  const notify = useNotice();
  const [err, setErr] = useState('');
  const o = orders.find((x) => x.id === id);
  if (!o) return null;
  const c = customersById.get(o.customerId);
  const t = orderTotals(o, byRef.get(o.id));
  const step = STEPS.indexOf(o.stage);
  const next = o.stage === 'Cancelled' ? undefined : STEPS[step + 1];
  const owner = role === 'owner' || role === 'sales';
  const mine = reminders.filter((r) => r.orderId === o.id && !r.done);
  const move = async (stage: OrderStage) => {
    setErr('');
    try {
      await actions.setOrderStage(o.id, stage);
      notify(`${o.number}: ${stage}`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const note = [`${settings.businessName}: delivery note ${o.number}`, `For ${c?.name ?? ''}${o.place ? `, ${o.place}` : ''}`, ...o.lines.map((l) => `${j.lineText(l)}: ${j.money(l.qty * l.price)}`), o.deliveryFee ? `Delivery: ${j.money(o.deliveryFee)}` : '', `Total: ${j.money(t.value)}`, t.paid ? `Paid: ${j.money(t.paid)}` : '', t.balance ? `Balance: ${j.money(t.balance)}` : ''].filter(Boolean).join('\n');
  return (
    <Sheet
      wide
      title={`${o.number} · ${c?.name ?? ''}`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap gap-2 [&>*]:flex-1">
          {next && (
            <Button onClick={() => move(next)} disabled={role === 'rider' && next === 'Ready'}>
              Mark {next.toLowerCase()}
            </Button>
          )}
          {t.balance > 0 && (owner || role === 'rider') && (
            <Button variant="soft" onClick={() => sheets.open({ t: 'payment', kind: 'order', refId: o.id })}>
              Record payment
            </Button>
          )}
        </div>
      }
    >
      <FormError message={err} />
      {o.stage === 'Cancelled' ? (
        <p className="mb-3">
          <StageBadge stage="Cancelled" />
        </p>
      ) : (
        <div className="mb-4 flex gap-1">
          {STEPS.map((s, i) => (
            <div key={s} className={cx('flex-1 text-center text-[11px] font-semibold', i < step ? 'text-leaf' : i === step ? 'text-accent-dark' : 'text-faint')}>
              <span className={cx('mb-1 block h-1.5 rounded-full', i < step ? 'bg-leaf' : i === step ? 'bg-accent' : 'bg-line')} />
              {s}
            </div>
          ))}
        </div>
      )}
      <div className="divide-y divide-line">
        {o.lines.map((l) => (
          <div key={`${l.productId}|${l.size}`} className="flex items-center gap-3 py-2">
            <JuiceBadge product={productsById.get(l.productId)} size={34} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{j.name(l.productId)}</span>
              <span className="text-sm text-muted">
                {l.qty} × {j.sizeLabel(l.size)} at {j.money(l.price)}
              </span>
            </span>
            {owner && <span className="num">{j.money(l.qty * l.price)}</span>}
          </div>
        ))}
      </div>
      {(owner || role === 'rider') && (
        <div className="mt-2">
          {o.deliveryFee ? <Line label="Delivery" value={j.money(o.deliveryFee)} /> : null}
          <Line strong label="Order value" value={j.money(t.value)} />
          <Line label="Paid" value={j.money(t.paid)} tone="good" />
          <Line strong label={role === 'rider' ? 'To collect' : 'Balance'} value={j.money(t.balance)} tone={t.balance ? 'bad' : undefined} />
          <div className="mt-1">
            <PayBadge status={t.status} />
          </div>
        </div>
      )}
      <p className="mt-3 text-sm text-muted">
        Deliver {showDay(o.dueDate)}
        {o.dueTime ? ` at ${o.dueTime}` : ''} · {o.place || c?.place || 'place not given'} · {c?.phone || 'no phone'} · {o.rider || 'no rider'}
      </p>
      {o.packed && o.packed.length > 0 && <p className="mt-1 text-sm text-muted">Packed from the fridge: {o.packed.map((l) => `${l.qty} × ${j.sizeLabel(l.size)}`).join(', ')}</p>}
      {o.notes && <p className="mt-2 rounded-xl bg-butter-soft px-3 py-2 text-sm">{o.notes}</p>}
      {mine.length > 0 && (
        <div className="mt-3">
          <span className="label">Reminders for this order</span>
          {mine.map((r) => (
            <p key={r.id} className="text-sm">
              <Bell size={13} className="mr-1 inline text-purple" aria-hidden />
              {showDay(r.date)} {r.time} · {staffById.get(r.staffId ?? '')?.name ?? 'anyone'}: {r.what}
            </p>
          ))}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button small variant="plain" icon={MessageCircle} onClick={() => window.open(whatsappLink(c?.phone, note), '_blank')}>
          Delivery note
        </Button>
        <Button small variant="plain" icon={Bell} onClick={() => sheets.open({ t: 'reminder', orderId: o.id })}>
          Remind me
        </Button>
        {owner && o.stage === 'To make' && (
          <Button small variant="plain" icon={Pencil} onClick={() => sheets.open({ t: 'order', id: o.id })}>
            Change
          </Button>
        )}
        {owner && o.stage !== 'To make' && o.stage !== 'Delivered' && o.stage !== 'Cancelled' && (
          <Button small variant="plain" onClick={() => move('To make')}>
            Back to To make
          </Button>
        )}
        {owner && o.stage !== 'Cancelled' && o.stage !== 'Delivered' && (
          <Button
            small
            variant="plain"
            onClick={async () => {
              if (await confirm({ title: 'Cancel this order?', body: 'Packed bottles go back into the fridge. Payments stay on the record.', yes: 'Cancel order', danger: true })) await move('Cancelled');
            }}
          >
            Cancel order
          </Button>
        )}
        {role === 'owner' && (
          <Button
            small
            variant="danger"
            icon={Trash2}
            onClick={async () => {
              if (!(await confirm({ title: `Delete ${o.number}?`, body: 'The order, its payments and its reminders are removed for good. To keep the history, use Cancel order instead.', yes: 'Delete', danger: true }))) return;
              await actions.deleteOrder(o.id);
              notify('Order deleted');
              onClose();
            }}
          >
            Delete
          </Button>
        )}
      </div>
    </Sheet>
  );
}

export { ORDER_STAGES };
