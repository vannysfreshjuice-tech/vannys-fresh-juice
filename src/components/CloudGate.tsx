// The published app: records in the cloud, each person with their own sign-in.
// - Nobody signed in on this phone: "Who is opening the app?" The owner types her PIN (her email is
//   built in); staff type their phone number and PIN. This needs the internet once per phone.
// - Someone signed in: the app opens locked; their PIN opens it (checked on the phone after the first
//   time, so it works with no signal). It locks again after 5 minutes away.
// - "Someone else" signs the person out, so the next person signs in with their own details.
// The PIN is the person's Firebase password, so firestore.rules protects the records on the server.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DataProvider, type Identity } from '../data/DataContext';
import type { Store } from '../data/store';
import { ownerEmail } from '../firebase-config';
import { awayTooLong, checkCloudPin, clearTries, forgetCloudPin, noteHidden, noteWrongTry, rememberCloudPin } from '../lib/pinLock';
import { LockContext, PinInput, type CloudApi, type LockApi } from './Lock';
import { PinScreen } from './PinScreen';
import { Button, Field, FormError, TextInput, useConfirm, useNotice } from './ui';

type Cloud = typeof import('../data/cloud');
interface Member {
  uid: string;
  staffId: string;
}
const MEMBER_KEY = 'vannys.member';

function readMemberCache(uid: string): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(MEMBER_KEY) ?? 'null') as Member | null;
    return v?.uid === uid && v.staffId ? v.staffId : null;
  } catch {
    return null;
  }
}
function writeMemberCache(m: Member | null) {
  try {
    if (m) localStorage.setItem(MEMBER_KEY, JSON.stringify(m));
    else localStorage.removeItem(MEMBER_KEY);
  } catch {
    /* private mode */
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="pt-safe pb-safe flex h-full flex-col items-center justify-center overflow-y-auto px-6">
      <img src="./brand/logo.jpg" alt="Vanny's Fresh Juice" className="w-60 max-w-[70vw] rounded-2xl" />
      <div className="mt-6 w-full max-w-sm">{children}</div>
    </div>
  );
}

function Splash({ text }: { text: string }) {
  return (
    <Frame>
      <p className="text-center text-sm text-muted">{text}</p>
    </Frame>
  );
}

const linkCls = 'min-h-11 text-sm font-medium text-accent-dark underline';

function OwnerForgot({ cloud }: { cloud: Cloud }) {
  const confirm = useConfirm();
  const notify = useNotice();
  return (
    <button
      type="button"
      className={linkCls}
      onClick={async () => {
        if (!(await confirm({ title: 'Forgot the PIN?', body: `A link to set a new PIN will be emailed to ${ownerEmail}. Open it, type a new PIN of 6 digits as the new password, then come back and use the new PIN.`, yes: 'Send the link' }))) return;
        try {
          await cloud.sendOwnerReset();
          notify('The link has been sent. Check your email.', 'info');
        } catch (e) {
          notify(cloud.cloudMessage(e), 'bad');
        }
      }}
    >
      Forgot the PIN?
    </button>
  );
}

function StaffForgot() {
  const confirm = useConfirm();
  return (
    <button type="button" className={linkCls} onClick={() => confirm({ title: 'Forgot the PIN?', body: 'Ask the owner to give you a new PIN (Staff > your name > Give a new PIN). Your records stay safe.', yes: 'OK' })}>
      Forgot the PIN?
    </button>
  );
}

