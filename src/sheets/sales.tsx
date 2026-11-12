// Taking payment for a counter sale, the receipt, a past sale, and recording a payment.
import { Check, MessageCircle, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { JuiceBadge, PayBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, Choice, DateInput, Field, FormError, Line, MoneyInput, Select, Sheet, SheetButtons, TextInput, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDate } from '../lib/dates';
import { linesValue, orderTotals, purchaseTotals, saleTotals } from '../lib/juice';
import { fmt, money } from '../lib/money';
import { whatsappLink } from '../lib/reminders';
import type { OrderLine, PaymentKind } from '../lib/types';

export function Checkout({ lines, onDone, onClose }: { lines: OrderLine[]; onDone: () => void; onClose: () => void }) {
  const { actions, customers, settings } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const [customer, setCustomer] = useState('');
  const methods = [...settings.methods.filter((m) => m !== 'Bank'), 'On credit'];
  const [method, setMethod] = useState(methods[0]);
  const [received, setReceived] = useState(0);
  const [empties, setEmpties] = useState(0);
  const { busy, error, run } = useSaver();
  const total = linesValue(lines);
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
                const id = await actions.saveSale({ lines, customerName: customer, method, received, emptiesBack: empties });
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
  const s = sales.find((x) => x.id === id);
  if (!s) return null;
  const total = linesValue(s.lines);
  // Bottles of one juice and size may come from two batches: show them as one line.
  const merged = new Map<string, OrderLine>();
  for (const l of s.lines) {
    const k = `${l.productId}|${l.size}`;
    const prev = merged.get(k);
    if (prev) prev.qty += l.qty;
    else merged.set(k, { ...l });
  }
  const text = [`${settings.businessName}`, `Receipt ${s.number} · ${showDate(s.date)} ${s.time}`, ...[...merged.values()].map((l) => `${j.lineText(l)}: ${j.money(l.qty * l.price)}`), `Total: ${j.money(total)} (${s.method})`, settings.receiptNote].join('\n');
  const phone = s.customerId ? customersById.get(s.customerId)?.phone : '';
  return (
    <Sheet
      title="Sale done"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button variant="plain" icon={MessageCircle} onClick={() => window.open(whatsappLink(phone, text), '_blank')}>
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
          <Line key={`${l.productId}|${l.size}`} label={j.lineText(l)} value={j.money(l.qty * l.price)} />
        ))}
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
  const batchNo = (bid?: string) => batches.find((b) => b.id === bid)?.number ?? '';
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
              if (!(await confirm({ title: 'Undo this sale?', body: 'The bottles go back into the fridge and the money is taken off.', yes: 'Undo sale', danger: true }))) return;
              await actions.deleteSale(s.id);
              notify('Sale undone');
              onClose();
            }}
          >
            Undo sale
          </Button>
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
              <span className="block text-xs text-muted">from batch {batchNo(l.batchId)}</span>
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
