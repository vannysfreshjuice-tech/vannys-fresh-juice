// Fruit and packaging: an item, a stock count, buying, a purchase, a supplier, and fridge temperatures.
import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PayBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, Choice, DateInput, Field, FormError, Line, MoneyInput, QtyInput, Select, Sheet, SheetButtons, TextInput, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { showDate } from '../lib/dates';
import { purchaseTotals } from '../lib/juice';
import { money, qty as showQty } from '../lib/money';
import { QUALITIES, type ItemKind } from '../lib/types';

const UNITS = ['kg', 'pcs', 'bunches', 'litres', 'bags', 'boxes', 'trays'];

export function ItemForm({ id, kind, onClose }: { id?: string; kind?: ItemKind; onClose: () => void }) {
  const { items, actions } = useData();
  const notify = useNotice();
  const confirm = useConfirm();
  const it = id ? items.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(it?.name ?? '');
  const [k, setK] = useState<ItemKind>(it?.kind ?? kind ?? 'fruit');
  const [unit, setUnit] = useState(it?.unit ?? (k === 'packaging' ? 'pcs' : 'kg'));
  const [reorder, setReorder] = useState(it?.reorderLevel ?? 0);
  const { busy, error, run } = useSaver();
  return (
    <Sheet
      title={it ? `Change ${it.name}` : 'New stock item'}
      onClose={onClose}
      footer={
        <SheetButtons>
          {it && (
            <Button
              variant="plain"
              onClick={async () => {
                if (!(await confirm({ title: it.archived ? `Show ${it.name} again?` : `Hide ${it.name}?`, yes: it.archived ? 'Show' : 'Hide' }))) return;
                await actions.archiveItem(it.id, !it.archived);
                onClose();
              }}
            >
              {it.archived ? 'Show again' : 'Hide'}
            </Button>
          )}
          <Button busy={busy} onClick={() => run(() => actions.saveItem({ name, kind: k, unit, reorderLevel: reorder }, id), () => { notify('Saved'); onClose(); })}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Choice options={[{ value: 'fruit' as ItemKind, label: 'Fruit and ingredients' }, { value: 'packaging' as ItemKind, label: 'Packaging' }]} value={k} onChange={setK} />
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={k === 'fruit' ? 'e.g. Mangoes' : 'e.g. Bottles 500 ml'} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Counted in">
            <Select options={UNITS.includes(unit) ? UNITS : [unit, ...UNITS]} value={unit} onChange={(e) => setUnit(e.target.value)} />
          </Field>
          <Field label="Reorder when below" hint="Shows as low on Home">
            <QtyInput value={reorder} onChange={setReorder} />
          </Field>
        </div>
      </div>
    </Sheet>
  );
}

export function CountForm({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { itemsById, levels, actions } = useData();
  const notify = useNotice();
  const it = itemsById.get(itemId);
  const onRecord = levels.get(itemId)?.onHand ?? 0;
  const [counted, setCounted] = useState(onRecord);
  const [reason, setReason] = useState('Count');
  const { busy, error, run } = useSaver();
  if (!it) return null;
  return (
    <Sheet
      title={`Count ${it.name}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.saveCount(itemId, counted, onRecord, reason), () => { notify('Stock corrected'); onClose(); })}>
            Save the count
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <p className="mb-3 text-[15px]">
        The records say <b>{showQty(onRecord)} {it.unit}</b>.
      </p>
      <div className="space-y-4">
        <Field label={`Counted (${it.unit})`}>
          <QtyInput value={counted} onChange={setCounted} />
        </Field>
        <Field label="Why it is different">
          <Select options={['Count', 'Rotten, thrown away', 'Lost', 'Used for samples', 'Found']} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}

export function PurchaseForm({ itemId, onClose }: { itemId?: string; onClose: () => void }) {
  const { items, suppliers, actions, today, settings, lastCosts } = useData();
  const notify = useNotice();
  const live = items.filter((i) => !i.archived);
  const [iid, setIid] = useState(itemId ?? live[0]?.id ?? '');
  const it = live.find((i) => i.id === iid);
  const [supplier, setSupplier] = useState('');
  const [q, setQ] = useState(0);
  const [price, setPrice] = useState(lastCosts.get(iid) ?? 0);
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState(settings.methods[0]);
  const [quality, setQuality] = useState<string>('Good');
  const [date, setDate] = useState(today);
  const { busy, error, run } = useSaver();
  const total = Math.round(q * price);
  return (
    <Sheet
      title="Buy fruit or supplies"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.savePurchase({ date, supplierName: supplier, itemId: iid, qty: q, price, quality }, { amount: paid, method }), () => { notify('Purchase saved: stock is up'); onClose(); })}>
            Save purchase
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      {!live.length ? (
        <p className="text-muted">Add the fruit and packaging you buy first, in Stock.</p>
      ) : (
        <div className="space-y-4">
          <Field label="What was bought">
            <Select
              options={live.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))}
              value={iid}
              onChange={(e) => {
                setIid(e.target.value);
                setPrice(lastCosts.get(e.target.value) ?? 0);
              }}
            />
          </Field>
          <Field label="Supplier" hint="A new name is added to Suppliers">
            <TextInput list="purchase-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Mama Rose (Owino)" />
            <datalist id="purchase-suppliers">
              {suppliers.filter((s) => !s.archived).map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Quantity (${it?.unit ?? ''})`}>
              <QtyInput value={q} onChange={setQ} />
            </Field>
            <Field label={`Price per ${it?.unit ?? 'unit'}`}>
              <MoneyInput value={price} onChange={setPrice} />
            </Field>
          </div>
          <p className="text-[15px]">
            Total: <b className="num">{money(total, settings.currency)}</b>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid now" hint="Leave at 0 if on credit">
              <MoneyInput value={paid} onChange={setPaid} />
            </Field>
            <Field label="Paid by">
              <Select options={settings.methods} value={method} onChange={(e) => setMethod(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {it?.kind === 'fruit' && (
              <Field label="Quality">
                <Select options={[...QUALITIES]} value={quality} onChange={(e) => setQuality(e.target.value)} />
              </Field>
            )}
            <Field label="Date">
              <DateInput value={date} onChange={setDate} />
            </Field>
          </div>
          {total > 0 && paid === 0 && (
            <Button small variant="soft" onClick={() => setPaid(total)}>
              Paid in full
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}

export function PurchaseView({ id, onClose }: { id: string; onClose: () => void }) {
  const { purchases, itemsById, byRef, actions } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const confirm = useConfirm();
  const notify = useNotice();
  const p = purchases.find((x) => x.id === id);
  if (!p) return null;
  const it = itemsById.get(p.itemId);
  const t = purchaseTotals(p, byRef.get(p.id));
  return (
    <Sheet
      title={`${it?.name ?? 'Purchase'} · ${showDate(p.date)}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            variant="danger"
            icon={Trash2}
            onClick={async () => {
              if (!(await confirm({ title: 'Delete this purchase?', body: 'The stock goes down again and its payments are removed.', yes: 'Delete', danger: true }))) return;
              await actions.deletePurchase(p.id);
              notify('Purchase deleted');
              onClose();
            }}
          >
            Delete
          </Button>
          {t.balance > 0 && <Button onClick={() => sheets.open({ t: 'payment', kind: 'purchase', refId: p.id })}>Pay the supplier</Button>}
        </SheetButtons>
      }
    >
      <Line label="Supplier" value={p.supplierName} />
      <Line label="Quantity" value={`${showQty(p.qty)} ${it?.unit ?? ''} at ${j.money(p.price)}`} />
      {p.quality && <Line label="Quality" value={p.quality} />}
      <Line strong label="Total" value={j.money(t.value)} />
      <Line label="Paid" value={j.money(t.paid)} tone="good" />
      <Line strong label="Still owed" value={j.money(t.balance)} tone={t.balance ? 'bad' : undefined} />
      <div className="mt-2">
        <PayBadge status={t.status} />
      </div>
    </Sheet>
  );
}

export function SupplierForm({ id, onClose }: { id?: string; onClose: () => void }) {
  const { suppliers, actions } = useData();
  const notify = useNotice();
  const confirm = useConfirm();
  const s = id ? suppliers.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(s?.name ?? '');
  const [phone, setPhone] = useState(s?.phone ?? '');
  const [supplies, setSupplies] = useState(s?.supplies ?? '');
  const { busy, error, run } = useSaver();
  return (
    <Sheet
      title={s ? `Change ${s.name}` : 'New supplier'}
      onClose={onClose}
      footer={
        <SheetButtons>
          {s && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (!(await confirm({ title: `Delete ${s.name}?`, yes: 'Delete', danger: true }))) return;
                try {
                  await actions.deleteSupplier(s.id);
                  onClose();
                } catch (e) {
                  notify((e as Error).message, 'bad');
                }
              }}
            >
              Delete
            </Button>
          )}
          <Button busy={busy} onClick={() => run(() => actions.saveSupplier({ name, phone, supplies }, id), () => { notify('Saved'); onClose(); })}>
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
        <Field label="Phone">
          <TextInput inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <Field label="What they supply">
          <TextInput value={supplies} onChange={(e) => setSupplies(e.target.value)} placeholder="e.g. Mangoes, watermelons" />
        </Field>
      </div>
    </Sheet>
  );
}

export function ReadingForm({ onClose }: { onClose: () => void }) {
  const { settings, actions, me, today } = useData();
  const notify = useNotice();
  const [fridgeName, setFridge] = useState(settings.fridges[0] ?? 'Fridge 1');
  const [celsius, setCelsius] = useState('');
  const { busy, error, run } = useSaver();
  const warm = celsius !== '' && Number(celsius.replace(',', '.')) > settings.fridgeMax;
  return (
    <Sheet
      title="Fridge temperature"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.saveReading({ date: today, time: '', fridge: fridgeName, celsius: celsius === '' ? (undefined as unknown as number) : Number(celsius.replace(',', '.')), by: me?.name ?? '' }), () => { notify(warm ? 'Saved: that fridge is too warm' : 'Saved', warm ? 'bad' : 'ok'); onClose(); })}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Choice options={settings.fridges} value={fridgeName} onChange={setFridge} />
        <Field label="Temperature (°C)" hint={`Keep juice at 0 to ${settings.fridgeMax} °C`}>
          <TextInput inputMode="decimal" value={celsius} onChange={(e) => setCelsius(e.target.value.replace(/[^\d.,-]/g, ''))} />
        </Field>
        {warm && <p className="rounded-xl bg-cherry-soft px-3 py-2 text-sm text-cherry">Too warm. Check the door seal and the gas, and sell this fridge's juice first.</p>}
      </div>
    </Sheet>
  );
}
