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

const UNITS = ['pcs', 'kg', 'bunches', 'litres', 'bags', 'boxes', 'trays'];
const NEW_ITEM = '__new';

export function ItemForm({ id, kind, onClose }: { id?: string; kind?: ItemKind; onClose: () => void }) {
  const { items, actions } = useData();
  const notify = useNotice();
  const confirm = useConfirm();
  const it = id ? items.find((x) => x.id === id) : undefined;
  const [name, setName] = useState(it?.name ?? '');
  const [k, setK] = useState<ItemKind>(it?.kind ?? kind ?? 'fruit');
  const [unit, setUnit] = useState(it?.unit ?? 'pcs'); // fruit is counted in pieces (sugar: choose kg)
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
          {it && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (!(await confirm({ title: `Delete ${it.name}?`, body: 'Only an item never bought, counted, used in a batch or in a recipe can be deleted. Otherwise use Hide.', yes: 'Delete', danger: true }))) return;
                try {
                  await actions.deleteItem(it.id);
                  notify(`${it.name} deleted`);
                  onClose();
                } catch (e) {
                  notify((e as Error).message, 'info');
                }
              }}
            >
              Delete
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
  const { itemsById, levels, actions, today } = useData();
  const [date, setDate] = useState(today);
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
          <Button busy={busy} onClick={() => run(() => actions.saveCount(itemId, counted, onRecord, reason, date), () => { notify('Stock corrected'); onClose(); })}>
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
          <Select options={['Count', 'Rotten, thrown away', 'Lost', 'Used for samples', 'Found', 'Bought but not recorded', 'Washed and used again']} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Field label="Day of the count" className="max-w-56">
          <DateInput value={date} max={today} onChange={(v) => v && setDate(v)} />
        </Field>
      </div>
    </Sheet>
  );
}

