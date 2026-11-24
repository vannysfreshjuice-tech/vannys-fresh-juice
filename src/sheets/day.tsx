// Adding a line to the day list: who took juice, how many bottles, and how it is paid.
import { useEffect, useState } from 'react';
import { useJuice } from '../components/bits';
import { Button, Choice, Field, FormError, MoneyInput, QtyInput, Select, Sheet, SheetButtons, TextInput, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDay } from '../lib/dates';
import { nextBottles } from '../lib/juice';
import { mostSold } from '../lib/day';
import { money } from '../lib/money';
import { FROM_ADVANCE, type Customer } from '../lib/types';

const USUAL_KEY = 'vannys.day.usual';

const USUAL_EVENT = 'vannys-usual';

function readSaved(): { productId?: string; size?: string } {
  try {
    return JSON.parse(localStorage.getItem(USUAL_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * The juice and size the day list adds with one tap: the one chosen on this phone (the size chips
 * above the names), else the one sold most in the last 60 days, else the first juice in 500 ml.
 */
export function useUsualJuice() {
  const { products, sales, settings, today } = useData();
  const live = products.filter((p) => !p.archived);
  const [saved, setSaved] = useState(readSaved);
  useEffect(() => {
    const again = () => setSaved(readSaved());
    window.addEventListener(USUAL_EVENT, again);
    return () => window.removeEventListener(USUAL_EVENT, again);
  }, []);
  const top = mostSold(sales, today);
  const productId = [saved.productId, top?.productId, live[0]?.id].find((id) => id && live.some((p) => p.id === id)) ?? '';
  const size = [saved.size, top?.size, '500', settings.sizes[0]?.key].find((k) => k && settings.sizes.some((s) => s.key === k)) ?? '';
  const remember = (p: string, s: string) => {
    localStorage.setItem(USUAL_KEY, JSON.stringify({ productId: p, size: s }));
    window.dispatchEvent(new Event(USUAL_EVENT));
  };
  return { productId, size, remember };
}

const DISCOUNT_KEY = 'vannys.discount';
/** The discount amount last used on this phone (2,000 at first): the switch starts with it. */
export const lastDiscount = () => Number(localStorage.getItem(DISCOUNT_KEY)) || 2000;
export const rememberDiscount = (n: number) => n > 0 && localStorage.setItem(DISCOUNT_KEY, String(n));

/**
 * The Discount switch: off, or on with an amount taken off the sale, the sum shown
 * (3,000 - 2,000 = 1,000), and for a named customer "Always give ... this discount".
 */
export function DiscountControl({ on, setOn, amount, setAmount, total, name, always, setAlways }: { on: boolean; setOn: (v: boolean) => void; amount: number; setAmount: (n: number) => void; total: number; name?: string; always?: boolean; setAlways?: (v: boolean) => void }) {
  const { settings } = useData();
  const cur = (n: number) => money(n, settings.currency);
  return (
    <div className={on ? 'rounded-xl border border-leaf/30 bg-leaf-soft p-3' : 'rounded-xl border border-line bg-card p-3'}>
      <label className="flex min-h-9 items-center gap-3 text-[15px] font-medium">
        <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={on} onChange={(e) => setOn(e.target.checked)} />
        Discount
      </label>
      {on && (
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-[8rem_1fr] items-center gap-3">
            <MoneyInput
              aria-label="Discount"
              value={amount}
              onChange={(n) => {
                setAmount(n);
                rememberDiscount(n);
              }}
            />
            <span className="num text-sm">
              {cur(total)} − {cur(Math.min(amount, total))} = <b>{cur(Math.max(0, total - amount))}</b>
            </span>
          </div>
          {name?.trim() && setAlways && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={!!always} onChange={(e) => setAlways(e.target.checked)} />
              Always give {name.trim()} this discount
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The discount for one sale: starts on, with the customer's standing discount, when they have one;
 * otherwise off with the last amount used. After saving, finishStanding() keeps or stops it for them.
 */
export function useDiscount(known: Customer | undefined) {
  const standing = known?.discount ?? 0;
  const [touched, setTouched] = useState(false);
  const [on, setOnRaw] = useState(false);
  const [amount, setAmountRaw] = useState(lastDiscount);
  const [always, setAlways] = useState(false);
  useEffect(() => {
    if (touched) return;
    setOnRaw(standing > 0);
    if (standing > 0) setAmountRaw(standing);
    setAlways(standing > 0);
    // follow the customer typed until the person changes the discount themselves
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known?.id, standing]);
  return {
    on,
    setOn: (v: boolean) => (setTouched(true), setOnRaw(v)),
    amount,
    setAmount: (n: number) => (setTouched(true), setAmountRaw(n)),
    always,
    setAlways,
    /** what comes off this sale */
    value: on ? amount : 0,
    /** the customer's standing discount after this sale, or null when it does not change */
    nextStanding: (): number | null => {
      if (!on) return null;
      const next = always ? amount : 0;
      return next === standing ? null : next;
    },
  };
}

/** How a tap on the day list is paid: from money paid ahead when the customer has some, otherwise the chosen way. */
export function payFor(ahead: number, chosen: string) {
  return ahead > 0 ? FROM_ADVANCE : chosen;
}

export function DayEntryForm({ date, customerName, onClose }: { date: string; customerName?: string; onClose: () => void }) {
  const { actions, customers, products, settings, customerAdv, fridge } = useData();
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
  // The way of paying follows the customer typed (money paid ahead when they have some) until it is
  // picked by hand; it used to stay on credit, so bottles went on credit beside their money paid ahead.
  const [picked, setMethod] = useState<string | null>(null);
  const chosen = picked ?? (ahead > 0 ? FROM_ADVANCE : 'On credit');
  const method = methods.includes(chosen) ? chosen : 'On credit';
  const disc = useDiscount(known);
  const full = qty * price;
  const total = Math.max(0, full - disc.value);
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
                  await actions.saveSale({ date, lines: [{ productId, size, qty, price }], customerName: name, method, discount: disc.value });
                  const next = disc.nextStanding();
                  if (next !== null) await actions.setCustomerDiscount(name, next);
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
        <p className="rounded-lg bg-page px-3 py-2 text-sm">
          {(() => {
            // which bottles these are: left-over bottles first, then the day's new batch, then none recorded
            let want = qty;
            const parts: string[] = [];
            for (const nb of nextBottles(fridge, productId, size, date)) {
              if (want <= 0) break;
              const take = Math.min(want, nb.left);
              want -= take;
              parts.push(nb.batch.date === date ? `${take} from the new batch (${nb.batch.number})` : `${take} left over from ${showDay(nb.batch.date)} (${nb.batch.number})`);
            }
            if (want > 0) parts.push(`${want} with no bottles recorded`);
            return `These bottles: ${parts.join(', ')}.`;
          })()}
        </p>
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
        <DiscountControl on={disc.on} setOn={disc.setOn} amount={disc.amount} setAmount={disc.setAmount} total={full} name={name} always={disc.always} setAlways={disc.setAlways} />
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
