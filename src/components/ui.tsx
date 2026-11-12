// The app's small building blocks. Every page uses these, so buttons, fields and windows look and
// behave the same everywhere and suit a thumb on a phone (44px touch targets, no hover-only controls).
import { X, type LucideIcon } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { PERIOD_KEYS, PERIOD_NAMES, presetPeriod, todayYmd, type Period, type PeriodKey } from '../lib/dates';
import { fmt, money } from '../lib/money';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

// ---------- buttons ----------

type Variant = 'primary' | 'soft' | 'plain' | 'danger';

export function Button({
  children,
  variant = 'primary',
  small,
  icon: Icon,
  busy,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; small?: boolean; icon?: LucideIcon; busy?: boolean }) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={cx('btn', `btn-${variant}`, small && 'btn-sm', className)}>
      {Icon && <Icon size={small ? 16 : 18} aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string }) {
  return (
    <button type="button" aria-label={label} title={label} {...rest} className={cx('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page active:bg-line', className)}>
      <Icon size={20} aria-hidden />
    </button>
  );
}

// ---------- fields ----------

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" autoComplete="off" {...props} className={cx('input', props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx('input', props.className)} />;
}

export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[] }) {
  return (
    <select {...props} className={cx('input', props.className)}>
      {options.map((o) => {
        const v = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <option key={v.value} value={v.value}>
            {v.label}
          </option>
        );
      })}
    </select>
  );
}

/** Whole shillings, shown with commas as you type (1,200,000). The number keypad opens on a phone. */
export function MoneyInput({ value, onChange, className, ...rest }: { value: number; onChange: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value ? fmt(value) : '');
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value ? fmt(value) : '');
    }
  }, [value]);
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="0"
      {...rest}
      value={text}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 12);
        const n = digits ? Number(digits) : 0;
        last.current = n;
        setText(digits ? fmt(n) : '');
        onChange(n);
      }}
      className={cx('input num text-right', className)}
    />
  );
}

/** A quantity that may have a fraction (2.5). */
export function QtyInput({ value, onChange, className, ...rest }: { value: number; onChange: (n: number) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(value ? String(value) : '');
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      setText(value ? String(value) : '');
    }
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0"
      {...rest}
      value={text}
      onChange={(e) => {
        const t = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
        const n = Number(t);
        last.current = Number.isFinite(n) ? n : 0;
        setText(t);
        onChange(last.current);
      }}
      className={cx('input num text-right', className)}
    />
  );
}

