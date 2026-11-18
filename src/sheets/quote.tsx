// An event quote (wedding, party, meeting): guests and juices in, bottles, fruit, price and profit out.
// Send it on WhatsApp (with the preview) or save it as an order.
import { Send, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, Choice, DateInput, Field, FormError, Line, MoneyInput, QtyInput, Sheet, SheetButtons, TextInput, cx, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, showDay } from '../lib/dates';
import { qty as showQty } from '../lib/money';
import { eventQuote } from '../lib/quote';

export function EventQuoteSheet({ onClose }: { onClose: () => void }) {
  const { products, items, settings, avgCosts, lastCosts, levels, actions, today, customers } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const notify = useNotice();
  const live = products.filter((p) => !p.archived);
  const [event, setEvent] = useState('Wedding');
  const [customer, setCustomer] = useState('');
  const [date, setDate] = useState(addDays(today, 7));
  const [guests, setGuests] = useState(100);
  const [perGuest, setPerGuest] = useState(1);
  const [size, setSize] = useState(settings.sizes.some((s) => s.key === '300') ? '300' : (settings.sizes[0]?.key ?? ''));
  const [picked, setPicked] = useState<string[]>(live.slice(0, 1).map((p) => p.id));
  const [chosenPrice, setPrice] = useState<number | null>(null);
  const price = chosenPrice ?? j.price(picked[0] ?? '', size);
  const [delivery, setDelivery] = useState(0);
  const { busy, error, run } = useSaver();
  const costs = useMemo(() => new Map([...avgCosts, ...lastCosts]), [avgCosts, lastCosts]);
  const q = eventQuote({ guests, perGuest, size, productIds: picked, price, deliveryFee: delivery }, products, items, settings.sizes, costs, levels);
  const cur = j.money;
  const sizeLabel = j.sizeLabel(size);
  const text = [
    `${settings.businessName}: quote for ${event || 'your event'}${customer ? ` (${customer})` : ''}`,
    `${showDay(date)} · ${guests} guests`,
    ...q.perJuice.map((pj) => `${pj.bottles} × ${pj.product.name} ${sizeLabel}`),
    `${q.bottles} bottles × ${cur(price)} = ${cur(q.value)}`,
    ...(delivery ? [`Delivery: ${cur(delivery)}`] : []),
    `Total: ${cur(q.total)}`,
    `Deposit to book: ${cur(q.deposit)}`,
    `Pay: ${settings.cardPay}${settings.airtelNumber ? ` (Airtel Money ${settings.airtelNumber})` : ''}`,
    `WhatsApp & call ${settings.whatsapp}`,
  ].join('\n');
  const toggle = (id: string) => setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : [...ps, id]));
  return (
    <Sheet
      wide
      title="Event quote"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button variant="plain" icon={Truck} busy={busy} disabled={!q.bottles || !q.perJuice.length} onClick={() =>
            run(
              async () => {
                if (!customer.trim()) throw new Error("Type the customer's name to save it as an order.");
                return actions.saveOrder({ customerName: customer, customerType: 'Events', date: today, dueDate: date, lines: q.perJuice.map((pj) => ({ productId: pj.product.id, size, qty: pj.bottles, price })), deliveryFee: delivery, notes: `${event}: ${guests} guests (event quote)` });
              },
              () => {
                notify('Saved as an order');
                onClose();
              },
            )
          }>
            Save as order
          </Button>
          <Button icon={Send} disabled={!q.bottles} onClick={() => sheets.open({ t: 'message', title: 'Event quote', to: customer || undefined, phone: customers.find((c) => c.name.trim().toLowerCase() === customer.trim().toLowerCase())?.phone, text })}>
            Send quote
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Event">
            <TextInput value={event} onChange={(e) => setEvent(e.target.value)} placeholder="Wedding, party, meeting…" />
          </Field>
          <Field label="Customer">
            <TextInput list="quote-customers" value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="Who is it for" />
            <datalist id="quote-customers">
              {customers.filter((c) => !c.archived).map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Day of the event">
            <DateInput value={date} onChange={(v) => v && setDate(v)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Guests">
            <QtyInput value={guests} onChange={(n) => setGuests(Math.max(0, Math.round(n)))} />
          </Field>
          <Field label="Bottles for each guest" hint="e.g. 1, or 1.5 for some to have two">
            <QtyInput value={perGuest} onChange={setPerGuest} />
          </Field>
        </div>
        <div>
          <span className="label">Bottle size</span>
          <Choice options={settings.sizes.map((s) => ({ value: s.key, label: `${s.label} · ${cur(j.price(picked[0] ?? '', s.key)).replace(`${settings.currency} `, '')}` }))} value={size} onChange={(k) => (setSize(k), setPrice(null))} />
        </div>
        <div>
          <span className="label">Juices (the bottles are shared between them)</span>
          {live.length === 0 ? (
            <p className="text-sm text-muted">Add your juices on Recipes and prices first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {live.map((p) => (
                <button key={p.id} type="button" onClick={() => toggle(p.id)} className={cx('chip', picked.includes(p.id) && 'chip-on')}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Event price of one bottle" hint={`Normal price ${cur(j.price(picked[0] ?? '', size))}`}>
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
          <Field label="Delivery charge">
            <MoneyInput value={delivery} onChange={setDelivery} />
          </Field>
        </div>

        <div className="card p-4">
          <p className="text-lg font-semibold">
            {q.bottles} bottles of {sizeLabel} · {showQty(q.litres)} litres
          </p>
          {q.perJuice.length > 1 && <p className="text-sm text-muted">{q.perJuice.map((pj) => `${pj.bottles} ${pj.product.name}`).join(' · ')}</p>}
          <div className="mt-2 divide-y divide-line">
            <Line label={`${q.bottles} × ${cur(price)}`} value={cur(q.value)} />
            {delivery > 0 && <Line label="Delivery" value={cur(delivery)} />}
            <Line strong label="Quote total" value={cur(q.total)} />
            <Line label="Deposit to book (half)" value={cur(q.deposit)} />
            <Line label="What it costs you (juice and bottles)" value={`− ${cur(q.cost)}`} tone="bad" />
            <Line strong label="Profit" value={cur(q.profit)} tone={q.profit >= 0 ? 'good' : 'bad'} />
          </div>
          {q.noRecipe.length > 0 && <p className="mt-2 rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber">{q.noRecipe.join(', ')} {q.noRecipe.length === 1 ? 'has' : 'have'} no recipe, so the fruit and its cost are missing: add the recipe on Recipes and prices.</p>}
          {q.needs.length > 0 && (
            <>
              <p className="mt-3 text-sm font-semibold">Fruit and ingredients needed</p>
              <table className="tbl mt-1">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="n">Need</th>
                    <th className="n">In stock</th>
                    <th className="n">To buy</th>
                  </tr>
                </thead>
                <tbody>
                  {q.needs.map((n) => (
                    <tr key={n.item.id}>
                      <td>{n.item.name}</td>
                      <td className="n num">
                        {showQty(n.need)} {n.item.unit}
                      </td>
                      <td className="n num">{showQty(n.have)}</td>
                      <td className={cx('n num font-semibold', n.short > 0 ? 'text-cherry' : 'text-leaf')}>{n.short > 0 ? showQty(n.short) : 'enough'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
        <p className="text-xs text-muted">Nothing is saved until you tap Save as order. Send quote shows the message first.</p>
      </div>
    </Sheet>
  );
}