export function PurchaseForm({ itemId, id, date: day, onClose }: { itemId?: string; id?: string; date?: string; onClose: () => void }) {
  const { items, suppliers, actions, today, settings, lastCosts, purchases } = useData();
  const notify = useNotice();
  // Changing a purchase already recorded: the form starts from it (its payments stay as they are)
  const editing = id ? purchases.find((p) => p.id === id) : undefined;
  const live = items.filter((i) => !i.archived || i.id === editing?.itemId).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'fruit' ? -1 : 1));
  const [iid, setIid] = useState(editing?.itemId ?? itemId ?? live[0]?.id ?? NEW_ITEM);
  const isNew = iid === NEW_ITEM;
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<ItemKind>('fruit');
  const [newUnit, setNewUnit] = useState('pcs');
  const it = isNew ? { name: newName, unit: newUnit, kind: newKind } : live.find((i) => i.id === iid);
  const lookalike = isNew && newName.trim() ? items.find((i) => i.name.trim().toLowerCase().replace(/(es|s)$/, '') === newName.trim().toLowerCase().replace(/(es|s)$/, '')) : undefined;
  const [supplier, setSupplier] = useState(editing?.supplierName ?? '');
  // Single pieces (how many, what was paid in all) or cartons / packs (how many, how many in each, the
  // price of one); the price of one piece is worked out (Vanessa, 24 Nov 2026).
  const [mode, setMode] = useState<'pieces' | 'packs'>(editing?.pack ? 'packs' : 'pieces');
  const [q, setQ] = useState(editing && !editing.pack ? editing.qty : 0);
  const [paidAll, setPaidAll] = useState(editing && !editing.pack ? (editing.total ?? Math.round(editing.qty * editing.price)) : 0);
  const perKey = (id: string) => `vannys.pack.${id}`;
  const [packs, setPacks] = useState(editing?.pack?.count ?? 0);
  const [per, setPer] = useState(editing?.pack?.per ?? (Number(localStorage.getItem(perKey(iid))) || 12));
  const [packPrice, setPackPrice] = useState(editing?.pack?.price ?? 0);
  const qtyNow = mode === 'packs' ? Math.round(packs * per * 1000) / 1000 : q;
  const lastEach = lastCosts.get(iid);
  const [paid, setPaid] = useState(0);
  const [method, setMethod] = useState(settings.methods[0]);
  const [quality, setQuality] = useState<string>(editing?.quality || 'Good');
  const [date, setDate] = useState(editing?.date ?? day ?? today);
  const { busy, error, run } = useSaver();
  const total = mode === 'packs' ? Math.round(packs * packPrice) : Math.round(paidAll);
  const each = qtyNow > 0 ? total / qtyNow : 0;
  const figures = mode === 'packs' ? { pack: { count: packs, per, price: packPrice } } : { qty: q, total: paidAll };
  return (
    <Sheet
      title={editing ? 'Change this purchase' : 'Buy fruit or supplies'}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            busy={busy}
            onClick={() =>
              run(
                async () => {
                  let id = iid;
                  if (isNew) {
                    if (!newName.trim()) throw new Error('Type the name of what was bought.');
                    if (!(qtyNow > 0)) throw new Error('Type how much was bought.');
                    id = await actions.saveItem({ name: newName, kind: newKind, unit: newUnit, reorderLevel: 0 });
                  }
                  if (mode === 'packs') localStorage.setItem(perKey(id), String(per));
                  if (editing) await actions.updatePurchase(editing.id, { date, supplierName: supplier, itemId: id, ...figures, quality, note: editing.note });
                  else await actions.savePurchase({ date, supplierName: supplier, itemId: id, ...figures, quality }, { amount: paid, method });
                },
                () => {
                  notify(editing ? 'Purchase changed' : isNew ? `${newName.trim()} added to Stock, and the purchase saved` : 'Purchase saved: stock is up');
                  onClose();
                },
              )
            }
          >
            {editing ? 'Save changes' : 'Save purchase'}
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      {
        <div className="space-y-4">
          <Field label="What was bought">
            <Select
              options={[
                ...live.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})${i.kind === 'packaging' ? ' · packaging' : ''}` })),
                { value: NEW_ITEM, label: '+ New item (not in Stock yet)…' },
              ]}
              value={iid}
              onChange={(e) => {
                setIid(e.target.value);
                setPer(Number(localStorage.getItem(perKey(e.target.value))) || 12);
              }}
            />
          </Field>
          {isNew && (
            <div className="space-y-3 rounded-xl border border-line bg-card p-3">
              <Field label="Name of the new item">
                <TextInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Mangoes, Sugar, Bottles 500 ml" />
              </Field>
              {lookalike && (
                <p className="text-xs text-amber">
                  Already in Stock as {lookalike.name}.{' '}
                  <button type="button" className="font-semibold underline" onClick={() => setIid(lookalike.id)}>
                    Use {lookalike.name}
                  </button>
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="It is">
                  <Select
                    options={[
                      { value: 'fruit', label: 'Fruit or ingredient' },
                      { value: 'packaging', label: 'Bottles or packaging' },
                    ]}
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as ItemKind)}
                  />
                </Field>
                <Field label="Counted in">
                  <Select options={UNITS} value={newUnit} onChange={(e) => setNewUnit(e.target.value)} />
                </Field>
              </div>
            </div>
          )}
          <Field label="Supplier" hint="A new name is added to Suppliers">
            <TextInput list="purchase-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Mama Rose (Owino)" />
            <datalist id="purchase-suppliers">
              {suppliers.filter((s) => !s.archived).map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
          </Field>
          <div>
            <span className="label">How it was bought</span>
            <Choice
              options={[
                { value: 'pieces', label: `Single ${it?.unit === 'pcs' || !it?.unit ? 'pieces' : it.unit}` },
                { value: 'packs', label: 'Cartons or packs' },
              ]}
              value={mode}
              onChange={(v) => setMode(v as 'pieces' | 'packs')}
            />
          </div>
          {mode === 'pieces' ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label={`How many (${it?.unit ?? ''})`}>
                <QtyInput value={q} onChange={setQ} />
              </Field>
              <Field label="Paid in all">
                <MoneyInput value={paidAll} onChange={setPaidAll} />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Cartons">
                <QtyInput value={packs} onChange={setPacks} />
              </Field>
              <Field label={`${it?.unit === 'pcs' || !it?.unit ? 'Pieces' : it.unit} in one`}>
                <QtyInput value={per} onChange={(n) => setPer(Math.max(1, Math.round(n)))} />
              </Field>
              <Field label="Price of one carton">
                <MoneyInput value={packPrice} onChange={setPackPrice} />
              </Field>
            </div>
          )}
          <p className="rounded-lg bg-page px-3 py-2 text-[15px]">
            {qtyNow > 0 && total > 0 ? (
              <>
                <b className="num">{showQty(qtyNow)} {it?.unit}</b> go into Stock · total <b className="num">{money(total, settings.currency)}</b> · <b className="num">{money(Math.round(each), settings.currency)}</b> each
                {lastEach ? <span className="block text-xs text-muted">Last time: {money(Math.round(lastEach), settings.currency)} each</span> : null}
              </>
            ) : (
              <span className="text-muted">
                {mode === 'packs' ? 'Type the cartons, how many are in one, and the price of one carton.' : 'Type how many and what you paid in all.'} The price of one is worked out{lastEach ? ` (last time ${money(Math.round(lastEach), settings.currency)} each)` : ''}.
              </span>
            )}
          </p>
          {!editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Paid now" hint="Leave at 0 if on credit">
              <MoneyInput value={paid} onChange={setPaid} />
            </Field>
            <Field label="Paid by">
              <Select options={settings.methods} value={method} onChange={(e) => setMethod(e.target.value)} />
            </Field>
          </div>
          )}
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
          {!editing && total > 0 && paid === 0 && (
            <Button small variant="soft" onClick={() => setPaid(total)}>
              Paid in full
            </Button>
          )}
        </div>
      }
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
          <Button variant="soft" onClick={() => sheets.open({ t: 'purchase', id: p.id })}>
            Change
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