export function DateInput({ value, onChange, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return <input type="date" {...rest} value={value} onChange={(e) => onChange(e.target.value)} className={cx('input', rest.className)} />;
}

/** A row of choices where one is on (filters, Pick up / Delivery). */
export function Choice<T extends string>({ options, value, onChange, scroll }: { options: readonly (T | { value: T; label: string; count?: number })[]; value: T; onChange: (v: T) => void; scroll?: boolean }) {
  return (
    <div className={cx('flex gap-2', scroll ? 'no-scrollbar -mx-4 overflow-x-auto px-4' : 'flex-wrap')} role="tablist">
      {options.map((o) => {
        const v = typeof o === 'string' ? { value: o, label: o as string, count: undefined } : o;
        const on = v.value === value;
        return (
          <button key={v.value} type="button" role="tab" aria-selected={on} onClick={() => onChange(v.value)} className={cx('chip', on && 'chip-on')}>
            {v.label}
            {v.count !== undefined && v.count > 0 && <span className={cx('num rounded-full px-1.5 text-xs', on ? 'bg-white/25' : 'bg-page')}>{v.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ---------- windows (sheets) ----------

/** The windows now open, bottom to top, so Escape closes only the one on top. */
const openSheets: string[] = [];

/** A window: slides up from the bottom on a phone, sits in the middle on a laptop. Escape closes it. */
export function Sheet({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId = useId();
  useEffect(() => {
    openSheets.push(titleId);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openSheets[openSheets.length - 1] === titleId) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = openSheets.lastIndexOf(titleId);
      if (i >= 0) openSheets.splice(i, 1);
    };
  }, [onClose, titleId]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="sheet-backdrop absolute inset-0 bg-ink/45" />
      <div className={cx('sheet-panel relative flex max-h-[94dvh] w-full flex-col rounded-t-3xl bg-page shadow-2xl md:max-h-[90dvh] md:rounded-3xl', wide ? 'md:max-w-2xl' : 'md:max-w-lg')}>
        <div className="flex items-center gap-2 border-b border-line py-2 pr-2 pl-5">
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-lg font-semibold">
            {title}
          </h2>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
        {footer && <div className="border-t border-line bg-card px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-b-3xl">{footer}</div>}
      </div>
    </div>
  );
}

export function SheetButtons({ children }: { children: ReactNode }) {
  return <div className="flex gap-2 [&>*]:flex-1">{children}</div>;
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-3 rounded-xl bg-cherry-soft px-3 py-2 text-sm font-medium text-cherry">
      {message}
    </p>
  );
}

/**
 * Runs a save once. The button is off while it runs, so a double tap cannot save twice,
 * and a refusal shows as a message instead of closing the window.
 */
export function useSaver() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const run = useCallback(async (fn: () => Promise<unknown>, done?: () => void) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
      done?.();
    } catch (e) {
      setError((e as Error).message || 'That could not be saved. Try again.');
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, error, run, setError };
}

// ---------- confirm ----------

interface ConfirmSpec {
  title: string;
  body?: string;
  yes: string;
  danger?: boolean;
  /** When set, the person must type this word before the button works (for wiping everything). */
  typeWord?: string;
}

const ConfirmContext = createContext<(spec: ConfirmSpec) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ spec: ConfirmSpec; resolve: (ok: boolean) => void } | null>(null);
  const [typed, setTyped] = useState('');
  const ask = useCallback((spec: ConfirmSpec) => new Promise<boolean>((resolve) => { setTyped(''); setState({ spec, resolve }); }), []);
  const answer = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {state && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 md:items-center" role="alertdialog" aria-modal="true">
          <div className="sheet-backdrop absolute inset-0 bg-ink/50" onClick={() => answer(false)} />
          <div className="sheet-panel relative w-full max-w-sm rounded-3xl bg-card p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">{state.spec.title}</h2>
            {state.spec.body && <p className="mt-2 text-[15px] leading-relaxed text-muted">{state.spec.body}</p>}
            {state.spec.typeWord && (
              <Field label={`Type ${state.spec.typeWord} to go ahead`} className="mt-3">
                <TextInput value={typed} onChange={(e) => setTyped(e.target.value)} autoCapitalize="characters" />
              </Field>
            )}
            <div className="mt-5 flex gap-2 [&>*]:flex-1">
              <Button variant="plain" onClick={() => answer(false)}>
                Cancel
              </Button>
              <Button variant={state.spec.danger ? 'danger' : 'primary'} disabled={!!state.spec.typeWord && typed.trim().toUpperCase() !== state.spec.typeWord} onClick={() => answer(true)}>
                {state.spec.yes}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

// ---------- notices (short messages at the top) ----------

type Tone = 'ok' | 'bad' | 'info';
const NoticeContext = createContext<(text: string, tone?: Tone) => void>(() => {});
export const useNotice = () => useContext(NoticeContext);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string; tone: Tone }[]>([]);
  const notify = useCallback((text: string, tone: Tone = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.filter((i) => i.text !== text), { id, text, tone }]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), tone === 'bad' ? 7000 : 2600);
  }, []);
  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={cx('sheet-panel max-w-sm rounded-2xl px-4 py-2.5 text-sm font-medium shadow-lg', i.tone === 'bad' ? 'bg-cherry text-white' : i.tone === 'info' ? 'bg-choc text-white' : 'bg-leaf text-white')}>
            {i.text}
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  );
}

// ---------- display ----------

type BadgeTone = 'pink' | 'green' | 'amber' | 'red' | 'grey' | 'brown';
const BADGE: Record<BadgeTone, string> = {
  pink: 'bg-accent-soft text-accent-dark',
  green: 'bg-leaf-soft text-leaf',
  amber: 'bg-amber-soft text-amber',
  red: 'bg-cherry-soft text-cherry',
  grey: 'bg-line text-muted',
  brown: 'bg-butter-soft text-choc',
};

