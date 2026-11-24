// The day list and the week sheet: who took juice each day and who has paid, like the owner's Excel sheet.
// Day: tap a regular's name to add one bottle (paid from money paid ahead when they have some, otherwise
// the way chosen above the names). Week: Monday to Friday side by side (Saturday and Sunday when used),
// a day with juice in yellow, a weekday without in red, names in blue when paid, green when paid ahead.
import { CalendarDays, ChevronLeft, ChevronRight, HandCoins, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Button, Choice, DateInput, Empty, IconButton, PageHead, QtyInput, Select, cx, useNotice } from '../components/ui';
import { useData } from '../data/DataContext';
import { addDays, showDay, weekdayShort } from '../lib/dates';
import { dayStock, daySummary, entryStatus, excelName, regulars, STATUS_WORDS, weekStart, type DayState, type EntryStatus } from '../lib/day';
import { linesValue, advancesAsOf } from '../lib/juice';
import { money } from '../lib/money';
import { DiscountControl, lastDiscount, payFor, useUsualJuice } from '../sheets/day';
import { useBalanceChecks } from '../components/BalanceChecks';

const NAME_TONE: Record<EntryStatus, string> = {
  paid: 'bg-sky-soft text-sky border-sky/20',
  ahead: 'bg-leaf-soft text-leaf border-leaf/20',
  part: 'bg-amber-soft text-amber border-amber/20',
  owed: 'bg-card text-cherry border-line',
};

const DAY_TONE: Record<DayState, string> = {
  supplied: 'bg-butter',
  none: 'bg-cherry text-white',
  today: 'bg-accent-soft text-ink',
  weekend: 'bg-page text-muted',
  later: 'bg-page text-faint',
  before: 'bg-page text-faint',
};

const DAY_WORDS: Record<DayState, string> = {
  supplied: 'Juice supplied',
  none: 'No juice this day',
  today: 'Nothing written yet today',
  weekend: 'Weekend, nothing written',
  later: 'Still to come',
  before: 'Before the first record',
};

export function DayList() {
  const { products, sales, today } = useData();
  const [view, setView] = useState<'Day' | 'Week'>('Day');
  const [day, setDay] = useState(today);
  const live = products.filter((p) => !p.archived);
  if (!live.length) return <Empty icon={CalendarDays} title="No juices yet" body="Add your juices on Recipes and prices (or from Home), then the day list can add bottles." />;
  const firstDay = sales.reduce((m, s) => (!m || s.date < m ? s.date : m), '');
  return (
    <div>
      <PageHead title="Day list" eyebrow="Who took juice, and who has paid" action={<Choice options={['Day', 'Week'] as const} value={view} onChange={setView} />} />
      {view === 'Day' ? <DayView day={day} setDay={setDay} firstDay={firstDay} /> : <WeekView day={day} setDay={setDay} firstDay={firstDay} openDay={(d) => (setDay(d), setView('Day'))} />}
      <Legend />
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
      <span className="rounded-md bg-butter px-2 py-1 text-ink">Day with juice</span>
      <span className="rounded-md bg-cherry px-2 py-1 text-white">Weekday without juice</span>
      <span className="rounded-md border border-sky/20 bg-sky-soft px-2 py-1 text-sky">Paid</span>
      <span className="rounded-md border border-leaf/20 bg-leaf-soft px-2 py-1 text-leaf">Paid from money paid ahead</span>
      <span className="rounded-md border border-line bg-card px-2 py-1 text-cherry">Not paid yet</span>
    </div>
  );
}

