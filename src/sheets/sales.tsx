// Taking payment for a counter sale, the receipt, a past sale, and recording a payment.
import { Check, MessageCircle, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { JuiceBadge, PayBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, Choice, DateInput, Field, FormError, Line, MoneyInput, Select, Sheet, SheetButtons, TextInput, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDate, showDay } from '../lib/dates';
import { linesValue, orderTotals, purchaseTotals, saleTotals } from '../lib/juice';
import { fmt, money } from '../lib/money';
import { FROM_ADVANCE, type OrderLine, type PaymentKind } from '../lib/types';
import { DiscountControl, useDiscount } from './day';

export function Checkout({ lines, onDone, onClose }: { lines: OrderLine[]; onDone: () => void; onClose: () => void }) {
  const { actions, customers, settings, customerAdv } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const [customer, setCustomer] = useState('');
  const known = customers.find((c) => c.name.trim().toLowerCase() === customer.trim().toLowerCase());
  const ahead = known ? (customerAdv.get(known.id) ?? 0) : 0;
  const methods = [...settings.methods.filter((m) => m !== 'Bank'), 'On credit', ...(ahead > 0 ? [FROM_ADVANCE] : [])];
  const [chosen, setMethod] = useState(settings.methods[0]);
  const method = methods.includes(chosen) ? chosen : methods[0];
  const [received, setReceived] = useState(0);
  const [empties, setEmpties] = useState(0);
  const { busy, error, run } = useSaver();
  const disc = useDiscount(known);
  const full = linesValue(lines);
  const total = Math.max(0, full - disc.value);
  const listId = 'checkout-customers';
  return (
    <Sheet
      title="Take payment"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            icon={Check}
            busy={busy}
            onClick={() =>
              run(async () => {
                const id = await actions.saveSale({ lines, customerName: customer, method, received, emptiesBack: empties, discount: disc.value });
                const next = customer.trim() ? disc.nextStanding() : null;
                if (next !== null) await actions.setCustomerDiscount(customer, next);
                onDone();
                sheets.swap({ t: 'receipt', id });
              })
            }
          >
            Complete sale
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="card mb-4 divide-y divide-line px-4">
        {lines.map((l) => (
          <div key={`${l.productId}|${l.size}`} className="flex items-center justify-between gap-3 py-2 text-[15px]">
            <span>{j.lineText(l)}</span>
            <span className="num">{j.money(l.qty * l.price)}</span>
          </div>
        ))}
        {disc.value > 0 && (
          <div className="flex items-center justify-between py-2 text-[15px] text-leaf">
            <span>Discount</span>
            <span className="num">− {j.money(Math.min(disc.value, full))}</span>
          </div>
        )}
        <div className="flex items-center justify-between py-2 text-lg font-semibold">
          <span>Total</span>
          <span className="num">{j.money(total)}</span>
        </div>
      </div>
      <div className="space-y-4">
        <Field label="Customer" hint="Leave blank for a walk-in customer. A new name is added to Customers.">
          <TextInput list={listId} value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Walk-in" />
          <datalist id={listId}>
            {customers.filter((c) => !c.archived).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </Field>
        <DiscountControl on={disc.on} setOn={disc.setOn} amount={disc.amount} setAmount={disc.setAmount} total={full} name={customer} always={disc.always} setAlways={disc.setAlways} />
        <div>
          <span className="label">Paid by</span>
          <Choice options={methods} value={method} onChange={setMethod} />
        </div>
        {method === 'Cash' && (
          <Field label="Cash received">
            <MoneyInput value={received} onChange={setReceived} placeholder={fmt(total)} />
            {received > 0 && <span className="mt-1 block text-[15px]">Change to give: <b className="num">{money(Math.max(0, received - total), settings.currency)}</b></span>}
          </Field>
        )}
        {method === 'On credit' && <p className="rounded-xl bg-butter-soft px-3 py-2 text-sm">The amount goes on the customer's account and shows on Customers until it is paid.</p>}
        {ahead > 0 && (
          <p className="rounded-xl bg-leaf-soft px-3 py-2 text-sm">
            {known!.name} has <b className="num">{money(ahead, settings.currency)}</b> paid ahead.
            {method === FROM_ADVANCE && (ahead >= total ? ` After this sale: ${money(ahead - total, settings.currency)}.` : ` That covers ${money(ahead, settings.currency)}; the other ${money(total - ahead, settings.currency)} stays owed.`)}
          </p>
        )}
        <Field label="Empty bottles brought back" hint={settings.bottleDeposit ? `Deposit ${money(settings.bottleDeposit, settings.currency)} a bottle` : undefined}>
          <TextInput inputMode="numeric" value={empties ? String(empties) : ''} onChange={(e) => setEmpties(Number(e.target.value.replace(/\D/g, '')) || 0)} placeholder="0" />
        </Field>
      </div>
    </Sheet>
  );
}

export function Receipt({ id, onClose }: { id: string; onClose: () => void }) {
  const { sales, settings, customersById } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const s = sales.find((x) => x.id === id);
  if (!s) return null;
  const total = linesValue(s.lines);
  // Bottles of one juice and size may come from two batches, or be split by a discount: one line each,
  // at the price before any discount, then the discount.
  const merged = new Map<string, OrderLine & { value: number }>();
  for (const l of s.lines) {
    const k = `${l.productId}|${l.size}`;
    const before = l.qty * (l.fullPrice ?? l.price);
    const prev = merged.get(k);
    if (prev) {
      prev.qty += l.qty;
      prev.value += before;
    } else merged.set(k, { ...l, value: before });
  }
  const off = (s.discount ?? 0) || Math.max(0, [...merged.values()].reduce((t, l) => t + l.value, 0) - total);
  const text = [
    `${settings.businessName}`,
    `Receipt ${s.number} · ${showDate(s.date)} ${s.time}`,
    ...[...merged.values()].map((l) => `${j.lineText(l)}: ${j.money(l.value)}`),
    ...(off ? [`Discount: − ${j.money(off)}`] : []),
    `Total: ${j.money(total)} (${s.method})`,
    settings.receiptNote,
  ].join(String.fromCharCode(10));
  const phone = s.customerId ? customersById.get(s.customerId)?.phone : '';
  return (
    <Sheet
      title="Sale done"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button variant="plain" icon={MessageCircle} onClick={() => sheets.open({ t: 'message', title: `Receipt ${s.number}`, to: s.customerName, phone, text })}>
            WhatsApp
          </Button>
          <Button onClick={onClose}>Next sale</Button>
        </SheetButtons>
      }
    >
      <div className="text-center">
        <img src="./brand/logo.jpg" alt={settings.businessName} className="mx-auto w-48" />
        <p className="mt-1 text-sm text-muted">
          Receipt {s.number} · {showDate(s.date)} {s.time}
        </p>
      </div>
      <div className="mt-3 divide-y divide-line">
        {[...merged.values()].map((l) => (
          <Line key={`${l.productId}|${l.size}`} label={j.lineText(l)} value={j.money(l.value)} />
        ))}
        {off > 0 && <Line label="Discount" value={`− ${j.money(off)}`} tone="good" />}
        <Line strong label={`Total · ${s.method}`} value={j.money(total)} />
      </div>
      <p className="mt-3 text-center text-sm text-muted">{settings.receiptNote}</p>
      <p className="text-center text-sm text-muted">Orders on WhatsApp: {settings.whatsapp}</p>
    </Sheet>
  );
}

export function SaleView({ id, onClose }: { id: string; onClose: () => void }) {
  const { sales, byRef, actions, batches } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const confirm = useConfirm();
  const notify = useNotice();
  const s = sales.find((x) => x.id === id);
  if (!s) return null;
  const t = saleTotals(s, byRef.get(s.id));
  return (
    <Sheet
      title={`Sale ${s.number}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            variant="danger"
            icon={Undo2}
            onClick={async () => {
              if (!(await confirm({ title: 'Undo this sale?', body: s.customerId ? `The bottles go back into the fridge. Money paid with the sale is taken off; money paid from money paid ahead goes back to it; money ${s.customerName} paid later is kept as money paid ahead.` : 'The bottles go back into the fridge and the money is taken off.', yes: 'Undo sale', danger: true }))) return;
              await actions.deleteSale(s.id);
              notify('Sale undone');
              onClose();
            }}
          >
            Undo sale
          </Button>
          {!s.opening && (
            <Button variant="soft" onClick={() => sheets.open({ t: 'saleChange', id: s.id })}>
              Change
            </Button>
          )}
          {t.balance > 0 && <Button onClick={() => sheets.open({ t: 'payment', kind: 'sale', refId: s.id })}>Record payment</Button>}
        </SheetButtons>
      }
    >
      <p className="mb-2 text-sm text-muted">
        {showDate(s.date)} {s.time} · {s.customerName || 'Walk-in'} · {s.method}
      </p>
      <div className="divide-y divide-line">
        {s.lines.map((l, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              {j.lineText(l)}
              <span className="block text-xs text-muted">
                {(() => {
                  const b = batches.find((x) => x.id === l.batchId);
                  if (!b) return 'No bottles recorded for it';
                  return b.date === s.date ? `From the new batch ${b.number} (made that day)` : `Left-over bottles from ${showDay(b.date)} (${b.number})`;
                })()}
              </span>
            </span>
            <span className="num">{j.money(l.qty * l.price)}</span>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <Line strong label="Total" value={j.money(t.value)} />
        <Line label="Paid" value={j.money(t.paid)} tone="good" />
        {t.balance > 0 && <Line strong label="Balance" value={j.money(t.balance)} tone="bad" />}
      </div>
      <div className="mt-2">
        <PayBadge status={t.status} />
      </div>
    </Sheet>
  );
}

/** Bottles tapped as the wrong juice on a day: all of them become the juice they really were. */
export function SoldAsForm({ productId, size, date, qty, onClose }: { productId: string; size: string; date: string; qty: number; onClose: () => void }) {
  const { products, batches, actions } = useData();
  const j = useJuice();
  const notify = useNotice();
  // juices made that day or before with that size: the likely ones first
  const made = [...new Set(batches.filter((b) => b.date <= date && (b.filled?.[size] ?? 0) > 0).sort((a, b) => b.date.localeCompare(a.date)).map((b) => b.productId))];
  const choices = [...made, ...products.filter((p) => !p.archived && !made.includes(p.id)).map((p) => p.id)].filter((x) => x !== productId);
  const [to, setTo] = useState(choices[0] ?? '');
  const { busy, error, run } = useSaver();
  return (
    <Sheet
      title="Tapped as the wrong juice?"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} disabled={!to} onClick={() => run(() => actions.changeSoldJuice(date, productId, size, to), (n) => (notify(`${n} bottles changed to ${j.name(to)}`), onClose()))}>
            Change them to {j.name(to)}
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <p className="mb-3 text-[15px]">
        On {showDate(date)}, <b>{qty}</b> bottles were recorded as <b>{j.name(productId)} {j.sizeLabel(size)}</b> with no bottles of it made. If they were really another juice, choose it: every {j.name(productId)} {j.sizeLabel(size)} sold that day changes, and they come off the bottles of that juice made that day or before.
      </p>
      <Field label="They were really">
        <Select options={choices.map((id) => ({ value: id, label: `${j.name(id)}${made.includes(id) ? ' (made by then)' : ''}` }))} value={to} onChange={(e) => setTo(e.target.value)} />
      </Field>
    </Sheet>
  );
}

/** Changing a sale already recorded: its day, the customer and the price of each bottle. */
export function SaleChangeForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { sales, customers, actions, today, products, settings } = useData();
  const notify = useNotice();
  const s = sales.find((x) => x.id === id);
  const [date, setDate] = useState(s?.date ?? today);
  const [who, setWho] = useState(s?.customerId ? s.customerName : '');
  const [lines, setLines] = useState(s?.lines.map((l) => ({ productId: l.productId, size: l.size, qty: l.qty, price: l.price })) ?? []);
  const set = (i: number, patch: Partial<(typeof lines)[number]>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const juices = products.filter((p) => !p.archived || lines.some((l) => l.productId === p.id));
  const { busy, error, run } = useSaver();
  if (!s) return null;
  return (
    <Sheet
      title={`Change sale ${s.number}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.updateSale(s.id, { date, customerName: who, lines }), () => (notify('Sale changed'), onClose()))}>
            Save changes
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Day of the sale">
            <DateInput value={date} max={today} onChange={(v) => v && setDate(v)} />
          </Field>
          <Field label="Customer" hint="Empty for a walk-in; a new name is added">
            <TextInput list="sale-change-customers" value={who} onChange={(e) => setWho(e.target.value)} />
            <datalist id="sale-change-customers">
              {customers.filter((c) => !c.archived).map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
        </div>
        <div>
          <span className="label">What was sold</span>
          <div className="card divide-y divide-line px-3">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 py-2 sm:grid-cols-[1fr_7rem_4.5rem_7rem]">
                <Select aria-label="Juice" options={juices.map((p) => ({ value: p.id, label: p.name }))} value={l.productId} onChange={(e) => set(i, { productId: e.target.value })} />
                <Select aria-label="Size" options={settings.sizes.map((z) => ({ value: z.key, label: z.label }))} value={l.size} onChange={(e) => set(i, { size: e.target.value })} />
                <TextInput aria-label="Bottles" inputMode="numeric" className="num text-right" value={String(l.qty || '')} onChange={(e) => set(i, { qty: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                <MoneyInput aria-label="Price of one bottle" value={l.price} onChange={(n) => set(i, { price: n })} />
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Juice, size, number of bottles and the price of one bottle. Bottles changed here are matched to the bottles made that day or before. To remove the sale: Undo sale.</p>
        </div>
      </div>
    </Sheet>
  );
}

export function PaymentForm({ kind, refId, onClose }: { kind: PaymentKind; refId: string; onClose: () => void }) {
  const { actions, orders, sales, purchases, byRef, settings, today, customersById } = useData();
  const order = kind === 'order' ? orders.find((o) => o.id === refId) : undefined;
  const sale = kind === 'sale' ? sales.find((s) => s.id === refId) : undefined;
  const purchase = kind === 'purchase' ? purchases.find((p) => p.id === refId) : undefined;
  const balance = order ? orderTotals(order, byRef.get(refId)).balance : sale ? saleTotals(sale, byRef.get(refId)).balance : purchase ? purchaseTotals(purchase, byRef.get(refId)).balance : 0;
  const [amount, setAmount] = useState(balance);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(settings.methods[0]);
  const { busy, error, run } = useSaver();
  const notify = useNotice();
  const title = order ? `Payment for ${order.number}` : sale ? `Payment for ${sale.number}` : 'Pay the supplier';
  const who = order ? customersById.get(order.customerId)?.name : sale ? sale.customerName : purchase?.supplierName;
  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            busy={busy}
            onClick={() =>
              run(
                () => actions.addPayment(kind, refId, { amount, date, method }),
                () => {
                  notify('Payment recorded');
                  onClose();
                },
              )
            }
          >
            Save payment
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <p className="mb-3 text-[15px]">
        {who} · balance <b className="num">{money(balance, settings.currency)}</b>
      </p>
      <div className="space-y-4">
        <Field label="Amount">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid by">
            <Select options={settings.methods} value={method} onChange={(e) => setMethod(e.target.value)} />
          </Field>
          <Field label="Date">
            <DateInput value={date} onChange={setDate} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

/**
 * Money from a customer as one amount: pays what they owe, oldest first; anything over is kept as
 * money paid ahead. fromAdvance: uses their money paid ahead to pay what they owe.
 */
export function ReceiveForm({ customerId: givenId, fromAdvance, onClose }: { customerId?: string; fromAdvance?: boolean; onClose: () => void }) {
  const { actions, customers, customersById, customerBal, customerAdv, settings, today } = useData();
  // Opened from the Day list there is no customer yet: type the name (a new name becomes a customer).
  const [name, setName] = useState('');
  const typed = !givenId ? customers.find((x) => !x.archived && x.name.trim().toLowerCase() === name.trim().toLowerCase()) : undefined;
  const customerId = givenId ?? typed?.id ?? '';
  const c = customerId ? customersById.get(customerId) : undefined;
  const owes = customerBal.get(customerId) ?? 0;
  const ahead = customerAdv.get(customerId) ?? 0;
  const [chosenAmount, setAmount] = useState<number | null>(null);
  const amount = chosenAmount ?? (fromAdvance ? Math.min(owes, ahead) : owes);
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState(settings.methods[0]);
  const { busy, error, run } = useSaver();
  const notify = useNotice();
  if (givenId && !c) return null;
  const cur = (n: number) => money(n, settings.currency);
  const over = fromAdvance ? 0 : Math.max(0, amount - owes);
  const who = c?.name ?? name.trim();
  return (
    <Sheet
      title={fromAdvance ? 'Use money paid ahead' : givenId ? `Money from ${who}` : 'Money received'}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            busy={busy}
            onClick={() =>
              run(
                async () => {
                  if (!who) throw new Error("Type the customer's name.");
                  const id = customerId || (await actions.saveCustomer({ name: who, type: 'Person' }));
                  return actions.receiveMoney(id, { amount, date, method: fromAdvance ? FROM_ADVANCE : method });
                },
                (r) => {
                  notify(r.kept ? (r.paid ? `${cur(r.paid)} paid what they owed; ${cur(r.kept)} kept as paid ahead` : `${cur(r.kept)} kept as paid ahead`) : `${cur(r.paid)} paid`);
                  onClose();
                },
              )
            }
          >
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      {!givenId && (
        <Field label="From whom" hint="A new name is added to Customers." className="mb-3">
          <TextInput list="receive-customers" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          <datalist id="receive-customers">
            {customers.filter((x) => !x.archived).map((x) => (
              <option key={x.id} value={x.name} />
            ))}
          </datalist>
        </Field>
      )}
      <div className="mb-3 divide-y divide-line">
        <Line label="Owes" value={cur(owes)} tone={owes ? 'bad' : 'good'} />
        <Line label="Paid ahead" value={cur(ahead)} tone={ahead ? 'good' : 'muted'} />
      </div>
      <div className="space-y-4">
        <Field label="Amount">
          <MoneyInput value={amount} onChange={setAmount} />
        </Field>
        <div className={fromAdvance ? '' : 'grid grid-cols-2 gap-3'}>
          {!fromAdvance && (
            <Field label="Paid by">
              <Select options={settings.methods} value={method} onChange={(e) => setMethod(e.target.value)} />
            </Field>
          )}
          <Field label="Date">
            <DateInput value={date} onChange={setDate} />
          </Field>
        </div>
        <p className="rounded-xl bg-sky-soft px-3 py-2 text-sm">
          {fromAdvance
            ? 'This pays what they owe, oldest day first, from the money they paid ahead. No new money comes in.'
            : owes > 0
              ? `This pays what they owe, oldest day first.${over ? ` The extra ${cur(over)} is kept as money paid ahead, and their next bottles can come out of it.` : ''}`
              : 'They owe nothing, so all of it is kept as money paid ahead. Their next bottles can come out of it.'}
        </p>
      </div>
    </Sheet>
  );
}

export function SaleLineBadges({ lines }: { lines: OrderLine[] }) {
  const { productsById } = useData();
  const ids = [...new Set(lines.map((l) => l.productId))].slice(0, 3);
  return (
    <span className="flex -space-x-2">
      {ids.map((id) => (
        <JuiceBadge key={id} product={productsById.get(id)} size={30} />
      ))}
    </span>
  );
}