/** Nobody is signed in on this phone. `opened` is called with the sign-in id and the PIN that worked. */
function SignIn({ cloud, opened }: { cloud: Cloud; opened: (uid: string, pin: string) => void }) {
  const [step, setStep] = useState<'who' | 'owner' | 'setup' | 'phone' | 'staff'>('who');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const back = (
    <button type="button" className={linkCls} onClick={() => (setError(''), setStep('who'))}>
      Back
    </button>
  );
  const tryPin = (fn: (pin: string) => Promise<string>) => async (p: string) => {
    try {
      opened(await fn(p), p);
      return '';
    } catch (e) {
      const code = (e as { code?: string })?.code ?? '';
      if (code.includes('invalid-credential') || code.includes('wrong-password')) noteWrongTry();
      return cloud.cloudMessage(e);
    }
  };

  if (step === 'owner')
    return (
      <PinScreen
        title="Owner's PIN"
        hint="The first time on a phone needs the internet."
        onPin={tryPin(cloud.signInOwner)}
        footer={
          <div className="flex flex-col items-center gap-1">
            <OwnerForgot cloud={cloud} />
            <button type="button" className={linkCls} onClick={() => (setPin(''), setAgain(''), setError(''), setStep('setup'))}>
              First time? Set up the owner's PIN
            </button>
            {back}
          </div>
        }
      />
    );
  if (step === 'staff')
    return <PinScreen title="Your PIN" hint={`Phone ${phone}`} onPin={tryPin((p) => cloud.signInStaff(phone, p))} footer={<div className="flex flex-col items-center gap-1"><StaffForgot />{back}</div>} />;
  return (
    <Frame>
      {step === 'who' && (
        <>
          <h1 className="text-center text-xl font-semibold">Who is opening the app?</h1>
          <p className="mt-1 text-center text-sm text-muted">The first time on a phone needs the internet.</p>
          <div className="mt-5 grid gap-3">
            <Button onClick={() => setStep('owner')}>The owner</Button>
            <Button variant="plain" onClick={() => setStep('phone')}>
              I work at Vanny's
            </Button>
          </div>
        </>
      )}
      {step === 'phone' && (
        <>
          <h1 className="text-center text-xl font-semibold">Your phone number</h1>
          <p className="mt-1 text-center text-sm text-muted">The number the owner gave your PIN to.</p>
          <FormError message={error} />
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (phone.replace(/\D/g, '').length < 10) return setError('Type the full phone number, for example 0772 123456.');
              setError('');
              setStep('staff');
            }}
          >
            <Field label="Phone number">
              <TextInput inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0772 123456" />
            </Field>
            <Button type="submit" className="w-full">
              Next
            </Button>
          </form>
          <div className="mt-3 text-center">{back}</div>
        </>
      )}
      {step === 'setup' && (
        <>
          <h1 className="text-center text-xl font-semibold">Set up the owner's PIN</h1>
          <p className="mt-1 text-center text-sm text-muted">Only once, by the owner. Choose 6 digits that are hard to guess. A forgotten PIN can be reset by email ({ownerEmail}).</p>
          <FormError message={error} />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <PinInput label="PIN (6 digits)" value={pin} onChange={setPin} />
            <PinInput label="Type it again" value={again} onChange={setAgain} />
          </div>
          <Button
            className="mt-4 w-full"
            busy={busy}
            onClick={async () => {
              if (pin !== again) return setError('The two PINs are not the same.');
              setBusy(true);
              setError('');
              try {
                opened(await cloud.setUpOwner(pin), pin);
              } catch (e) {
                setError(cloud.cloudMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save the PIN
          </Button>
          <div className="mt-3 text-center">{back}</div>
        </>
      )}
    </Frame>
  );
}

function NoAccess({ onSignOut }: { onSignOut: () => void }) {
  return (
    <Frame>
      <h1 className="text-center text-xl font-semibold">No access</h1>
      <p className="mt-1 text-center text-sm text-muted">This sign-in can no longer open the records. If you still work at Vanny's, ask the owner to give you a new PIN.</p>
      <Button className="mt-5 w-full" onClick={onSignOut}>
        Sign out
      </Button>
    </Frame>
  );
}

export function CloudApp({ children }: { children: ReactNode }) {
  const notify = useNotice();
  const [cloud, setCloud] = useState<Cloud | null>(null);
  const [failed, setFailed] = useState(false);
  const [user, setUser] = useState<{ uid: string; email: string; isOwner: boolean } | null | undefined>(undefined);
  const [staffId, setStaffId] = useState<string | null | undefined>(undefined); // undefined = still finding out
  const [locked, setLocked] = useState(true);

  useEffect(() => {
    let stop = () => {};
    import('../data/cloud')
      .then((m) => {
        setCloud(m);
        stop = m.watchUser(setUser);
      })
      .catch(() => setFailed(true));
    return () => stop();
  }, []);

  // Which staff record a staff sign-in belongs to: from this phone's note at once, then from the cloud.
  useEffect(() => {
    if (!cloud || !user || user.isOwner) return setStaffId(user?.isOwner ? null : undefined);
    setStaffId(readMemberCache(user.uid) ?? undefined);
    return cloud.watchMember(
      user.uid,
      (m) => {
        writeMemberCache(m ? { uid: user.uid, staffId: m.staffId } : null);
        setStaffId(m ? m.staffId : null);
      },
      () => {}, // offline or refused: keep this phone's note; the rules still protect the records
    );
  }, [cloud, user]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') noteHidden();
      else if (awayTooLong()) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const opened = useCallback((uid: string, pin: string) => {
    clearTries();
    void rememberCloudPin(uid, pin);
    setLocked(false);
  }, []);

  const signOut = useCallback(async () => {
    forgetCloudPin();
    writeMemberCache(null);
    await cloud?.signOutDevice();
    window.location.reload();
  }, [cloud]);

  const unlock = useCallback(
    async (pin: string): Promise<string> => {
      if (!cloud || !user) return 'Still opening. Try again.';
      const ok = await checkCloudPin(user.uid, pin);
      if (ok === true) {
        clearTries();
        setLocked(false);
        return '';
      }
      if (ok === false) {
        noteWrongTry();
        return 'That PIN is not right.';
      }
      try {
        opened(await cloud.confirmPin(pin), pin);
        return '';
      } catch (e) {
        const code = (e as { code?: string })?.code ?? '';
        if (code.includes('invalid-credential') || code.includes('wrong-password')) noteWrongTry();
        return cloud.cloudMessage(e);
      }
    },
    [cloud, user, opened],
  );

  const api: CloudApi | undefined = useMemo(() => {
    if (!cloud || !user) return undefined;
    const plain = async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        throw new Error(cloud.cloudMessage(e));
      }
    };
    return {
      isOwner: user.isOwner,
      email: user.isOwner ? user.email : '',
      changePin: (oldPin, newPin) =>
        plain(async () => {
          await cloud.changePin(oldPin, newPin);
          await rememberCloudPin(user.uid, newPin);
        }),
      signOut,
      givePin: (person, phone, pin, everyone) => plain(() => cloud.giveStaffPin(person, phone, pin, everyone)),
      removeAccess: (person) => plain(() => cloud.removeStaffAccess(person)),
    };
  }, [cloud, user, signOut]);

  const store: Store | null = useMemo(() => (cloud && user ? cloud.makeCloudStore(user.isOwner) : null), [cloud, user]);
  const identity: Identity | null = useMemo(() => (user && staffId !== undefined ? { owner: user.isOwner, staffId } : null), [user, staffId]);
  const lockApi: LockApi = useMemo(() => ({ on: true, lock: () => setLocked(true), refresh: () => {}, cloud: api }), [api]);

  if (failed)
    return (
      <Frame>
        <p className="text-center font-semibold">The app could not start</p>
        <p className="mt-1 text-center text-sm text-muted">Check the connection and try again.</p>
        <Button className="mt-4 w-full" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </Frame>
    );
  if (!cloud || user === undefined) return <Splash text="Opening…" />;
  if (!user) return <SignIn cloud={cloud} opened={opened} />;
  if (!user.isOwner && staffId === null) return <NoAccess onSignOut={signOut} />;
  if (locked)
    return (
      <PinScreen
        title="Enter your PIN"
        onPin={unlock}
        footer={
          <div className="flex flex-col items-center gap-1">
            {user.isOwner ? <OwnerForgot cloud={cloud} /> : <StaffForgot />}
            <button type="button" className={linkCls} onClick={signOut}>
              Someone else
            </button>
          </div>
        }
      />
    );
  if (!identity || !store) return <Splash text="Opening…" />;
  return (
    <DataProvider store={store} identity={identity} onWriteError={(m) => notify(m, 'bad')}>
      <LockContext.Provider value={lockApi}>{children}</LockContext.Provider>
    </DataProvider>
  );
}