export function Badge({ tone = 'grey', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap', BADGE[tone])}>{children}</span>;
}

export const payTone = (status: string): BadgeTone => (status === 'Paid' ? 'green' : status === 'Part paid' ? 'amber' : 'red');

export function StatCard({ label, value, sub, icon: Icon, tone = 'plain', onClick }: { label: string; value: string; sub?: string; icon?: LucideIcon; tone?: 'plain' | 'accent' | 'good' | 'warn'; onClick?: () => void }) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-sm font-medium text-muted">
        {Icon && (
          <span className={cx('flex h-7 w-7 items-center justify-center rounded-lg', tone === 'good' ? 'bg-leaf-soft text-leaf' : tone === 'warn' ? 'bg-amber-soft text-amber' : 'bg-accent-soft text-accent-dark')}>
            <Icon size={15} aria-hidden />
          </span>
        )}
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className={cx('num mt-2 text-xl font-semibold tracking-tight md:text-2xl', tone === 'accent' && 'text-accent-dark')}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="card p-4 text-left transition-colors hover:border-accent-line active:bg-page">
      {body}
    </button>
  ) : (
    <div className="card p-4">{body}</div>
  );
}

export function PageHead({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="text-sm text-muted">{eyebrow}</p>}
        <h1 className="truncate text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      </div>
      {action && <div className="shrink-0 [&_.btn]:max-md:min-h-9 [&_.btn]:max-md:rounded-lg [&_.btn]:max-md:px-3 [&_.btn]:max-md:text-sm">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-6 mb-2 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function Empty({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-dark">
        <Icon size={26} aria-hidden />
      </span>
      <p className="mt-3 font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A list inside a card, with thin lines between rows. */
export function List({ children }: { children: ReactNode }) {
  return <div className="card divide-y divide-line overflow-hidden">{children}</div>;
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <input type="search" inputMode="search" enterKeyHint="search" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className="input" />;
}

/** Label and figure on one line, for summaries. */
export function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'good' | 'bad' | 'muted' }) {
  return (
    <div className={cx('flex items-baseline justify-between gap-3 py-1.5', strong && 'font-semibold')}>
      <span className={cx(!strong && 'text-muted')}>{label}</span>
      <span className={cx('num text-right whitespace-nowrap', tone === 'good' && 'text-leaf', tone === 'bad' && 'text-cherry', tone === 'muted' && 'text-muted')}>{value}</span>
    </div>
  );
}

/** Thin bars for a breakdown (expenses by category). */
export function Bars({ rows, currency }: { rows: { label: string; amount: number; share: number; note?: string }[]; currency: string }) {
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium">
              {r.label}
              {r.note && <span className="ml-1.5 font-normal text-muted">{r.note}</span>}
            </span>
            <span className="num shrink-0">
              {money(r.amount, currency)} <span className="text-muted">{Math.round(r.share * 100)}%</span>
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.round(r.share * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- period ----------

export function usePeriod(initial: PeriodKey = 'thisMonth') {
  const [key, setKey] = useState<PeriodKey>(initial);
  const [custom, setCustom] = useState({ from: '', to: todayYmd() });
  const period: Period = useMemo(() => presetPeriod(key, todayYmd(), custom), [key, custom]);
  return { period, key, setKey, custom, setCustom };
}

export function PeriodPicker({ state }: { state: ReturnType<typeof usePeriod> }) {
  return (
    <div className="space-y-2">
      <Choice scroll options={PERIOD_KEYS.map((k) => ({ value: k, label: PERIOD_NAMES[k] }))} value={state.key} onChange={state.setKey} />
      {state.key === 'custom' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <DateInput value={state.custom.from} onChange={(from) => state.setCustom({ ...state.custom, from })} />
          </Field>
          <Field label="To">
            <DateInput value={state.custom.to} onChange={(to) => state.setCustom({ ...state.custom, to })} />
          </Field>
        </div>
      )}
    </div>
  );
}
