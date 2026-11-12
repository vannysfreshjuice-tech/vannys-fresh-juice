// Making juice: a new batch, a batch's own window, bottling, writing off spoiled juice, and recipes.
import { Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { BatchBadge, JuiceBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Badge, Button, Choice, DateInput, Field, FormError, IconButton, Line, QtyInput, Select, Sheet, SheetButtons, TextInput, cx, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, showDate, showDay } from '../lib/dates';
import { batchCost, bottleCost, priceOf, recipeCostPerLitre, sizeOf } from '../lib/juice';
import { qty as showQty } from '../lib/money';
import { WRITE_OFF_REASONS, type ProductKind, type RecipeLine } from '../lib/types';

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
  const { actions, products, items, itemsById, levels, settings, today, staff, avgCosts, me } = useData();
  const j = useJuice();
  const notify = useNotice();
  const live = products.filter((p) => !p.archived);
  const [pid, setPid] = useState(productId ?? live[0]?.id ?? '');
  const product = live.find((p) => p.id === pid);
  const [litres, setLitres] = useState(10);
  const suggest = (l: number): Record<string, number> => {
    const out: Record<string, number> = {};
    const k = (key: string) => settings.sizes.find((s) => s.key === key);
    if (k('300') && k('500') && k('1000')) {
      out['300'] = Math.floor((l * 0.3) / 0.3);
      out['500'] = Math.floor((l * 0.5) / 0.5);
      out['1000'] = Math.floor(l * 0.2);
    }
    return out;
  };
  const [filled, setFilled] = useState<Record<string, number>>(suggest(10));
  const [bottleLater, setBottleLater] = useState(false);
  const recipeFor = (l: number, p = product): RecipeLine[] => (p?.recipe ?? []).map((r) => ({ itemId: r.itemId, qty: Math.round(((r.qty * l) / 10) * 1000) / 1000 }));
  const [used, setUsed] = useState<RecipeLine[]>(recipeFor(10));
  const makers = staff.filter((s) => !s.archived && (s.role === 'production' || s.role === 'owner')).map((s) => s.name);
  const [madeBy, setMadeBy] = useState(me?.name ?? makers[0] ?? '');
  const [date, setDate] = useState(today);
  const [checks, setChecks] = useState<string[]>([]);
  const { busy, error, run } = useSaver();

  const changeProduct = (id: string) => {
    setPid(id);
    setUsed(recipeFor(litres, live.find((p) => p.id === id)));
  };
  const changeLitres = (l: number) => {
    setLitres(l);
    setUsed(recipeFor(l));
    setFilled(suggest(l));
  };
  const fakeBatch = { id: '', number: '', date, productId: pid, litres, used, filled: bottleLater ? {} : filled, madeBy, bestBefore: '', checks, createdAt: 0, updatedAt: 0 };
  const cost = batchCost(fakeBatch, product, settings.sizes, avgCosts);
  const bottled = Object.entries(bottleLater ? {} : filled).reduce((t, [k, n]) => t + n * (sizeOf(settings.sizes, k)?.litres ?? 0), 0);

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
                () => actions.saveBatch({ date, productId: pid, litres, used, filled: bottleLater ? {} : filled, madeBy, checks }),
                () => {
                  notify(bottleLater ? 'Batch saved. Fill the bottles when ready.' : 'Batch saved: the bottles are in the fridge');
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
            <span className="label">Juice</span>
            <div className="flex flex-wrap gap-2">
              {live.map((p) => (
                <button key={p.id} type="button" className={cx('chip', p.id === pid && 'chip-on')} onClick={() => changeProduct(p.id)}>
                  {p.icon} {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Litres made">
              <QtyInput value={litres} onChange={changeLitres} />
            </Field>
            <Field label="Made by">
              <Select options={makers.length ? makers : ['']} value={madeBy} onChange={(e) => setMadeBy(e.target.value)} />
            </Field>
            <Field label="Date">
              <DateInput value={date} onChange={setDate} />
            </Field>
          </div>

          <div>
            <span className="label">What went in (change if you used more or less)</span>
            <div className="card divide-y divide-line px-3">
              {used.map((u, i) => {
                const it = itemsById.get(u.itemId);
                const have = levels.get(u.itemId)?.onHand ?? 0;
                return (
                  <div key={u.itemId} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{it?.name ?? 'Item no longer in the list'}</span>
                      <span className={cx('text-xs', have >= u.qty ? 'text-leaf' : 'text-cherry')}>
                        {have >= u.qty ? `have ${showQty(have)} ${it?.unit ?? ''}` : `only ${showQty(have)} ${it?.unit ?? ''} in stock`}
                      </span>
                    </span>
                    <QtyInput className="w-24" value={u.qty} onChange={(n) => setUsed((us) => us.map((x, n2) => (n2 === i ? { ...x, qty: n } : x)))} />
                    <span className="w-14 text-sm text-muted">{it?.unit}</span>
                  </div>
                );
              })}
              {product?.water ? (
                <div className="flex items-center justify-between py-2 text-sm text-muted">
                  <span>Clean water</span>
                  <span>{showQty((product.water * litres) / 10)} L</span>
                </div>
              ) : null}
              {!used.length && <p className="py-2 text-sm text-muted">This juice has no recipe yet. Add one on Recipes and prices to work out its cost.</p>}
            </div>
            {items.length === 0 && <p className="mt-1 text-xs text-muted">No fruit in Stock yet.</p>}
          </div>

          <div>
            <span className="label">Bottles filled</span>
            <Tick on={bottleLater} set={setBottleLater} text="Still being made: fill the bottles later" />
            {!bottleLater && (
              <>
                <BottleBoxes filled={filled} setFilled={setFilled} />
                <p className={cx('mt-1 text-sm', bottled > litres + 0.05 ? 'text-cherry' : 'text-muted')}>
                  Bottled {showQty(bottled)} of {showQty(litres)} litres
                </p>
              </>
            )}
          </div>

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
        <p className="text-muted">There is no juice in the fridge.</p>
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

const ICONS = ['🥭', '🍍', '🍉', '🍊', '🍋', '🍓', '🍌', '🍎', '🥕', '🥒', '🫐', '🟣', '🔴', '🍹', '🥤', '🌿'];
const COLOURS = ['#FFA41B', '#E9B800', '#E8445A', '#F7811E', '#8E3FA0', '#3BA935', '#C2571A', '#A3203F', '#2F8F3A', '#D33A55'];

export function ProductForm({ id, kind, onClose }: { id?: string; kind?: ProductKind; onClose: () => void }) {
  const { products, items, actions, settings, lastCosts, avgCosts } = useData();
  const j = useJuice();
  const notify = useNotice();
  const confirm = useConfirm();
  const p = id ? products.find((x) => x.id === id) : undefined;
  const fruit = items.filter((i) => !i.archived && i.kind === 'fruit');
  const [name, setName] = useState(p?.name ?? '');
  const [k, setK] = useState<ProductKind>(p?.kind ?? kind ?? 'cocktail');
  const [icon, setIcon] = useState(p?.icon ?? (k === 'cocktail' ? '🍹' : '🥭'));
  const [colour, setColour] = useState(p?.colour ?? COLOURS[0]);
  const [premium, setPremium] = useState(p?.premium ?? false);
  const [recipe, setRecipe] = useState<RecipeLine[]>(p?.recipe.map((r) => ({ ...r })) ?? (fruit[0] ? [{ itemId: fruit[0].id, qty: 0 }] : []));
  const [water, setWater] = useState(p?.water ?? 0);
  const [keeps, setKeeps] = useState(p?.keepsDays ?? 3);
  const [tag, setTag] = useState(p?.tag ?? '');
  const { busy, error, run } = useSaver();
  const costs = useMemo(() => new Map([...avgCosts, ...lastCosts]), [avgCosts, lastCosts]);
  const draft = { id: '', name, kind: k, icon, colour, premium, recipe, water, keepsDays: keeps, createdAt: 0, updatedAt: 0 };
  const perL = recipeCostPerLitre(draft, costs);
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
                if (!(await confirm({ title: p.archived ? `Show ${p.name} again?` : `Hide ${p.name}?`, body: p.archived ? undefined : 'It disappears from Sell, Production and new orders. Its history stays.', yes: p.archived ? 'Show' : 'Hide' }))) return;
                await actions.archiveProduct(p.id, !p.archived);
                onClose();
              }}
            >
              {p.archived ? 'Show again' : 'Hide'}
            </Button>
          )}
          <Button busy={busy} onClick={() => run(() => actions.saveProduct({ name, kind: k, icon, colour, premium, recipe, water, keepsDays: keeps, tag }, id), () => { notify('Saved'); onClose(); })}>
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
        <div>
          <span className="label">What goes into 10 litres</span>
          <div className="space-y-2">
            {recipe.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_auto] items-center gap-2">
                <Select options={fruit.map((f) => ({ value: f.id, label: `${f.name} (${f.unit})` }))} value={r.itemId} onChange={(e) => setRecipe((rs) => rs.map((x, n) => (n === i ? { ...x, itemId: e.target.value } : x)))} />
                <QtyInput value={r.qty} onChange={(q) => setRecipe((rs) => rs.map((x, n) => (n === i ? { ...x, qty: q } : x)))} />
                <IconButton icon={X} label="Remove" onClick={() => setRecipe((rs) => rs.filter((_, n) => n !== i))} />
              </div>
            ))}
          </div>
          {fruit.length > 0 ? (
            <Button small variant="soft" icon={Plus} className="mt-2" onClick={() => setRecipe((rs) => [...rs, { itemId: fruit[0].id, qty: 0 }])}>
              Add a fruit
            </Button>
          ) : (
            <p className="text-sm text-muted">Add fruit in Stock first.</p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Water (litres)">
            <QtyInput value={water} onChange={setWater} />
          </Field>
          <Field label="Keeps (days)">
            <TextInput inputMode="numeric" value={keeps ? String(keeps) : ''} onChange={(e) => setKeeps(Number(e.target.value.replace(/\D/g, '')) || 0)} />
          </Field>
          <Field label="Price">
            <Select options={[{ value: 'n', label: 'Normal' }, { value: 'p', label: 'Premium' }]} value={premium ? 'p' : 'n'} onChange={(e) => setPremium(e.target.value === 'p')} />
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
      </div>
    </Sheet>
  );
}
