// Adding a line to the day list: who took juice, how many bottles, and how it is paid.
import { useState } from 'react';
import { useJuice } from '../components/bits';
import { Button, Choice, Field, FormError, MoneyInput, QtyInput, Select, Sheet, SheetButtons, TextInput, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDay } from '../lib/dates';
import { money } from '../lib/money';
import { FROM_ADVANCE } from '../lib/types';

const USUAL_KEY = 'vannys.day.usual';

/** The juice and size the day list adds with one tap: the last one chosen on this phone, else the most sold. */
export function useUsualJuice() {
  const { products, sales, settings } = useData();
  const live = products.filter((p) => !p.archived);
  let saved: { productId?: string; size?: string } = {};
  try {
    saved = JSON.parse(localStorage.getItem(USUAL_KEY) ?? '{}');
  } catch {
    saved = {};
  }
  const lastSold = [...sales].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0]?.lines[0];
  const productId = [saved.productId, lastSold?.productId, live[0]?.id].find((id) => id && live.some((p) => p.id === id)) ?? '';
  const size = [saved.size, lastSold?.size, '500', settings.sizes[0]?.key].find((k) => k && settings.sizes.some((s) => s.key === k)) ?? '';
  const remember = (p: string, s: string) => localStorage.setItem(USUAL_KEY, JSON.stringify({ productId: p, size: s }));
  return { productId, size, remember };
}

/** How a tap on the day list is paid: from money paid ahead when the customer has some, otherwise the chosen way. */
export function payFor(ahead: number, chosen: string) {
  return ahead > 0 ? FROM_ADVANCE : chosen;
}

export function DayEntryForm({ date, customerName, onClose }: { date: string; customerName?: string; onClose: () => void }) {
  const { actions, customers, products, settings, customerAdv } = useData();
  const j = useJuice();
  const usual = useUsualJuice();
  const notify = useNotice();
  const live = products.filter((p) => !p.archived);
  const [name, setName] = useState(customerName ?? '');
  const [qty, setQty] = useState(1);
  const [chosenProduct, setProductId] = useState(usual.productId);
  const [chosenSize, setSize] = useState(usual.size);
  const productId = live.some((p) => p.id === chosenProduct) ? chosenProduct : usual.productId;
  const size = settings.sizes.some((s) => s.key === chosenSize) ? chosenSize : usual.size;
  const [price, setPrice] = useState(j.price(usual.productId, usual.size));
  const known = customers.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const ahead = known ? (customerAdv.get(known.id) ?? 0) : 0;
  const methods = ['On credit', ...settings.methods.filter((m) => m !== 'Bank'), ...(ahead > 0 ? [FROM_ADVANCE] : [])];
  const [chosen, setMethod] = useState(ahead > 0 ? FROM_ADVANCE : 'On credit');
  const method = methods.includes(chosen) ? chosen : 'On credit';
  const total = qty * price;
  const { busy, error, run } = useSaver();
  const listId = 'day-customers';
  return (
    <Sheet
      title={`Juice on ${showDay(date)}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            busy={busy}
            onClick={() =>
              run(
                async () => {
                  if (!name.trim()) throw new Error("Type the customer's name.");
                  await actions.saveSale({ date, lines: [{ productId, size, qty, price }], customerName: name, method });
                  usual.remember(productId, size);
                },
                () => {
                  notify(`${name.trim()} added`);
                  onClose();
                },
              )
            }
          >
            Add to the day
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Field label="Who took juice" hint="A new name is added to Customers.">
          <TextInput list={listId} value={name} onChange={(e) => setName(e.target.value)} autoFocus={!customerName} />
          <datalist id={listId}>
            {customers.filter((c) => !c.archived).map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Bottles">
            <QtyInput value={qty} onChange={(n) => setQty(Math.max(1, Math.round(n)))} />
          </Field>
          <Field label="Price of one" hint="Change it for a different price, e.g. 5,000.">
            <MoneyInput value={price} onChange={setPrice} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Juice">
            <Select
              options={live.map((p) => ({ value: p.id, label: p.name }))}
              value={productId}
              onChange={(e) => {
                setProductId(e.target.value);
                setPrice(j.price(e.target.value, size));
              }}
            />
          </Field>
          <Field label="Size">
            <Select
              options={settings.sizes.map((s) => ({ value: s.key, label: s.label }))}
              value={size}
              onChange={(e) => {
                setSize(e.target.value);
                setPrice(j.price(productId, e.target.value));
              }}
            />
          </Field>
        </div>
        <div>
          <span className="label">Paid</span>
          <Choice options={methods.map((m) => ({ value: m, label: m === 'On credit' ? 'Not yet (on credit)' : m }))} value={method} onChange={setMethod} />
        </div>
        <p className="rounded-xl bg-butter-soft px-3 py-2 text-sm">
          Total <b className="num">{money(total, settings.currency)}</b>
          {ahead > 0 && (
            <>
              {' '}
              · {known!.name} has <b className="num">{money(ahead, settings.currency)}</b> paid ahead
              {method === FROM_ADVANCE && total > ahead && <>; the other {money(total - ahead, settings.currency)} stays owed</>}
            </>
          )}
        </p>
      </div>
    </Sheet>
  );
}
