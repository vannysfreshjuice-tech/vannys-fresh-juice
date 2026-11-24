// Settings: business details, bottle sizes and prices, lists, freshness rules, backup and restore.
// Only the fields a person changes are saved (defaults are never written back).
import { Download, Lock, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Card } from '../components/bits';
import { PinInput, ownerPinKey, useLock } from '../components/Lock';
import { Button, DateInput, Field, FormError, MoneyInput, PageHead, Select, TextArea, TextInput, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { readDeviceRecords } from '../data/localStore';
import { backupFileName, countRows, deleteAllOps, giveFile, makeBackup, readBackup, replaceOps, restoreOps } from '../lib/backup';
import { addDays, showDate, showDay } from '../lib/dates';
import { money } from '../lib/money';
import { startAgainPlan } from '../lib/startAgain';
import { OWNER_KEY, PIN_LENGTH, findPin, pinKeys, removeAllPins, removePin, setPin } from '../lib/pinLock';
import type { Settings as S, Size } from '../lib/types';

const lines = (t: string) => t.split('\n').map((x) => x.trim()).filter(Boolean);

function PinLock() {
  const { staff, staffById } = useData();
  const lock = useLock();
  const notify = useNotice();
  const confirm = useConfirm();
  const key = ownerPinKey(staff);
  const [mode, setMode] = useState<'' | 'set' | 'change' | 'off'>('');
  const [oldPin, setOld] = useState('');
  const [pin, setP] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, run, setError } = useSaver();
  const reset = () => {
    setMode('');
    setOld('');
    setP('');
    setAgain('');
    setError('');
  };
  const who = pinKeys().map((k) => (k === OWNER_KEY ? 'Owner' : (staffById.get(k)?.name ?? 'someone who has left')));
  const save = () =>
    run(async () => {
      if (mode === 'change' || mode === 'off') {
        const mine = await findPin(oldPin);
        if (mine !== key && mine !== OWNER_KEY) throw new Error('Your present PIN is not right.');
      }
      if (mode === 'off') {
        if (!(await confirm({ title: 'Turn the PIN lock off?', body: 'Every PIN on this phone is removed (the staff PINs too). Anyone holding the phone can then open the app.', yes: 'Turn off', danger: true }))) return;
        removeAllPins();
        lock.refresh();
        notify('The PIN lock is off', 'info');
        return reset();
      }
      if (pin !== again) throw new Error('The two PINs are not the same.');
      if (key !== OWNER_KEY) removePin(OWNER_KEY);
      await setPin(key, pin);
      lock.refresh();
      notify(mode === 'set' ? 'PIN set: the app now opens with your PIN' : 'PIN changed');
      reset();
    });
  return (
    <Card title="PIN lock" icon={<Lock size={18} className="text-accent-dark" aria-hidden />}>
      <FormError message={error} />
      {!lock.on ? (
        <p className="text-sm text-muted">Off. Set a PIN of {PIN_LENGTH} digits and the app opens only with it, and locks itself after 5 minutes away. You can then give each person their own PIN in Staff, so the PIN decides what they can open.</p>
      ) : (
        <p className="text-sm text-muted">
          On. The app opens with a PIN and locks after 5 minutes away. PINs set on this phone: <b>{who.join(', ')}</b>. Give the staff their PINs in Staff (open a person).
        </p>
      )}
      {mode === '' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {!lock.on ? (
            <Button icon={Lock} onClick={() => setMode('set')}>
              Set my PIN
            </Button>
          ) : (
            <>
              <Button variant="plain" onClick={lock.lock}>
                Lock now
              </Button>
              <Button variant="plain" onClick={() => setMode('change')}>
                Change my PIN
              </Button>
              <Button variant="danger" onClick={() => setMode('off')}>
                Turn off
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {(mode === 'change' || mode === 'off') && <PinInput label="Your present PIN" value={oldPin} onChange={setOld} />}
          {mode !== 'off' && (
            <div className="grid grid-cols-2 gap-3">
              <PinInput label={mode === 'change' ? 'New PIN' : `PIN (${PIN_LENGTH} digits)`} value={pin} onChange={setP} />
              <PinInput label="Type it again" value={again} onChange={setAgain} />
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="plain" onClick={reset}>
              Cancel
            </Button>
            <Button busy={busy} variant={mode === 'off' ? 'danger' : 'primary'} onClick={save}>
              {mode === 'off' ? 'Turn off the lock' : 'Save PIN'}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Cloud: the PIN is the person's own sign-in, the same on every phone. */
function CloudPin() {
  const lock = useLock();
  const cloud = lock.cloud!;
  const notify = useNotice();
  const confirm = useConfirm();
  const [changing, setChanging] = useState(false);
  const [oldPin, setOld] = useState('');
  const [pin, setP] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, run, setError } = useSaver();
  const reset = () => {
    setChanging(false);
    setOld('');
    setP('');
    setAgain('');
    setError('');
  };
  return (
    <Card title="Your PIN" icon={<Lock size={18} className="text-accent-dark" aria-hidden />}>
      <FormError message={error} />
      <p className="text-sm text-muted">
        Your PIN opens the app on any phone or laptop. The app locks after 5 minutes away.
        {cloud.isOwner && (
          <>
            {' '}
            Signed in as <b>{cloud.email}</b>; a forgotten PIN is reset by email. Give the staff their PINs in Staff (open a person).
          </>
        )}
      </p>
      {!changing ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="plain" onClick={lock.lock}>
            Lock now
          </Button>
          <Button variant="plain" onClick={() => setChanging(true)}>
            Change my PIN
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (await confirm({ title: 'Sign out of this phone?', body: 'The records stay safe in the cloud. The next time, this phone asks who is opening the app, with the internet. Use this on a phone you give away or no longer use.', yes: 'Sign out', danger: true })) await cloud.signOut();
            }}
          >
            Sign out of this phone
          </Button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <PinInput label="Your present PIN" value={oldPin} onChange={setOld} />
          <div className="grid grid-cols-2 gap-3">
            <PinInput label="New PIN" value={pin} onChange={setP} />
            <PinInput label="Type it again" value={again} onChange={setAgain} />
          </div>
          <p className="text-xs text-muted">Needs the internet. Your other phones then ask for the new PIN.</p>
          <div className="flex gap-2">
            <Button variant="plain" onClick={reset}>
              Cancel
            </Button>
            <Button
              busy={busy}
              onClick={() =>
                run(async () => {
                  if (pin !== again) throw new Error('The two PINs are not the same.');
                  await cloud.changePin(oldPin, pin);
                  notify('PIN changed');
                  reset();
                })
              }
            >
              Save PIN
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Business() {
  const { settings, actions } = useData();
  const notify = useNotice();
  const [f, setF] = useState({ businessName: settings.businessName, whatsapp: settings.whatsapp, phone: settings.phone, receiptNote: settings.receiptNote, merchantCode: settings.merchantCode, cardPay: settings.cardPay, airtelNumber: settings.airtelNumber });
  const { busy, error, run } = useSaver();
  return (
    <Card title="Business">
      <FormError message={error} />
      <div className="space-y-3">
        <Field label="Name">
          <TextInput value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="WhatsApp and calls">
            <TextInput inputMode="tel" value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} />
          </Field>
          <Field label="Phone">
            <TextInput inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </Field>
        </div>
        <Field label="Message at the bottom of receipts">
          <TextInput value={f.receiptNote} onChange={(e) => setF({ ...f, receiptNote: e.target.value })} />
        </Field>
        <Field label="Mobile money merchant code (optional)">
          <TextInput value={f.merchantCode} onChange={(e) => setF({ ...f, merchantCode: e.target.value })} />
        </Field>
        <p className="pt-1 text-sm font-semibold">On the statement card</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ways to pay">
            <TextInput value={f.cardPay} onChange={(e) => setF({ ...f, cardPay: e.target.value })} placeholder="Airtel Money · Cash" />
          </Field>
          <Field label="Airtel Money number">
            <TextInput inputMode="tel" value={f.airtelNumber} onChange={(e) => setF({ ...f, airtelNumber: e.target.value })} />
          </Field>
        </div>
        <p className="text-xs text-muted">The card shows the ways to pay, "WhatsApp & call" with the WhatsApp number above, and the Airtel Money number.</p>
        <Button busy={busy} onClick={() => run(() => actions.saveSettings(f), () => notify('Saved'))}>
          Save
        </Button>
      </div>
    </Card>
  );
}

function Sizes() {
  const { settings, actions, items } = useData();
  const notify = useNotice();
  const [sizes, setSizes] = useState<Size[]>(settings.sizes.map((s) => ({ ...s })));
  const [deposit, setDeposit] = useState(settings.bottleDeposit);
  const [perBottle, setPerBottle] = useState<string[]>(settings.perBottle);
  const { busy, error, run } = useSaver();
  const set = (i: number, patch: Partial<Size>) => setSizes((ss) => ss.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const bottles = items.filter((i) => i.kind === 'packaging' && !i.archived);
  return (
    <Card title="Bottle sizes and prices">
      <FormError message={error} />
      <p className="mb-3 rounded-xl bg-page px-3 py-2 text-xs text-muted">Filled in by Buying: a bottle bought with its size in the name (e.g. Bottles 500 ml) is linked to that size, and its cost becomes the price paid, plus the caps and labels every bottle uses. Change anything here if needed.</p>
      <div className="space-y-3">
        {sizes.map((s, i) => (
          <div key={s.key} className="rounded-xl border border-line p-3">
            <p className="mb-2 font-semibold">{s.label}</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Price">
                <MoneyInput value={s.price} onChange={(n) => set(i, { price: n })} />
              </Field>
              <Field label="Bottle, cap, label">
                <MoneyInput value={s.packCost} onChange={(n) => set(i, { packCost: n })} />
              </Field>
            </div>
            <Field label="Uses up this bottle from Stock" className="mt-2">
              <Select options={[{ value: '', label: 'None' }, ...bottles.map((b) => ({ value: b.id, label: b.name }))]} value={s.bottleItemId ?? ''} onChange={(e) => set(i, { bottleItemId: e.target.value })} />
            </Field>
          </div>
        ))}
        <div>
          <span className="label">Every bottle also uses one of</span>
          <div className="flex flex-wrap gap-2">
            {bottles
              .filter((b) => !sizes.some((s) => s.bottleItemId === b.id))
              .map((b) => (
                <label key={b.id} className="chip">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={perBottle.includes(b.id)} onChange={(e) => setPerBottle((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))} />
                  {b.name}
                </label>
              ))}
          </div>
        </div>
        <Field label="Deposit on a returnable bottle">
          <MoneyInput value={deposit} onChange={setDeposit} />
        </Field>
        <p className="text-xs text-muted">New prices apply to new sales and orders. Past sales keep the price they were sold at.</p>
        <Button busy={busy} onClick={() => run(() => actions.saveSettings({ sizes, bottleDeposit: deposit, perBottle }), () => notify('Prices saved'))}>
          Save prices
        </Button>
      </div>
    </Card>
  );
}

function Lists() {
  const { settings, actions } = useData();
  const notify = useNotice();
  const [methods, setMethods] = useState(settings.methods.join('\n'));
  const [groups, setGroups] = useState(settings.expenseGroups.join('\n'));
  const [fridges, setFridges] = useState(settings.fridges.join('\n'));
  const [checks, setChecks] = useState(settings.hygieneChecks.join('\n'));
  const [max, setMax] = useState(String(settings.fridgeMax));
  const [fridgeCheck, setFridgeCheck] = useState(settings.fridgeCheck);
  const { busy, error, run } = useSaver();
  const save = () => {
    const fields: Partial<S> = { methods: lines(methods), expenseGroups: lines(groups), fridges: lines(fridges), hygieneChecks: lines(checks), fridgeMax: Number(max.replace(',', '.')) || 5, fridgeCheck };
    return run(() => actions.saveSettings(fields), () => notify('Saved'));
  };
  return (
    <Card title="Lists and freshness">
      <FormError message={error} />
      <p className="mb-3 text-xs text-muted">One per line.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Ways of paying">
          <TextArea rows={4} value={methods} onChange={(e) => setMethods(e.target.value)} />
        </Field>
        <Field label="Expense groups">
          <TextArea rows={4} value={groups} onChange={(e) => setGroups(e.target.value)} />
        </Field>
        <Field label="Fridges">
          <TextArea rows={3} value={fridges} onChange={(e) => setFridges(e.target.value)} />
        </Field>
        <Field label="Fridge must stay at or below (°C)">
          <TextInput inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />
        </Field>
        <Field label="Hygiene checks before each batch" className="md:col-span-2">
          <TextArea rows={5} value={checks} onChange={(e) => setChecks(e.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-muted">How long each juice keeps is set on its recipe (Recipes and prices).</p>
      <label className="mt-3 flex items-start gap-3 rounded-xl bg-page px-3 py-2 text-[15px]">
        <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={fridgeCheck} onChange={(e) => setFridgeCheck(e.target.checked)} />
        <span>
          Sell only bottles recorded in the fridge
          <span className="block text-xs text-muted">On: every batch must be recorded in Production before its bottles can be sold. Off: sell even when production is not recorded (bottles from recorded batches are still taken first).</span>
        </span>
      </label>
      <Button className="mt-3" busy={busy} onClick={save}>
        Save
      </Button>
    </Card>
  );
}

function Backup() {
  const d = useData();
  const { ready, settingsRow, actions, storeKind } = d;
  const confirm = useConfirm();
  const notify = useNotice();
  const file = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState('');
  // Records saved on this phone before the app moved to the cloud (once added, the note hides this).
  const [moved, setMoved] = useState(() => localStorage.getItem('vannys.v1.moved') === '1');
  const deviceRecords = storeKind === 'cloud' && !moved ? readDeviceRecords() : {};
  const deviceCount = countRows(deviceRecords);
  const bringDevice = async () => {
    if (!ready) return setErr('Wait until the records have loaded.');
    if (!(await confirm({ title: 'Add the records saved on this phone?', body: `${deviceCount === 1 ? '1 record was' : `${deviceCount} records were`} saved on this phone before the app moved to the cloud. They will be added to the cloud records so every phone sees them.`, yes: 'Add them' }))) return;
    try {
      await actions.commitRaw(restoreOps(deviceRecords));
      localStorage.setItem('vannys.v1.moved', '1');
      setMoved(true);
      notify(deviceCount === 1 ? '1 record added' : `${deviceCount} records added`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const backup = async () => {
    if (!ready) return setErr('Wait until the records have loaded.');
    await giveFile(backupFileName(), JSON.stringify(makeBackup(d, settingsRow), null, 1), 'application/json');
  };
  const restore = async (f: File) => {
    setErr('');
    try {
      const b = readBackup(await f.text());
      const n = countRows(b.data);
      const made = showDate(b.madeAt.slice(0, 10));
      // Replace (the usual meaning of restore): the records go back to exactly what the backup holds.
      if (await confirm({ title: 'Replace the records with this backup?', body: `It holds ${n} records, made ${made}. Every sale, payment, batch, purchase, customer and other record here that is not in it is removed, so the records are exactly as they were then (staff and settings stay). A backup of the records as they are now is downloaded first.`, yes: 'Replace with the backup', danger: true, typeWord: 'REPLACE' })) {
        if (!ready) return setErr('Wait until the records have loaded.');
        await giveFile(`vannys-backup-before-restore-${d.today}.json`, JSON.stringify(makeBackup(d, settingsRow), null, 1), 'application/json');
        await actions.commitRaw(replaceOps(d, b.data));
        notify(`Records replaced with the backup of ${made}`);
        return;
      }
      if (!(await confirm({ title: 'Add the backup to the records instead?', body: `Its ${n} records are added; records with the same id are replaced and nothing is removed. Only for adding records from another phone: adding an old backup to newer records can count money twice.`, yes: 'Add them' }))) return;
      await actions.commitRaw(restoreOps(b.data));
      notify(`Added ${n} records`);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const wipe = async () => {
    if (!ready) return setErr('Wait until the records have loaded.');
    if (!(await confirm({ title: 'Delete all records?', body: 'Every sale, order, batch, purchase, customer and person is removed from this app. Settings stay. Download a backup first: this cannot be undone.', yes: 'Delete everything', danger: true, typeWord: 'DELETE' }))) return;
    await actions.commitRaw(deleteAllOps(d));
    notify('All records deleted', 'info');
  };
  return (
    <Card title="Backup">
      <FormError message={err} />
      <p className="mb-3 text-sm text-muted">
        {storeKind === 'device' ? 'Right now the records are kept on this device only. ' : 'The records are kept in the cloud and every phone sees the same. The free cloud plan keeps no backups of its own. '}A backup is one file with every record. Keep one every week somewhere safe (WhatsApp it to yourself, or save it to Drive).
      </p>
      {deviceCount > 0 && (
        <div className="mb-3 rounded-xl bg-butter-soft px-3 py-2">
          <p className="text-sm">{deviceCount === 1 ? '1 record was' : `${deviceCount} records were`} saved on this phone before the app moved to the cloud.</p>
          <Button small variant="plain" className="mt-2" onClick={bringDevice}>
            Add them to the cloud records
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button icon={Download} onClick={backup}>
          Download a backup
        </Button>
        <Button variant="plain" icon={Upload} onClick={() => file.current?.click()}>
          Restore a backup
        </Button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      </div>
      <StartAgain />
      <Button small variant="danger" className="mt-4" onClick={wipe}>
        Delete all records
      </Button>
    </Card>
  );
}

/**
 * Start again from a date: a backup is downloaded first, then everything dated before the day goes.
 * Money paid ahead is always carried over; what customers still owe is carried over unless unticked.
 */
function StartAgain() {
  const d = useData();
  const { ready, settingsRow, actions, today } = d;
  const confirm = useConfirm();
  const notify = useNotice();
  // the Saturday before this week: "the weekend's juice and this week's sales"
  const wd = new Date(`${today}T12:00:00`).getDay();
  const [cutoff, setCutoff] = useState(addDays(today, (wd === 0 ? -6 : 1 - wd) - 2));
  const [carry, setCarry] = useState(true);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState('');
  const plan = useMemo(() => (open && ready ? startAgainPlan(d, cutoff, carry, () => 'x') : null), [open, ready, d, cutoff, carry]);
  const cur = (n: number) => money(n, d.settings.currency);
  const words: Record<string, string> = { sales: 'sales', payments: 'payments', orders: 'orders', purchases: 'purchases', batches: 'batches', writeOffs: 'write-offs', counts: 'counts', expenses: 'expenses', attendance: 'attendance marks', wages: 'wage payments', readings: 'fridge readings', reminders: 'reminders' };
  const go = async () => {
    setErr('');
    if (!ready || !plan) return setErr('Wait until the records have loaded.');
    const total = Object.values(plan.removed).reduce((t, n) => t + n, 0);
    if (!(await confirm({ title: `Start again from ${showDay(cutoff)}?`, body: `${total} records dated before ${showDate(cutoff)} are removed for good. A backup file is downloaded first. ${carry ? `What customers still owe (${cur(plan.owedCarried)}) is kept as one line each` : `What customers still owe from before (${cur(plan.owedDropped)}) is NOT kept`}; money paid ahead (${cur(plan.aheadCarried)}) is kept.`, yes: 'Start again', danger: true, typeWord: 'START' }))) return;
    try {
      await giveFile(`vannys-backup-before-start-again-${today}.json`, JSON.stringify(makeBackup(d, settingsRow), null, 1), 'application/json');
      const done = await actions.startAgainFrom(cutoff, carry);
      notify(`Started again from ${showDay(cutoff)}: ${Object.values(done.removed).reduce((t, n) => t + n, 0)} old records removed`);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-line bg-page p-3">
      <button type="button" className="flex w-full items-center text-left font-semibold" onClick={() => setOpen(!open)}>
        <span className="flex-1">Start again from a date</span>
        <span className="text-sm text-accent-dark">{open ? 'Close' : 'Open'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          <FormError message={err} />
          <p className="text-sm text-muted">For a fresh start: removes every sale, payment, batch, purchase and other record dated before the day you choose. Customers, juices, recipes, stock items, suppliers, staff and settings stay. A backup file is downloaded first.</p>
          <Field label="Keep everything from" className="max-w-56">
            <DateInput value={cutoff} max={today} onChange={(v) => v && setCutoff(v)} />
          </Field>
          <label className="flex items-start gap-3 text-[15px]">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[var(--accent)]" checked={carry} onChange={(e) => setCarry(e.target.checked)} />
            <span>
              Keep what customers still owe from before
              <span className="block text-xs text-muted">One "owed from before" line for each customer, so it can still be collected. Untick to forget old debts.</span>
            </span>
          </label>
          {plan && (
            <div className="rounded-lg bg-card px-3 py-2 text-sm">
              <p className="font-semibold">Before {showDay(cutoff)}, this removes:</p>
              <p className="text-muted">
                {Object.entries(plan.removed)
                  .map(([k, n]) => `${n} ${words[k] ?? k}`)
                  .join(', ') || 'nothing'}
              </p>
              <p className="mt-1">
                {carry ? (
                  <>
                    Kept as owed from before: <b className="num">{cur(plan.owedCarried)}</b>
                  </>
                ) : (
                  <>
                    Old debts forgotten: <b className="num text-cherry">{cur(plan.owedDropped)}</b>
                  </>
                )}
                {' · '}money paid ahead kept: <b className="num">{cur(plan.aheadCarried)}</b>
              </p>
            </div>
          )}
          <Button variant="danger" onClick={go}>
            Start again from {showDay(cutoff)}
          </Button>
        </div>
      )}
    </div>
  );
}

function PinCard() {
  return useLock().cloud ? <CloudPin /> : <PinLock />;
}

export function SettingsPage() {
  return (
    <div>
      <PageHead title="Settings" eyebrow={`Version ${__APP_VERSION__}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PinCard />
        <Business />
        <Sizes />
        <Lists />
        <Backup />
      </div>
    </div>
  );
}
