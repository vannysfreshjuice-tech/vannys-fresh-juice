// Puts the PIN screen in front of the app when a PIN is set on this device: at start, and after
// 5 minutes in the background. The PIN typed says who is using the app (their part of the app).
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useData } from '../data/DataContext';
import type { Staff } from '../lib/types';
import { OWNER_KEY, PIN_LENGTH, awayTooLong, clearTries, findPin, lockIsOn, noteHidden, noteWrongTry } from '../lib/pinLock';
import { PinScreen } from './PinScreen';
import { Field, TextInput, useConfirm } from './ui';

/** Cloud only: the signed-in person's own sign-in, and (owner) the staff sign-ins. Errors are plain words. */
export interface CloudApi {
  isOwner: boolean;
  /** Owner: her email. Staff: empty (they sign in with their phone number). */
  email: string;
  changePin: (oldPin: string, newPin: string) => Promise<void>;
  /** Signs this person out of this device; the next person signs in with their own details. */
  signOut: () => Promise<void>;
  givePin: (person: Staff, phone: string, pin: string, everyone: Staff[]) => Promise<void>;
  removeAccess: (person: Staff) => Promise<void>;
}

export interface LockApi {
  /** A PIN is set on this device (always, in the cloud) */
  on: boolean;
  /** Show the PIN screen now */
  lock: () => void;
  /** Read the PINs again after Settings changed them */
  refresh: () => void;
  cloud?: CloudApi;
}

export const LockContext = createContext<LockApi>({ on: false, lock: () => {}, refresh: () => {} });
export const useLock = () => useContext(LockContext);

/** The owner's PIN belongs to the staff record marked Owner, or to the plain owner key when there is none. */
export const ownerPinKey = (staff: Staff[]) => staff.find((s) => !s.archived && s.role === 'owner')?.id ?? OWNER_KEY;

function ForgotPin() {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      className="min-h-11 text-sm font-medium text-accent-dark underline"
      onClick={() =>
        confirm({
          title: 'Forgot the PIN?',
          body: "If you forgot your own PIN, ask the owner to set a new one for you (Staff > your name). If the owner forgot theirs, ask the person who set up the app to reset the lock on this phone. Your records stay safe.",
          yes: 'OK',
        })
      }
    >
      Forgot the PIN?
    </button>
  );
}

export function LockGate({ children }: { children: ReactNode }) {
  const { setMe, staff, ready } = useData();
  const [on, setOn] = useState(lockIsOn);
  const [locked, setLocked] = useState(lockIsOn);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') noteHidden();
      else if (awayTooLong() && lockIsOn()) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const refresh = useCallback(() => {
    const o = lockIsOn();
    setOn(o);
    if (!o) setLocked(false);
  }, []);
  const lock = useCallback(() => {
    if (lockIsOn()) setLocked(true);
  }, []);

  const onPin = useCallback(
    async (pin: string): Promise<string> => {
      const who = await findPin(pin);
      if (!who) {
        noteWrongTry();
        return 'That PIN is not right.';
      }
      if (who !== OWNER_KEY) {
        const person = staff.find((s) => s.id === who);
        if (!person || person.archived) {
          noteWrongTry();
          return 'That PIN belongs to someone who has left.';
        }
      }
      clearTries();
      setMe(who === OWNER_KEY ? '' : who);
      setLocked(false);
      return '';
    },
    [staff, setMe],
  );

  if (on && locked) {
    // The staff list is needed to know who a PIN belongs to.
    if (!ready) return <div className="flex h-full items-center justify-center text-sm text-muted">Opening…</div>;
    return <PinScreen title="Enter your PIN" hint="Each person has their own PIN." onPin={onPin} footer={<ForgotPin />} />;
  }
  return <LockContext.Provider value={{ on, lock, refresh }}>{children}</LockContext.Provider>;
}

/** A 6-digit PIN box: numbers only, hidden as dots. */
export function PinInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <Field label={label}>
      <TextInput type="password" inputMode="numeric" autoComplete="new-password" maxLength={PIN_LENGTH} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))} className="num tracking-[0.4em]" />
    </Field>
  );
}
