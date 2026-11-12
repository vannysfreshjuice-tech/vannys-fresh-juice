// The PIN screen: the logo, six dots and a number pad. It opens the app on the sixth digit.
// Keyboard typing works on a laptop.
import { Delete } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PIN_LENGTH, waitSeconds } from '../lib/pinLock';
import { cx } from './ui';

export function PinScreen({
  title,
  hint,
  onPin,
  footer,
}: {
  title: string;
  hint?: string;
  /** Returns an error message, or '' when the PIN opened the app. */
  onPin: (pin: string) => Promise<string>;
  footer?: React.ReactNode;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(waitSeconds());
  const [shake, setShake] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setInterval(() => setWait(waitSeconds()), 1000);
    return () => clearInterval(t);
  }, [wait]);

  const submit = useCallback(
    async (full: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      const message = await onPin(full).catch(() => 'Could not open. Try again.');
      busyRef.current = false;
      setBusy(false);
      if (message) {
        setError(message);
        setPin('');
        setShake(true);
        setTimeout(() => setShake(false), 400);
        setWait(waitSeconds());
      }
    },
    [onPin],
  );

  const press = useCallback(
    (d: string) => {
      if (busyRef.current || waitSeconds() > 0) return;
      setError('');
      setPin((p) => {
        if (p.length >= PIN_LENGTH) return p;
        const next = p + d;
        if (next.length === PIN_LENGTH) void submit(next);
        return next;
      });
    },
    [submit],
  );
  const back = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, back]);

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const blocked = wait > 0;
  return (
    <div className="pt-safe pb-safe flex h-full flex-col items-center justify-center overflow-y-auto px-6">
      <img src="./brand/logo.jpg" alt="Vanny's Fresh Juice" className="w-60 max-w-[70vw] rounded-2xl" />
      <h1 className="mt-4 text-center text-xl font-semibold">{title}</h1>
      {hint && <p className="mt-1 max-w-xs text-center text-sm text-muted">{hint}</p>}
      <div className={cx('mt-6 flex gap-3', shake && 'animate-[pin-shake_0.35s]')} aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`} role="status">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span key={i} className={cx('h-3.5 w-3.5 rounded-full border-2', i < pin.length ? 'border-accent bg-accent' : 'border-faint')} />
        ))}
      </div>
      <p role="alert" className="mt-3 min-h-10 max-w-xs text-center text-sm font-medium text-cherry">
        {blocked ? `Too many wrong tries. Try again in ${wait >= 60 ? `${Math.ceil(wait / 60)} min` : `${wait} s`}.` : busy ? <span className="text-muted">Checking…</span> : error}
      </p>
      <div className="mt-1 grid grid-cols-3 gap-4">
        {keys.map((k) => (
          <PadKey key={k} label={k} onPress={() => press(k)} disabled={busy || blocked} />
        ))}
        <span />
        <PadKey label="0" onPress={() => press('0')} disabled={busy || blocked} />
        <button type="button" aria-label="Delete last digit" onClick={back} disabled={busy || pin.length === 0} className="flex h-[72px] w-[72px] items-center justify-center rounded-full text-muted active:bg-line disabled:opacity-30">
          <Delete size={26} aria-hidden />
        </button>
      </div>
      {footer && <div className="mt-6 text-center">{footer}</div>}
    </div>
  );
}

function PadKey({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className="num flex h-[72px] w-[72px] items-center justify-center rounded-full bg-card text-[28px] font-medium shadow-sm ring-1 ring-line active:bg-accent-soft disabled:opacity-40"
    >
      {label}
    </button>
  );
}