function DayView({ day, setDay, firstDay }: { day: string; setDay: (d: string) => void; firstDay: string }) {
  const { sales, orders, byRef, customersById, customerAdv, actions, settings, today, products, customers, payments } = useData();
  // what each customer had paid ahead at the end of the day shown (today: what they have now)
  const aheadThen = useMemo(() => (day >= today ? customerAdv : advancesAsOf(customers, orders, sales, payments, day)), [day, today, customerAdv, customers, orders, sales, payments]);
  const j = useJuice();
  const sheets = useSheets();
  const notify = useNotice();
  const usual = useUsualJuice();
  const [tapPay, setTapPay] = useState('On credit');
  const [tapDiscOn, setTapDiscOn] = useState(false);
  const [tapDisc, setTapDisc] = useState(lastDiscount);
  const [busyId, setBusyId] = useState('');
  const sum = daySummary(day, today, firstDay, sales, orders, byRef);
  const usualPrice = j.price(usual.productId, usual.size);
  const liveJuices = products.filter((p) => !p.archived);
  const regs = regulars(sales, day)
    .map((id) => customersById.get(id))
    .filter((c) => c && !c.archived);
  const later = day > today;
  const cur = (n: number) => money(n, settings.currency);

  const tap = async (customerId: string) => {
    const c = customersById.get(customerId);
    if (!c || busyId) return;
    setBusyId(customerId);
    try {
      const method = payFor(customerAdv.get(customerId) ?? 0, tapPay);
      // a customer's standing discount always applies; otherwise the tap discount when it is on
      const discount = Math.min(usualPrice, (c.discount ?? 0) > 0 ? (c.discount ?? 0) : tapDiscOn ? tapDisc : 0);
      await actions.saveSale({ date: day, lines: [{ productId: usual.productId, size: usual.size, qty: 1, price: usualPrice }], customerName: c.name, method, discount });
      notify(`${c.name}: 1 bottle${discount ? ` at ${cur(usualPrice - discount)} (${cur(discount)} off)` : ''}, ${method === 'On credit' ? 'not paid yet' : method}`);
    } catch (e) {
      notify((e as Error).message, 'info');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton icon={ChevronLeft} label="Day before" onClick={() => setDay(addDays(day, -1))} />
        <DateInput value={day} max={today} onChange={(v) => v && setDay(v)} className="max-w-44" />
        <IconButton icon={ChevronRight} label="Next day" disabled={day >= today} onClick={() => setDay(addDays(day, 1))} />
        {day !== today && (
          <Button small variant="plain" onClick={() => setDay(today)}>
            Today
          </Button>
        )}
      </div>

      <div className={cx('rounded-2xl px-4 py-3', DAY_TONE[sum.state])}>
        <p className="font-semibold">
          {showDay(day)} · {DAY_WORDS[sum.state]}
        </p>
        {sum.sales.length > 0 && (
          <p className="num text-sm">
            Sold {sum.bottles} {sum.bottles === 1 ? 'bottle' : 'bottles'} · {cur(sum.value)} · paid {cur(sum.paid)} · not paid {cur(sum.owed)}
          </p>
        )}
      </div>

      {!later && <MadeCard day={day} />}

      {!later && (
        <section className="card p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 font-semibold">Tap a name: 1 bottle</h2>
            <Button small variant="plain" icon={HandCoins} onClick={() => sheets.open({ t: 'receive' })}>
              Money received
            </Button>
            <Button small icon={Plus} onClick={() => sheets.open({ t: 'dayEntry', date: day })}>
              Someone else
            </Button>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">Each tap:</span>
            {liveJuices.length > 1 && (
              <Select aria-label="Juice for a tap" className="w-auto" options={liveJuices.map((p) => ({ value: p.id, label: p.name }))} value={usual.productId} onChange={(e) => usual.remember(e.target.value, usual.size)} />
            )}
            {liveJuices.length <= 1 && <span className="text-sm font-medium">{j.name(usual.productId)}</span>}
          </div>
          <Choice options={settings.sizes.map((s) => ({ value: s.key, label: `${s.label} · ${cur(j.price(usual.productId, s.key)).replace(`${settings.currency} `, '')}` }))} value={usual.size} onChange={(k) => usual.remember(usual.productId, k)} />
          <p className="mt-3 mb-2 text-sm text-muted">Paid:</p>
          <Choice options={['On credit', ...settings.methods.filter((m) => m !== 'Bank')].map((m) => ({ value: m, label: m === 'On credit' ? 'Not yet' : m }))} value={tapPay} onChange={setTapPay} />
          <div className="mt-3">
            <DiscountControl on={tapDiscOn} setOn={setTapDiscOn} amount={tapDisc} setAmount={setTapDisc} total={usualPrice} />
          </div>
          <p className="mt-1 text-xs text-muted">{day < today ? `The green amounts are what each customer had paid ahead at the end of ${showDay(day)}; a tap still pays from what they have now. ` : ''}Customers with money paid ahead (green) pay from it. A customer with a standing discount (shown on their name) always gets it. For more bottles, another juice or another price, use Someone else.</p>
          {regs.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Names you add appear here as quick buttons.</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {regs.map((c) => {
                const ahead = aheadThen.get(c!.id) ?? 0;
                return (
                  <button
                    key={c!.id}
                    type="button"
                    disabled={!!busyId}
                    onClick={() => tap(c!.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      sheets.open({ t: 'dayEntry', date: day, customerName: c!.name });
                    }}
                    className={cx('min-h-11 rounded-xl border px-3 py-2 text-left text-[15px] font-medium active:scale-95 disabled:opacity-50', ahead > 0 ? 'border-leaf/30 bg-leaf-soft' : 'border-line bg-page')}
                  >
                    {c!.name}
                    {ahead > 0 && <span className="num block text-[11px] text-leaf">{cur(ahead)} ahead</span>}
                    {(c!.discount ?? 0) > 0 && <span className="num block text-[11px] text-amber">− {cur(c!.discount ?? 0)} each</span>}
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 font-semibold">On {showDay(day)}</h2>
        {sum.sales.length === 0 ? (
          <p className="text-sm text-muted">Nobody yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sum.sales.map((s) => {
              const st = entryStatus(s, byRef.get(s.id));
              return (
                <button key={s.id} type="button" onClick={() => sheets.open({ t: 'saleView', id: s.id })} className={cx('flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-left', NAME_TONE[st])}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{excelName(s, (l) => j.price(l.productId, l.size))}</span>
                    <span className="block truncate text-xs opacity-75">{s.lines.map((l) => `${l.qty > 1 ? `${l.qty} × ` : ''}${j.name(l.productId)} ${j.sizeLabel(l.size)}`).join(', ')}</span>
                  </span>
                  <span className="text-xs">{STATUS_WORDS[st]}</span>
                  <span className="num w-20 text-right">{cur(linesValue(s.lines))}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">Tap a line to record a payment or undo it. A customer paying for several days at once: Customers, their name, Money received.</p>
      </section>
    </div>
  );
}

/** Bottles made that day (a quick count saved as a batch), and the day's fridge sum. */
function MadeCard({ day }: { day: string }) {
  const { products, batches, sales, orders, writeOffs, settings, actions, me, today, fridge } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const notify = useNotice();
  const usual = useUsualJuice();
  const live = products.filter((p) => !p.archived);
  const [chosenProduct, setProductId] = useState(usual.productId);
  const [chosenSize, setSize] = useState(usual.size);
  // the records may arrive after the page opens: fall back to the usual juice and size
  const productId = live.some((p) => p.id === chosenProduct) ? chosenProduct : usual.productId;
  const size = settings.sizes.some((s) => s.key === chosenSize) ? chosenSize : usual.size;
  const [bottles, setBottles] = useState(0);
  const [busy, setBusy] = useState(false);
  const made = batches.filter((b) => b.date === day).sort((a, b) => a.createdAt - b.createdAt);
  const st = dayStock(day, batches, sales, orders, writeOffs);
  const unrecorded = useBalanceChecks().filter((c) => c.what === 'sold' && c.date === day);
  // The oldest batch with bottles still in the fridge (made on or before this day): where "left" comes from.
  const oldestLeft = batches
    .filter((b) => b.date <= day && (fridge.get(b.id)?.total ?? 0) > 0)
    .reduce((m, b) => (!m || b.date < m ? b.date : m), '');
  const lastMade = batches.filter((b) => b.date < day).reduce((m, b) => (!m || b.date > m ? b.date : m), '');
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await actions.quickBatch({ date: day, productId, size, bottles, madeBy: me?.name });
      notify(`${bottles} bottles of ${j.name(productId)} added`);
      setBottles(0);
    } catch (e) {
      notify((e as Error).message, 'info');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card p-4">
      <h2 className="mb-2 font-semibold">Bottles in the fridge</h2>
      <div className="num mb-2 grid grid-cols-4 gap-1.5 text-center">
        <div className="rounded-xl bg-page px-1 py-2">
          <span className="block text-2xl font-bold">{st.before}</span>
          <span className="text-xs text-muted">left from before</span>
        </div>
        <div className="rounded-xl bg-page px-1 py-2">
          <span className="block text-2xl font-bold">+{st.made}</span>
          <span className="text-xs text-muted">made</span>
        </div>
        <div className="rounded-xl bg-page px-1 py-2">
          <span className="block text-2xl font-bold">−{st.sold + st.spoiled}</span>
          <span className="text-xs text-muted">{st.spoiled ? 'sold or went bad' : 'sold'}</span>
        </div>
        <div className={cx('rounded-xl px-1 py-2', st.left > 0 ? 'bg-butter-soft' : 'bg-page')}>
          <span className="block text-2xl font-bold">={st.left}</span>
          <span className="text-xs text-muted">{day === today ? 'left now' : 'left that evening'}</span>
          {st.left > 0 && st.left > st.made && oldestLeft && <span className="block text-[11px] text-muted">made {oldestLeft === day ? 'today' : `from ${showDay(oldestLeft)}`}</span>}
        </div>
      </div>
      <p className="num mb-3 text-center text-sm text-muted">
        {st.before} left from {day === today ? 'yesterday' : 'the day before'} + {st.made} made − {st.sold} sold{st.spoiled ? ` − ${st.spoiled} went bad` : ''} = <b className="text-ink">{st.left} left</b>
      </p>
      {st.unrecorded > 0 && (
        <p className="mb-3 rounded-lg bg-butter-soft px-3 py-2 text-sm">
          <b>{st.unrecorded} more sold with no bottles made recorded.</b> Add the bottles made {day === today ? 'today' : 'that day'} below: those sold come off them by themselves, so the fridge stays right. Tapped as the wrong juice? Change them:
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {unrecorded.map((c) => (
              <Button key={c.key} small variant="soft" onClick={() => sheets.open({ t: 'soldAs', productId: c.productId!, size: c.size!, date: day, qty: c.qty })}>
                {c.qty} × {j.name(c.productId!)} {j.sizeLabel(c.size!)}
              </Button>
            ))}
          </span>
        </p>
      )}
      {made.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {made.map((b) => (
            <button key={b.id} type="button" onClick={() => sheets.open({ t: 'batchView', id: b.id })} className="rounded-lg border border-line bg-page px-2.5 py-1.5 text-sm">
              {Object.entries(b.filled ?? {}).map(([k, n]) => `${n} × ${j.name(b.productId)} ${j.sizeLabel(k)}`).join(', ')}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_8rem_6rem_auto]">
        <Select aria-label="Juice" options={live.map((p) => ({ value: p.id, label: p.name }))} value={productId} onChange={(e) => setProductId(e.target.value)} />
        <Select aria-label="Size" options={settings.sizes.map((s) => ({ value: s.key, label: s.label }))} value={size} onChange={(e) => setSize(e.target.value)} />
        <QtyInput aria-label="Bottles made" value={bottles} onChange={(n) => setBottles(Math.max(0, Math.round(n)))} placeholder="Bottles" />
        <Button busy={busy} icon={Plus} disabled={bottles <= 0} onClick={add}>
          Add
        </Button>
      </div>
      {st.made === 0 && lastMade && (
        <p className="mb-2 rounded-lg bg-page px-3 py-2 text-sm text-muted">
          Nothing made {day === today ? 'today' : `on ${showDay(day)}`}. The last bottles were made on <b className="text-ink">{showDay(lastMade)}</b>: use ‹ above to see that day.
        </p>
      )}
      <p className="mt-2 text-xs text-muted">
        Type the bottles made {day === today ? 'today' : 'that day'} and tap Add. Bottles left roll over to the next day and are sold first. Tap a line above to change or delete it, or to write off spoiled bottles
        {st.spoiled > 0 ? ` (${st.spoiled} written off this day)` : ''}.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {made.length > 0 && (
          <Button small variant="plain" onClick={() => sheets.open({ t: 'reconcile', productId: made[0].productId, from: day, to: day })}>
            What went into these bottles?
          </Button>
        )}
        {st.left > 0 && (
          <Button small variant="plain" onClick={() => sheets.open({ t: 'writeOff' })}>
            Some went bad or were given away
          </Button>
        )}
      </div>
    </section>
  );
}

function WeekView({ day, setDay, firstDay, openDay }: { day: string; setDay: (d: string) => void; firstDay: string; openDay: (d: string) => void }) {
  const { sales, orders, batches, writeOffs, byRef, settings, today } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const mon = weekStart(day);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    return { ...daySummary(d, today, firstDay, sales, orders, byRef), stock: dayStock(d, batches, sales, orders, writeOffs) };
  });
  const shown = days.filter((d, i) => i < 5 || d.sales.length > 0 || d.stock.made > 0);
  const anyMade = days.some((d) => d.stock.made > 0);
  const cur = (n: number) => money(n, settings.currency);
  const total = { bottles: 0, value: 0, paid: 0, owed: 0, supplied: 0, none: 0, made: 0, spoiled: 0 };
  for (const d of days) {
    total.made += d.stock.made;
    total.spoiled += d.stock.spoiled;
    total.bottles += d.bottles;
    total.value += d.value;
    total.paid += d.paid;
    total.owed += d.owed;
    if (d.state === 'supplied') total.supplied += 1;
    if (d.state === 'none') total.none += 1;
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <IconButton icon={ChevronLeft} label="Week before" onClick={() => setDay(addDays(mon, -7))} />
        <span className="min-w-0 flex-1 text-center font-semibold">Week of {showDay(mon)}</span>
        <IconButton icon={ChevronRight} label="Next week" disabled={addDays(mon, 7) > today} onClick={() => setDay(addDays(mon, 7))} />
      </div>
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4">
        <div className="grid min-w-[36rem] gap-1.5" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
          {shown.map((d) => (
            <button key={d.day} type="button" onClick={() => openDay(d.day)} className={cx('rounded-lg px-1.5 py-1.5 text-center text-xs font-bold', DAY_TONE[d.state])}>
              {weekdayShort(d.day).toUpperCase()}
              <span className="block font-normal">{showDay(d.day).split(' ').slice(1, 3).join(' ')}</span>
            </button>
          ))}
          {shown.map((d) => (
            <div key={`${d.day}-n`} className="flex min-h-24 flex-col gap-1">
              {d.sales.map((s) => (
                <button key={s.id} type="button" onClick={() => sheets.open({ t: 'saleView', id: s.id })} className={cx('truncate rounded-md border px-1.5 py-1 text-left text-xs font-medium', NAME_TONE[entryStatus(s, byRef.get(s.id))])}>
                  {excelName(s, (l) => j.price(l.productId, l.size))}
                </button>
              ))}
            </div>
          ))}
          {shown.map((d) => (
            <div key={`${d.day}-t`} className="num border-t border-line pt-1 text-center text-[11px] text-muted">
              {anyMade && d.day <= today && (
                <span className="block text-ink">
                  {d.stock.before}+{d.stock.made}−{d.stock.sold + d.stock.spoiled} = {d.stock.left} left
                </span>
              )}
              {d.sales.length ? (
                <>
                  sold {d.bottles}
                  <span className="block">{cur(d.value).replace(`${settings.currency} `, '')}</span>
                  {d.owed > 0 && <span className="block text-cherry">owed {cur(d.owed).replace(`${settings.currency} `, '')}</span>}
                </>
              ) : (
                ' '
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="card num grid grid-cols-2 gap-x-4 gap-y-1 p-4 text-sm sm:grid-cols-4">
        <span>
          Days with juice: <b>{total.supplied}</b>
          {total.none > 0 && <span className="text-cherry"> · without: {total.none}</span>}
        </span>
        <span>
          {anyMade && (
            <>
              Made: <b>{total.made}</b> ·{' '}
            </>
          )}
          Sold: <b>{total.bottles}</b> · {cur(total.value)}
          {total.spoiled > 0 && <span className="text-cherry"> · spoiled {total.spoiled}</span>}
        </span>
        <span className="text-sky">
          Paid: <b>{cur(total.paid)}</b>
        </span>
        <span className="text-cherry">
          Not paid: <b>{cur(total.owed)}</b>
        </span>
      </div>
      <p className="text-xs text-muted">Tap a day to open it, or a name to see that sale. Saturday and Sunday show when juice was sold on them.</p>
    </div>
  );
}
