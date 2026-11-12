// Settings: business details, bottle sizes and prices, lists, freshness rules, backup and restore.
// Only the fields a person changes are saved (defaults are never written back).
import { Download, Lock, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Card } from '../components/bits';
import { PinInput, ownerPinKey, useLock } from '../components/Lock';
import { Button, Field, FormError, MoneyInput, PageHead, Select, TextArea, TextInput, useConfirm, useNotice, useSaver } from '../components/ui';
import { useData } from '../data/DataContext';
import { backupFileName, countRows, deleteAllOps, giveFile, makeBackup, readBackup, restoreOps } from '../lib/backup';
import { showDate } from '../lib/dates';
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

function Business() {
  const { settings, actions } = useData();
  const notify = useNotice();
  const [f, setF] = useState({ businessName: settings.businessName, whatsapp: settings.whatsapp, phone: settings.phone, receiptNote: settings.receiptNote, merchantCode: settings.merchantCode });
  const { busy, error, run } = useSaver();
  return (
    <Card title="Business">
      <FormError message={error} />
      <div className="space-y-3">
        <Field label="Name">
          <TextInput value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="WhatsApp">
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
      <div className="space-y-3">
        {sizes.map((s, i) => (
          <div key={s.key} className="rounded-xl border border-line p-3">
            <p className="mb-2 font-semibold">{s.label}</p>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Price">
                <MoneyInput value={s.price} onChange={(n) => set(i, { price: n })} />
              </Field>
              <Field label="Premium price">
                <MoneyInput value={s.premiumPrice} onChange={(n) => set(i, { premiumPrice: n })} />
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
  const { busy, error, run } = useSaver();
  const save = () => {
    const fields: Partial<S> = { methods: lines(methods), expenseGroups: lines(groups), fridges: lines(fridges), hygieneChecks: lines(checks), fridgeMax: Number(max.replace(',', '.')) || 5 };
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
  const backup = async () => {
    if (!ready) return setErr('Wait until the records have loaded.');
    await giveFile(backupFileName(), JSON.stringify(makeBackup(d, settingsRow), null, 1), 'application/json');
  };
  const restore = async (f: File) => {
    setErr('');
    try {
      const b = readBackup(await f.text());
      const n = countRows(b.data);
      if (!(await confirm({ title: 'Restore this backup?', body: `It holds ${n} records, made ${showDate(b.madeAt.slice(0, 10))}. Records in it replace the same records here; nothing else is removed.`, yes: 'Restore' }))) return;
      await actions.commitRaw(restoreOps(b.data));
      notify(`Restored ${n} records`);
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
        {storeKind === 'device' ? 'Right now the records are kept on this device only. ' : ''}A backup is one file with every record. Keep one every week somewhere safe (WhatsApp it to yourself, or save it to Drive).
      </p>
      <div className="flex flex-wrap gap-2">
        <Button icon={Download} onClick={backup}>
          Download a backup
        </Button>
        <Button variant="plain" icon={Upload} onClick={() => file.current?.click()}>
          Restore a backup
        </Button>
        <input ref={file} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      </div>
      <Button small variant="danger" className="mt-4" onClick={wipe}>
        Delete all records
      </Button>
    </Card>
  );
}

export function SettingsPage() {
  return (
    <div>
      <PageHead title="Settings" eyebrow={`Version ${__APP_VERSION__}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <PinLock />
        <Business />
        <Sizes />
        <Lists />
        <Backup />
      </div>
    </div>
  );
}
