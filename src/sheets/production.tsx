// Making juice: a new batch, a batch's own window, bottling, writing off spoiled juice, and recipes.
import { Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BatchBadge, JuiceBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Badge, Button, Choice, DateInput, Field, FormError, IconButton, Line, QtyInput, Select, Sheet, SheetButtons, TextInput, cx, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, showDate, showDay } from '../lib/dates';
import { averageRecipe, batchCost, bottleCost, priceOf, recipeCostPerLitre, sizeOf } from '../lib/juice';
import { qty as showQty } from '../lib/money';
import { WRITE_OFF_REASONS, type Batch, type ProductKind, type RecipeLine } from '../lib/types';

function Tick({ on, set, text }: { on: boolean; set: (v: boolean) => void; text: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 py-1 text-[15px]">
      <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={on} onChange={(e) => set(e.target.checked)} />
      {text}
    </label>
  );
}

/** Bottles to fill: a box for each size. */
function BottleBoxes({ filled, setFilled }: { filled: Record<string, number>; setFilled: (f: Record<string, number>) => void }) {
  const { settings } = useData();
  return (
    <div className="grid grid-cols-4 gap-2">
      {settings.sizes.map((s) => (
        <Field key={s.key} label={s.label}>
          <TextInput inputMode="numeric" className="num text-right" placeholder="0" value={filled[s.key] ? String(filled[s.key]) : ''} onChange={(e) => setFilled({ ...filled, [s.key]: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
        </Field>
      ))}
    </div>
  );
}

export function BatchForm({ productId, onClose }: { productId?: string; onClose: () => void }) {
  const { actions, products, items, itemsById, levels, settings, today, staff, avgCosts, me, batches } = useData();
  const j = useJuice();
  const notify = useNotice();
  const live = products.filter((p) => !p.archived);
  const [pid, setPid] = useState(productId ?? live[0]?.id ?? '');
  const product = live.find((p) => p.id === pid);
  // Bottles first: the litres follow the bottles unless typed (e.g. still being made, or some left over)
  const lastFilled = (id: string): Record<string, number> => {
    const last = batches.filter((b) => b.productId === id && Object.keys(b.filled ?? {}).length).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)[0];
    return last ? Object.fromEntries(Object.keys(last.filled).map((k) => [k, 0])) : {};
  };
  const [filled, setFilled] = useState<Record<string, number>>({});
  const [bottleLater, setBottleLater] = useState(false);
  const [litresTyped, setLitresTyped] = useState<number | null>(null);
  const bottled = Object.entries(bottleLater ? {} : filled).reduce((t, [k, n]) => t + n * (sizeOf(settings.sizes, k)?.litres ?? 0), 0);
  const litres = litresTyped ?? Math.round(bottled * 1000) / 1000;
  // What went in: the juice's own ingredients, filled in for these litres until changed by hand
  type Row = { itemId: string; qty: number; typed: boolean };
  const rowsFor = (p = product): Row[] => (p?.recipe ?? []).map((r) => ({ itemId: r.itemId, qty: 0, typed: false }));
  const [rows, setRows] = useState<Row[]>(rowsFor());
  const [water, setWater] = useState<number | null>(null);
  const expected = (itemId: string) => {
    const r = product?.recipe.find((x) => x.itemId === itemId);
    return r ? Math.round(((r.qty * litres) / 10) * 10) / 10 : 0;
  };
  const used: RecipeLine[] = rows.map((r) => ({ itemId: r.itemId, qty: r.typed ? r.qty : expected(r.itemId) })).filter((u) => u.qty > 0);
  const waterUsed = water ?? Math.round((((product?.water ?? 0) * litres) / 10) * 10) / 10;
  const [adding, setAdding] = useState('');
  const canAdd = items.filter((i) => !i.archived && i.kind === 'fruit' && !rows.some((r) => r.itemId === i.id));
  const makers = staff.filter((s) => !s.archived && (s.role === 'production' || s.role === 'owner')).map((s) => s.name);
  const [madeBy, setMadeBy] = useState(me?.name ?? makers[0] ?? '');
  const [date, setDate] = useState(today);
  const [checks, setChecks] = useState<string[]>([]);
  const { busy, error, run } = useSaver();

  const changeProduct = (id: string) => {
    const p = live.find((x) => x.id === id);
    setPid(id);
    setRows(rowsFor(p));
    setWater(null);
    if (!Object.values(filled).some((n) => n > 0)) setFilled(lastFilled(id));
  };
  const fakeBatch: Batch = { id: 'new', number: '', date, productId: pid, litres, used, filled: bottleLater ? {} : filled, madeBy, bestBefore: '', checks, water: waterUsed, measured: true, createdAt: Date.now(), updatedAt: Date.now() };
  const cost = batchCost(fakeBatch, product, settings.sizes, avgCosts);
  const after = litres > 0 && used.length ? averageRecipe(pid, [...batches, fakeBatch], settings.sizes) : null;

  return (
    <Sheet
      wide
      title="New batch"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            busy={busy}
            onClick={() =>
              run(
                () => actions.saveBatch({ date, productId: pid, litres, used, filled: bottleLater ? {} : filled, madeBy, checks, water: waterUsed }),
                () => {
                  notify(after ? `Batch saved. ${product?.name} recipe: the average of ${after.batches} batch${after.batches === 1 ? '' : 'es'}` : bottleLater ? 'Batch saved. Fill the bottles when ready.' : 'Batch saved: the bottles are in the fridge');
                  onClose();
                },
              )
            }
          >
            Save batch
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      {!live.length ? (
        <p className="text-muted">Add your juices first, on Recipes and prices.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="label">1. Which juice?</span>
            <div className="flex flex-wrap gap-2">
              {live.map((p) => (
                <button key={p.id} type="button" className={cx('chip', p.id === pid && 'chip-on')} onClick={() => changeProduct(p.id)}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="label">2. Bottles filled</span>
            <Tick on={bottleLater} set={setBottleLater} text="Still being made: fill the bottles later" />
            {!bottleLater && <BottleBoxes filled={filled} setFilled={setFilled} />}
            <div className="mt-2 grid grid-cols-3 gap-3">
              <Field label="Litres made" hint={litresTyped === null ? (bottleLater ? 'Type the litres' : 'From the bottles') : 'Typed'}>
                <QtyInput value={litres} onChange={(n) => setLitresTyped(n || null)} />
              </Field>
              <Field label="Made by">
                <Select options={makers.length ? makers : ['']} value={madeBy} onChange={(e) => setMadeBy(e.target.value)} />
              </Field>
              <Field label="Date">
                <DateInput value={date} onChange={setDate} />
              </Field>
            </div>
            {!bottleLater && bottled > litres + 0.05 && <p className="mt-1 text-sm text-cherry">The bottles hold {showQty(bottled)} litres, more than the {showQty(litres)} litres made.</p>}
          </div>

          <div>
            <span className="label">3. What really went in{product ? ` (${product.name})` : ''}</span>
            <div className="card divide-y divide-line px-3">
              {rows.map((r) => {
                const it = itemsById.get(r.itemId);
                const q = r.typed ? r.qty : expected(r.itemId);
                const have = levels.get(r.itemId)?.onHand ?? 0;
                return (
                  <div key={r.itemId} className="flex items-center gap-2 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{it?.name ?? 'Item no longer in the list'}</span>
                      <span className={cx('text-xs', have >= q ? 'text-muted' : 'text-cherry')}>
                        {r.typed ? `recipe says ${showQty(expected(r.itemId))}` : 'from the recipe: type what you used'} · {have >= q ? `have ${showQty(have)}` : have > 0 ? `only ${showQty(have)} in stock` : 'none in stock'}
                      </span>
                    </span>
                    <QtyInput className={cx('w-24', !r.typed && 'text-muted')} value={q} onChange={(n) => setRows((rs) => rs.map((x) => (x.itemId === r.itemId ? { ...x, qty: n, typed: true } : x)))} />
                    <span className="w-12 text-sm text-muted">{it?.unit}</span>
                    <IconButton icon={X} label={`Remove ${it?.name ?? 'item'}`} onClick={() => setRows((rs) => rs.filter((x) => x.itemId !== r.itemId))} />
                  </div>
                );
              })}
              <div className="flex items-center gap-2 py-2">
                <span className="min-w-0 flex-1 font-medium">Clean water</span>
                <QtyInput className={cx('w-24', water === null && 'text-muted')} value={waterUsed} onChange={(n) => setWater(n)} />
                <span className="w-12 text-sm text-muted">L</span>
                <span className="w-11" />
              </div>
              {canAdd.length > 0 && (
                <div className="flex items-center gap-2 py-2">
                  <Select
                    aria-label="Add another ingredient"
                    className="flex-1"
                    options={[{ value: '', label: rows.length ? '+ Something else that went in' : '+ Add what went in' }, ...canAdd.map((i) => ({ value: i.id, label: `${i.name} (${i.unit})` }))]}
                    value={adding}
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id) setRows((rs) => [...rs, { itemId: id, qty: 0, typed: true }]);
                      setAdding('');
                    }}
                  />
                </div>
              )}
            </div>
            {!rows.length && <p className="mt-1 text-xs text-muted">This juice has no recipe yet: add each fruit and how much you used, and this batch becomes its recipe.</p>}
            {items.length === 0 && <p className="mt-1 text-xs text-muted">No fruit in Stock yet.</p>}
          </div>

          {after && product && (
            <div className="card p-3">
              <p className="font-semibold">
                {product.name} recipe for 10 litres after this batch
                <span className="block text-xs font-normal text-muted">
                  The average of its last {after.batches} batch{after.batches === 1 ? '' : 'es'} ({showQty(after.litres)} litres), because fruit is not the same size every time. Each batch you record updates it.
                </span>
              </p>
              <div className="mt-2 divide-y divide-line text-sm">
                {after.recipe.map((r) => {
                  const before = product.recipe.find((x) => x.itemId === r.itemId)?.qty ?? 0;
                  return (
                    <div key={r.itemId} className="num flex justify-between py-1">
                      <span>{itemsById.get(r.itemId)?.name ?? 'Item'}</span>
                      <span>
                        {before && before !== r.qty ? <span className="text-muted line-through">{showQty(before)}</span> : null} <b>{showQty(r.qty)}</b> {itemsById.get(r.itemId)?.unit}
                      </span>
                    </div>
                  );
                })}
                {after.water !== null && (
                  <div className="num flex justify-between py-1">
                    <span>Clean water</span>
                    <span>
                      <b>{showQty(after.water)}</b> L
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card p-3">
            <Line label="Fruit, sugar and other ingredients" value={j.money(cost.juice)} />
            {!bottleLater && <Line label="Bottles, caps and labels" value={j.money(cost.packaging)} />}
            <Line strong label="Batch cost" value={j.money(cost.total)} />
            <Line label="Juice cost per litre" value={j.money(cost.perLitre)} />
            {!bottleLater && <Line label="If every bottle is sold" value={j.money(cost.salesValue)} tone="good" />}
            <Line label="Best before" value={product ? showDay(addDays(date, product.keepsDays)) : ''} />
          </div>

          <div>
            <span className="label">Hygiene before this batch</span>
            <div className="card divide-y divide-line px-3">
              {settings.hygieneChecks.map((c) => (
                <Tick key={c} on={checks.includes(c)} set={(v) => setChecks((cs) => (v ? [...cs, c] : cs.filter((x) => x !== c)))} text={c} />
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function BatchView({ id, onClose }: { id: string; onClose: () => void }) {
  const { batches, productsById, itemsById, settings, avgCosts, fridge, actions, role } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const confirm = useConfirm();
  const notify = useNotice();
  const b = batches.find((x) => x.id === id);
  if (!b) return null;
  const p = productsById.get(b.productId);
  const cost = batchCost(b, p, settings.sizes, avgCosts);
  const left = fridge.get(b.id);
  const making = !Object.values(b.filled ?? {}).some((n) => n > 0);
  return (
    <Sheet
      title={`${b.number} · ${p?.name ?? ''}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          {making ? (
            <Button onClick={() => sheets.open({ t: 'bottle', id: b.id })}>Fill the bottles</Button>
          ) : (
            (left?.total ?? 0) > 0 && (
              <Button variant="soft" onClick={() => sheets.open({ t: 'writeOff', batchId: b.id })}>
                Write off spoiled
              </Button>
            )
          )}
        </SheetButtons>
      }
    >
      <div className="mb-3 flex items-center gap-3">
        <JuiceBadge product={p} />
        <div className="min-w-0 flex-1 text-sm text-muted">
          Made {showDate(b.date)} by {b.madeBy || 'someone'} · {b.litres} L · best before {showDate(b.bestBefore)}
        </div>
        <BatchBadge batch={b} />
      </div>
      <h3 className="mt-2 text-sm font-semibold">Used</h3>
      {b.used.map((u) => (
        <Line key={u.itemId} label={itemsById.get(u.itemId)?.name ?? 'Item'} value={`${showQty(u.qty)} ${itemsById.get(u.itemId)?.unit ?? ''}`} />
      ))}
      <h3 className="mt-3 text-sm font-semibold">Filled</h3>
      {making ? (
        <p className="text-sm text-muted">Not bottled yet.</p>
      ) : (
        Object.entries(b.filled).map(([k, n]) => <Line key={k} label={j.sizeLabel(k)} value={`${n} bottles · ${left?.left[k] ?? 0} still in the fridge`} />)
      )}
      {role === 'owner' && (
        <>
          <h3 className="mt-3 text-sm font-semibold">Cost</h3>
          <Line label="Fruit and ingredients" value={j.money(cost.juice)} />
          <Line label="Bottles, caps and labels" value={j.money(cost.packaging)} />
          <Line strong label="Batch cost" value={j.money(cost.total)} />
          <Line label="Juice cost per litre" value={j.money(cost.perLitre)} />
          {!making && <Line label="If every bottle is sold" value={j.money(cost.salesValue)} tone="good" />}
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {b.checks.length === settings.hygieneChecks.length ? <Badge tone="green">All hygiene checks done</Badge> : <Badge tone="amber">{b.checks.length} of {settings.hygieneChecks.length} hygiene checks ticked</Badge>}
      </div>
      {role === 'owner' && (
        <Button
          small
          variant="danger"
          icon={Trash2}
          className="mt-4"
          onClick={async () => {
            if (!(await confirm({ title: `Delete ${b.number}?`, body: 'Only a batch with nothing sold or written off can be deleted. The fruit it used goes back into stock.', yes: 'Delete', danger: true }))) return;
            try {
              await actions.deleteBatch(b.id);
              notify('Batch deleted');
              onClose();
            } catch (e) {
              notify((e as Error).message, 'bad');
            }
          }}
        >
          Delete batch
        </Button>
      )}
    </Sheet>
  );
}

export function BottleForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { batches, actions, settings } = useData();
  const notify = useNotice();
  const b = batches.find((x) => x.id === id);
  const [filled, setFilled] = useState<Record<string, number>>(b?.filled ?? {});
  const { busy, error, run } = useSaver();
  if (!b) return null;
  const bottled = Object.entries(filled).reduce((t, [k, n]) => t + n * (sizeOf(settings.sizes, k)?.litres ?? 0), 0);
  return (
    <Sheet
      title={`Fill the bottles · ${b.number}`}
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.bottleBatch(b.id, filled), () => { notify('The bottles are in the fridge'); onClose(); })}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <BottleBoxes filled={filled} setFilled={setFilled} />
      <p className="mt-2 text-sm text-muted">
        Bottled {showQty(bottled)} of {b.litres} litres
      </p>
    </Sheet>
  );
}

export function WriteOffForm({ batchId, onClose }: { batchId?: string; onClose: () => void }) {
  const { batches, fridge, productsById, actions, settings } = useData();
  const notify = useNotice();
  const inFridge = batches.filter((b) => (fridge.get(b.id)?.total ?? 0) > 0).sort((a, b) => a.bestBefore.localeCompare(b.bestBefore));
  const [bid, setBid] = useState(batchId ?? inFridge[0]?.id ?? '');
  const left = fridge.get(bid);
  const sizes = settings.sizes.filter((s) => (left?.left[s.key] ?? 0) > 0);
  const [size, setSize] = useState(sizes[0]?.key ?? '');
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState<string>(WRITE_OFF_REASONS[0]);
  const { busy, error, run } = useSaver();
  return (
    <Sheet
      title="Write off spoiled juice"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button busy={busy} onClick={() => run(() => actions.writeOff({ batchId: bid, size, qty, reason }), () => { notify('Written off'); onClose(); })}>
            Write off
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      {!inFridge.length ? (
        <p className="text-muted">No recorded bottles are left in the fridge, so there is nothing to write off. Bottles count as in the fridge once they are recorded as made (Day list: Bottles made, or Production) and until they are sold.</p>
      ) : (
        <div className="space-y-4">
          <Field label="Batch">
            <Select
              options={inFridge.map((b) => ({ value: b.id, label: `${b.number} · ${productsById.get(b.productId)?.name ?? ''} · best before ${showDate(b.bestBefore)}` }))}
              value={bid}
              onChange={(e) => {
                setBid(e.target.value);
                const l = fridge.get(e.target.value);
                setSize(settings.sizes.find((s) => (l?.left[s.key] ?? 0) > 0)?.key ?? '');
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Size">
              <Select options={sizes.map((s) => ({ value: s.key, label: `${s.label} (${left?.left[s.key] ?? 0} left)` }))} value={size} onChange={(e) => setSize(e.target.value)} />
            </Field>
            <Field label="How many bottles">
              <TextInput inputMode="numeric" className="num text-right" value={qty ? String(qty) : ''} onChange={(e) => setQty(Number(e.target.value.replace(/\D/g, '')) || 0)} />
            </Field>
          </div>
          <Field label="Why">
            <Select options={[...WRITE_OFF_REASONS]} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      )}
    </Sheet>
  );
}

export interface RecipeName {
  name: string;
  unit: string;
  qty: number;
  /** a new ingredient being typed (not in Stock yet) */
  isNew?: boolean;
}
const RECIPE_UNITS = ['pcs', 'kg', 'bunches', 'litres'];
/** Bought by weight, not counted: these default to kg. */
const WEIGHED = /sugar|honey|salt|powder|flour/i;
const NEW = '__new';
/** "Mango" and "Mangoes", "lemon" and "Lemons": the same word for the check against mixing names. */
const stem = (s: string) => s.trim().toLowerCase().replace(/(es|s)$/, '');

/**
 * Ingredient rows: each picked from Stock in a drop-down, or "+ New ingredient" to type one (added to
 * Stock on Save). A new name that looks like one already in Stock offers that one instead.
 */
export function IngredientRows({ lines, setLines, qtyLabel }: { lines: RecipeName[]; setLines: (f: (l: RecipeName[]) => RecipeName[]) => void; qtyLabel: string }) {
  const { items } = useData();
  const fruit = items.filter((i) => !i.archived && i.kind === 'fruit').sort((a, b) => a.name.localeCompare(b.name));
  const known = (n: string) => items.find((i) => i.name.trim().toLowerCase() === n.trim().toLowerCase());
  const setLine = (i: number, patch: Partial<RecipeName>) => setLines((ls) => ls.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  return (
    <div>
      <div className="mb-1 grid grid-cols-[1fr_5.5rem_auto] gap-2 text-xs text-muted">
        <span>Fruit or ingredient</span>
        <span>{qtyLabel}</span>
        <span className="w-10" />
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => {
          const k = !l.isNew ? known(l.name) : undefined;
          const lookalike = l.isNew && l.name.trim() ? items.find((it) => stem(it.name) === stem(l.name) || it.name.trim().toLowerCase() === l.name.trim().toLowerCase()) : undefined;
          return (
            <div key={i} className="rounded-xl border border-line bg-card p-2">
              <div className="grid grid-cols-[1fr_5.5rem_auto] items-center gap-2">
                <Select
                  aria-label="Fruit or ingredient"
                  options={[{ value: '', label: 'Choose…' }, ...fruit.map((f) => ({ value: f.id, label: `${f.name} (${f.unit})` })), { value: NEW, label: '+ New ingredient…' }]}
                  value={l.isNew ? NEW : (k?.id ?? '')}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === NEW) return setLine(i, { isNew: true, name: '', unit: 'pcs' });
                    const it = items.find((x) => x.id === v);
                    setLine(i, { isNew: false, name: it?.name ?? '', unit: it?.unit ?? 'pcs' });
                  }}
                />
                <span className="flex items-center gap-1">
                  <QtyInput aria-label={qtyLabel} value={l.qty} onChange={(q) => setLine(i, { qty: q })} />
                </span>
                <IconButton icon={X} label="Remove" onClick={() => setLines((ls) => ls.filter((_, n) => n !== i))} />
              </div>
              {k && <p className="mt-1 pl-1 text-xs text-muted">in {k.unit}</p>}
              {l.isNew && (
                <div className="mt-2 grid grid-cols-[1fr_6.5rem] gap-2">
                  <TextInput aria-label="New ingredient's name" value={l.name} placeholder="Name, e.g. Ginger" onChange={(e) => setLine(i, { name: e.target.value, unit: WEIGHED.test(e.target.value) ? 'kg' : l.unit })} />
                  <Select aria-label="Counted in" options={RECIPE_UNITS} value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
                </div>
              )}
              {lookalike && (
                <p className="mt-1 flex flex-wrap items-center gap-2 pl-1 text-xs text-amber">
                  Already in Stock as {lookalike.name} ({lookalike.unit}).
                  <button type="button" className="font-semibold underline" onClick={() => setLine(i, { isNew: false, name: lookalike.name, unit: lookalike.unit })}>
                    Use {lookalike.name}
                  </button>
                </p>
              )}
            </div>
          );
        })}
      </div>
      <Button small variant="soft" icon={Plus} className="mt-2" onClick={() => setLines((ls) => [...ls, { name: '', unit: 'pcs', qty: 0, isNew: fruit.length === 0 }])}>
        Add a fruit or ingredient
      </Button>
    </div>
  );
}

const ICONS = ['🥭', '🍍', '🍉', '🍊', '🍋', '🍓', '🍌', '🍎', '🥕', '🥒', '🫐', '🟣', '🔴', '🍹', '🥤', '🌿'];
const COLOURS = ['#FFA41B', '#E9B800', '#E8445A', '#F7811E', '#8E3FA0', '#3BA935', '#C2571A', '#A3203F', '#2F8F3A', '#D33A55'];

export function ProductForm({ id, kind, onClose }: { id?: string; kind?: ProductKind; onClose: () => void }) {
  const { products, items, actions, settings, lastCosts, avgCosts, me, today } = useData();
  const j = useJuice();
  const notify = useNotice();
  const confirm = useConfirm();
  const sheets = useSheets();
  const p = id ? products.find((x) => x.id === id) : undefined;
  const hasFruit = items.some((i) => !i.archived && i.kind === 'fruit');
  const [name, setName] = useState(p?.name ?? '');
  const [k, setK] = useState<ProductKind>(p?.kind ?? kind ?? 'cocktail');
  const [icon, setIcon] = useState(p?.icon ?? (k === 'cocktail' ? '🍹' : '🥭'));
  const [colour, setColour] = useState(p?.colour ?? COLOURS[0]);
  const premium = false; // one price per size
  const [keeps, setKeeps] = useState(p?.keepsDays ?? 3);
  const [tag, setTag] = useState(p?.tag ?? '');
  const [mode, setMode] = useState<'ten' | 'batch'>('ten');
  // Method 1: what goes into 10 litres
  const itemOf = (itemId: string) => items.find((i) => i.id === itemId);
  const [tenLines, setTenLines] = useState<RecipeName[]>(p?.recipe.length ? p.recipe.map((r) => ({ name: itemOf(r.itemId)?.name ?? '', unit: itemOf(r.itemId)?.unit ?? 'pcs', qty: r.qty })) : [{ name: '', unit: 'pcs', qty: 0, isNew: !hasFruit }]);
  const [water, setWater] = useState(p?.water ?? 0);
  // Method 2: one real batch, worked out backwards
  const [usedLines, setUsedLines] = useState<RecipeName[]>([{ name: '', unit: 'pcs', qty: 0, isNew: !hasFruit }]);
  const [waterUsed, setWaterUsed] = useState(0);
  const [filled, setFilled] = useState<Record<string, number>>({});
  const [record, setRecord] = useState(true);
  const [madeOn, setMadeOn] = useState(today);
  const { busy, error, run } = useSaver();
  const costs = useMemo(() => new Map([...avgCosts, ...lastCosts]), [avgCosts, lastCosts]);
  const known = (n: string) => items.find((i) => i.name.trim().toLowerCase() === n.trim().toLowerCase());
  const litres = Object.entries(filled).reduce((t, [key, n]) => t + Math.max(0, Math.round(n || 0)) * (sizeOf(settings.sizes, key)?.litres ?? 0), 0);
  const per10 = (q: number) => (litres > 0 ? Math.round(((q || 0) * 10 * 1000) / litres) / 1000 : 0);
  const shownLines = mode === 'ten' ? tenLines : usedLines.map((l) => ({ ...l, qty: per10(l.qty) }));
  const recipe: RecipeLine[] = shownLines.map((l) => ({ itemId: known(l.name)?.id ?? '', qty: l.qty })).filter((r) => r.itemId);
  const draft = { id: '', name, kind: k, icon, colour, premium, recipe, water: mode === 'ten' ? water : per10(waterUsed), keepsDays: keeps, createdAt: 0, updatedAt: 0 };
  const perL = recipeCostPerLitre(draft, costs);
  const newNames = shownLines.filter((l) => l.isNew && l.name.trim() && !known(l.name)).map((l) => l.name.trim());
  const base = { name, kind: k, icon, colour, premium, keepsDays: keeps, tag };
  const saveNow = () =>
    run(
      async () => {
        if (mode === 'ten') {
          await actions.saveProductByNames({ ...base, water }, tenLines, id);
          return '';
        }
        const r = await actions.saveProductFromBatch(base, usedLines, waterUsed, filled, record, me?.name, id, madeOn);
        return `Recipe worked out from ${showQty(r.litres)} litres${record ? `; the batch is recorded as made on ${showDay(madeOn)}` : ''}`;
      },
      (msg) => {
        notify(msg || 'Saved');
        onClose();
      },
    );
  return (
    <Sheet
      wide
      title={p ? `Change ${p.name}` : k === 'cocktail' ? 'New juice cocktail' : 'New juice'}
      onClose={onClose}
      footer={
        <SheetButtons>
          {p && (
            <Button
              variant="plain"
              onClick={async () => {
                if (!(await confirm({ title: p.archived ? `Show ${p.name} again?` : `Hide ${p.name}?`, body: p.archived ? undefined : 'It disappears from Sell, the Day list, Production and new orders. Its history stays.', yes: p.archived ? 'Show' : 'Hide' }))) return;
                await actions.archiveProduct(p.id, !p.archived);
                onClose();
              }}
            >
              {p.archived ? 'Show again' : 'Hide'}
            </Button>
          )}
          <Button busy={busy} onClick={saveNow}>
            Save
          </Button>
        </SheetButtons>
      }
    >
      <FormError message={error} />
      <div className="space-y-4">
        <Choice options={[{ value: 'single' as ProductKind, label: 'Single fruit' }, { value: 'cocktail' as ProductKind, label: 'Juice cocktail' }]} value={k} onChange={setK} />
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder={k === 'cocktail' ? 'e.g. Mango Pine Ginger' : 'e.g. Mango'} />
        </Field>
        {k === 'cocktail' && (
          <Field label="What is in it (shown under the name)">
            <TextInput value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Mango, pineapple, ginger" />
          </Field>
        )}
        <div>
          <span className="label">Picture and colour</span>
          <div className="flex flex-wrap gap-1.5">
            {ICONS.map((i) => (
              <button key={i} type="button" onClick={() => setIcon(i)} className={cx('h-10 w-10 rounded-xl border text-xl', icon === i ? 'border-accent bg-accent-soft' : 'border-line bg-card')}>
                {i}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {COLOURS.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => setColour(c)} className={cx('h-8 w-8 rounded-full border-2', colour === c ? 'border-ink' : 'border-white')} style={{ background: c }} />
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-line bg-page p-3">
          <span className="label">The recipe</span>
          <Choice
            options={[
              { value: 'ten' as const, label: 'What goes into 10 litres' },
              { value: 'batch' as const, label: 'Work it out from a batch' },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'ten' ? (
            <div className="mt-3 space-y-3">
              <IngredientRows lines={tenLines} setLines={setTenLines} qtyLabel="For 10 L" />
              <Field label="Water for 10 litres (litres)" className="max-w-56">
                <QtyInput value={water} onChange={setWater} />
              </Field>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <p className="text-sm text-muted">Make a batch as usual. Write down everything that went in, the water, and how many bottles of each size you filled: the app works out the recipe for 10 litres.</p>
              <IngredientRows lines={usedLines} setLines={setUsedLines} qtyLabel="Used" />
              <Field label="Water used (litres)" className="max-w-56">
                <QtyInput value={waterUsed} onChange={setWaterUsed} />
              </Field>
              <div>
                <span className="label">Bottles filled</span>
                <BottleBoxes filled={filled} setFilled={setFilled} />
              </div>
              {litres > 0 ? (
                <div className="rounded-xl bg-card px-3 py-2 text-sm">
                  <p className="font-semibold">That is {showQty(litres)} litres. For 10 litres:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {shownLines
                      .filter((l) => l.name.trim() && l.qty > 0)
                      .map((l, i) => (
                        <li key={i} className="num">
                          {showQty(l.qty)} {known(l.name)?.unit ?? l.unit} {l.name.trim()}
                        </li>
                      ))}
                    {waterUsed > 0 && <li className="num">{showQty(per10(waterUsed))} litres water</li>}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-muted">Type the bottles filled to see the recipe.</p>
              )}
              <Tick on={record} set={setRecord} text="Also record this batch as made (Day list: bottles made)" />
              {record && (
                <Field label="Day it was made" hint="Change it for a batch made on an earlier day." className="max-w-56">
                  <DateInput value={madeOn} max={today} onChange={(v) => v && setMadeOn(v)} />
                </Field>
              )}
              <p className="text-xs text-muted">
                Bottles already counted with nothing recorded about what went in?{' '}
                <button type="button" className="font-semibold text-accent-dark underline" onClick={() => sheets.open({ t: 'reconcile', productId: id })}>
                  Reconcile bottles made
                </button>
              </p>
            </div>
          )}
          {newNames.length > 0 && <p className="mt-2 text-xs text-muted">New in Stock when you save: {newNames.join(', ')}.</p>}
          <p className="mt-1 text-xs text-muted">Fruit in pieces (e.g. 30 mangoes), sugar in kg. Record what you pay on Buying so the cost below fills in.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Keeps (days)">
            <TextInput inputMode="numeric" value={keeps ? String(keeps) : ''} onChange={(e) => setKeeps(Number(e.target.value.replace(/\D/g, '')) || 0)} />
          </Field>

        </div>
        <div className="card p-3">
          <Line strong label="Juice cost per litre (today's fruit prices)" value={j.money(perL)} />
          <table className="tbl mt-1">
            <thead>
              <tr>
                <th>Size</th>
                <th className="n">Cost</th>
                <th className="n">Price</th>
                <th className="n">Margin</th>
              </tr>
            </thead>
            <tbody>
              {settings.sizes.map((s) => {
                const c = bottleCost(perL, s);
                const pr = priceOf(draft, s);
                const m = pr > 0 ? (pr - c) / pr : 0;
                return (
                  <tr key={s.key}>
                    <td>{s.label}</td>
                    <td className="n num">{j.money(c)}</td>
                    <td className="n num">{j.money(pr)}</td>
                    <td className="n">
                      <Badge tone={m >= 0.3 ? 'green' : m >= 0.2 ? 'amber' : 'red'}>{Math.round(m * 100)}%</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {costs.size === 0 && <p className="mt-1 text-xs text-muted">Costs show once fruit has been bought (Buying).</p>}
        </div>
        {p && (
          <Button
            small
            variant="danger"
            icon={Trash2}
            onClick={async () => {
              if (!(await confirm({ title: `Delete ${p.name} and its recipe?`, body: 'This cannot be undone. A juice that has been made, sold or ordered is kept for its history: Hide it instead.', yes: 'Delete', danger: true }))) return;
              try {
                await actions.deleteProduct(p.id);
                notify(`${p.name} deleted`);
                onClose();
              } catch (e) {
                notify((e as Error).message, 'info');
              }
            }}
          >
            Delete this juice and its recipe
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/**
 * Reconciling bottles already made: choose the juice and the days (back to any date), tick the
 * batches, type what really went in (in total) and the water; the app shares it out over those
 * batches and can update the juice's recipe for 10 litres from the same sums.
 */
export function ReconcileForm({ productId, from, to, onClose }: { productId?: string; from?: string; to?: string; onClose: () => void }) {
  const { products, batches, items, actions, today } = useData();
  const j = useJuice();
  const notify = useNotice();
  const live = products.filter((p) => !p.archived);
  const [pid, setPid] = useState(productId ?? live[0]?.id ?? '');
  // Starts at the oldest bottles of the juice with nothing recorded about what went in (last 60 days), else a week back.
  const firstOpen = (id: string) => batches.filter((b) => b.productId === id && !(b.used ?? []).length && b.date >= addDays(today, -60) && b.date <= today).reduce((m, b) => (b.date < m ? b.date : m), addDays(today, -6));
  const [dFrom, setFrom] = useState(from ?? firstOpen(productId ?? live[0]?.id ?? ''));
  const [dTo, setTo] = useState(to ?? today);
  const list = batches.filter((b) => b.productId === pid && b.date >= dFrom && b.date <= dTo).sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(list.filter((b) => !(b.used ?? []).length).map((b) => b.id));
  const hasFruit = items.some((i) => !i.archived && i.kind === 'fruit');
  const [lines, setLines] = useState<RecipeName[]>([{ name: '', unit: 'pcs', qty: 0, isNew: !hasFruit }]);
  const [water, setWater] = useState(0);
  const [update, setUpdate] = useState(true);
  const { busy, error, run } = useSaver();
  const sel = list.filter((b) => chosen.has(b.id));
  const litres = sel.reduce((t, b) => t + (b.litres || 0), 0);
  const bottles = sel.reduce((t, b) => t + Object.values(b.filled ?? {}).reduce((x, n) => x + (n || 0), 0), 0);
  const per10 = (q: number) => (litres > 0 ? Math.round(((q || 0) * 10 * 1000) / litres) / 1000 : 0);
  const known = (n: string) => items.find((i) => i.name.trim().toLowerCase() === n.trim().toLowerCase());
  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const product = products.find((p) => p.id === pid);
  return (
    <Sheet
      wide
      title="Reconcile bottles made"
      onClose={onClose}
      footer={
        <SheetButtons>
          <Button
            busy={busy}
            onClick={() =>
              run(
                () => actions.reconcileBatches(pid, [...chosen], lines, water, update),
                (r) => {
                  notify(`What went in is recorded for ${r.batches} ${r.batches === 1 ? 'batch' : 'batches'} (${showQty(r.litres)} litres)${update ? `; ${product?.name ?? 'the'} recipe updated` : ''}`);
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
      <div className="space-y-4">
        <p className="text-sm text-muted">For bottles already counted (on the Day list or in Production) with nothing recorded about what went in. Choose the juice and the days, even past ones, then type everything that went into those bottles.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Juice">
            <Select
              options={live.map((p) => ({ value: p.id, label: p.name }))}
              value={pid}
              onChange={(e) => {
                setPid(e.target.value);
                if (!from) setFrom(firstOpen(e.target.value));
                setPicked(null);
              }}
            />
          </Field>
          <Field label="From">
            <DateInput
              value={dFrom}
              max={today}
              onChange={(v) => {
                setFrom(v);
                setPicked(null);
              }}
            />
          </Field>
          <Field label="To">
            <DateInput
              value={dTo}
              max={today}
              onChange={(v) => {
                setTo(v);
                setPicked(null);
              }}
            />
          </Field>
        </div>
        <div>
          <span className="label">Bottles made in those days</span>
          {list.length === 0 ? (
            <p className="rounded-xl bg-page px-3 py-2 text-sm text-muted">No bottles of {product?.name ?? 'this juice'} were recorded between {showDate(dFrom)} and {showDate(dTo)}. Count them on the Day list (Bottles made, on their day) or in Production first, or choose other days.</p>
          ) : (
            <div className="divide-y divide-line rounded-xl border border-line bg-card">
              {list.map((b) => (
                <label key={b.id} className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
                  <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={chosen.has(b.id)} onChange={() => toggle(b.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{showDay(b.date)}</span> · {Object.entries(b.filled ?? {}).map(([k, n]) => `${n} × ${j.sizeLabel(k)}`).join(', ') || 'not bottled'} · {showQty(b.litres)} L
                    <span className="block text-xs text-muted">{(b.used ?? []).length ? `Recorded: ${b.used.map((u) => `${showQty(u.qty)} ${items.find((i) => i.id === u.itemId)?.unit ?? ''} ${items.find((i) => i.id === u.itemId)?.name ?? '?'}`).join(', ')} (saving replaces it)` : 'Nothing recorded about what went in yet'}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>
        {sel.length > 0 && (
          <>
            <p className="rounded-xl bg-butter-soft px-3 py-2 text-sm">
              {sel.length} {sel.length === 1 ? 'batch' : 'batches'} · {bottles} bottles · <b className="num">{showQty(litres)} litres</b>. What went into all of them, together:
            </p>
            <IngredientRows lines={lines} setLines={setLines} qtyLabel="Used" />
            <Field label="Water used (litres)" className="max-w-56">
              <QtyInput value={water} onChange={setWater} />
            </Field>
            {lines.some((l) => l.name.trim() && l.qty > 0) && (
              <div className="rounded-xl bg-card px-3 py-2 text-sm">
                <p className="font-semibold">That is, for 10 litres:</p>
                <ul className="mt-1 list-disc pl-5">
                  {lines
                    .filter((l) => l.name.trim() && l.qty > 0)
                    .map((l, i) => (
                      <li key={i} className="num">
                        {showQty(per10(l.qty))} {known(l.name)?.unit ?? l.unit} {l.name.trim()}
                      </li>
                    ))}
                  {water > 0 && <li className="num">{showQty(per10(water))} litres water</li>}
                </ul>
              </div>
            )}
            <label className="flex min-h-11 items-center gap-3 py-1 text-[15px]">
              <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={update} onChange={(e) => setUpdate(e.target.checked)} />
              Make this {product?.name ?? 'the juice'}&apos;s recipe for 10 litres
            </label>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Deleting a juice: straight away when nothing refers to it; otherwise hide it, or move its history to another juice first. */
export function DeleteJuiceForm({ id, onClose }: { id: string; onClose: () => void }) {
  const { products, sales, orders, batches, actions } = useData();
  const notify = useNotice();
  const confirm = useConfirm();
  const p = products.find((x) => x.id === id);
  const others = products.filter((x) => x.id !== id && !x.archived);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const { busy, error, run } = useSaver();
  if (!p) return null;
  const nSales = sales.filter((s) => s.lines.some((l) => l.productId === id)).length;
  const nOrders = orders.filter((o) => o.lines.some((l) => l.productId === id)).length;
  const nBatches = batches.filter((b) => b.productId === id).length;
  const used = nSales + nOrders + nBatches > 0;
  const target = products.find((x) => x.id === to);
  return (
    <Sheet title={`Delete ${p.name}?`} onClose={onClose}>
      <FormError message={error} />
      {!used ? (
        <div className="space-y-3">
          <p className="text-[15px]">{p.name} has never been made, sold or ordered. Deleting it removes the juice and its recipe for good (its ingredients stay in Stock).</p>
          <Button variant="danger" icon={Trash2} busy={busy} className="w-full" onClick={() => run(() => actions.deleteProduct(id), () => (notify(`${p.name} deleted`), onClose()))}>
            Delete {p.name}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-[15px]">
            {p.name} is in {[nSales && `${nSales} ${nSales === 1 ? 'sale' : 'sales'}`, nOrders && `${nOrders} ${nOrders === 1 ? 'order' : 'orders'}`, nBatches && `${nBatches} ${nBatches === 1 ? 'batch' : 'batches'}`].filter(Boolean).join(', ')}, so those need a juice. Two ways:
          </p>
          <div className="rounded-xl border border-line bg-card p-3">
            <p className="font-semibold">Move them to another juice, then delete {p.name}</p>
            <p className="mb-2 text-sm text-muted">For a stand-in such as a juice from the Excel sheet, once the real juice exists. Amounts and payments stay exactly as they are.</p>
            {others.length === 0 ? (
              <p className="text-sm text-muted">Add the other juice first (Recipes and prices).</p>
            ) : (
              <>
                <Field label="Move to">
                  <Select options={others.map((x) => ({ value: x.id, label: x.name }))} value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
                <Button
                  variant="danger"
                  className="mt-3 w-full"
                  busy={busy}
                  onClick={async () => {
                    if (!(await confirm({ title: `Move to ${target?.name} and delete ${p.name}?`, body: `Every sale, order and batch of ${p.name} becomes ${target?.name}. This cannot be undone.`, yes: 'Move and delete', danger: true }))) return;
                    run(
                      () => actions.moveJuiceAndDelete(id, to),
                      () => {
                        notify(`${p.name} deleted; its history is now under ${target?.name}`);
                        onClose();
                      },
                    );
                  }}
                >
                  Move to {target?.name ?? '…'} and delete
                </Button>
              </>
            )}
          </div>
          <div className="rounded-xl border border-line bg-card p-3">
            <p className="font-semibold">Hide {p.name}</p>
            <p className="mb-2 text-sm text-muted">It leaves Sell, the Day list and new orders; its history stays as it is. It can be shown again (Recipes, Hidden).</p>
            <Button variant="plain" className="w-full" onClick={async () => (await actions.archiveProduct(id, true), notify(`${p.name} hidden`), onClose())}>
              Hide {p.name}
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
