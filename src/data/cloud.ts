// Cloud records: one shared set of records at biz/vannys/{collection}/{id} in Firestore, opened by
// each person with their own sign-in. Their PIN is their password, so Firebase's servers check it
// (and slow down guessing); firestore.rules lets in only the owner and the staff she gave a PIN.
// This file is loaded only in the published app (and the emulator test), so dev stays small.
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  initializeFirestore,
  onSnapshot,
  persistentLocalCache,
  persistentMultipleTabManager,
  writeBatch,
  type DocumentReference,
} from 'firebase/firestore';
import { cloudConfig, ownerEmail, staffDomain, useEmulator } from '../firebase-config';
import { easyPin, validPin } from '../lib/pinLock';
import { waNumber } from '../lib/reminders';
import type { Staff } from '../lib/types';
import { ACCESS_COLS, accessRemoval, clean, type Op, type Row, type Store } from './store';

if (!cloudConfig) throw new Error('Cloud records are not set up.');
const config = cloudConfig;

const app = initializeApp(config);
const auth = getAuth(app);
// A copy of the records is kept on the device, so the app opens and saves with no signal
// and sends the changes when the connection returns.
const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
  ...(useEmulator ? {} : { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }),
});
const AUTH_EMULATOR = 'http://127.0.0.1:9099';
if (useEmulator) {
  connectAuthEmulator(auth, AUTH_EMULATOR, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  console.info('[dev] Using the local test copy (emulators), not the real cloud.');
}

/** Only the owner reads wages (firestore.rules says the same); others get an empty list. */
const OWNER_ONLY_READ = new Set<string>(['wages']);

const ref = (col: string, id: string): DocumentReference =>
  (ACCESS_COLS as readonly string[]).includes(col) ? doc(db, col, id) : doc(db, 'biz', 'vannys', col, id);

export interface CloudUser {
  uid: string;
  email: string;
  isOwner: boolean;
}

export function watchUser(cb: (user: CloudUser | null) => void): () => void {
  return onAuthStateChanged(auth, (u: User | null) => cb(u ? { uid: u.uid, email: u.email ?? '', isOwner: (u.email ?? '').toLowerCase() === ownerEmail } : null));
}

/** Which staff record a staff sign-in belongs to. null = no access (never given, or taken away). */
export async function readMember(uid: string): Promise<{ staffId: string; name: string } | null> {
  const snap = await getDoc(doc(db, 'members', uid));
  if (!snap.exists()) return null;
  const d = snap.data() as { staffId?: string; name?: string };
  return d.staffId ? { staffId: d.staffId, name: d.name ?? '' } : null;
}

/** Watches the person's access, so someone who has left is locked out at once. */
export function watchMember(uid: string, cb: (m: { staffId: string; name: string } | null) => void, onError: () => void): () => void {
  return onSnapshot(
    doc(db, 'members', uid),
    (snap) => {
      const d = snap.exists() ? (snap.data() as { staffId?: string; name?: string }) : null;
      cb(d?.staffId ? { staffId: d.staffId, name: d.name ?? '' } : null);
    },
    onError,
  );
}

const err = (code: string) => Object.assign(new Error(code), { code });

export async function signInOwner(pin: string): Promise<string> {
  return (await signInWithEmailAndPassword(auth, ownerEmail, pin)).user.uid;
}

/** The signed-in person types their PIN on a device that has no fingerprint of it yet: Firebase checks it. */
export async function confirmPin(pin: string): Promise<string> {
  const email = auth.currentUser?.email;
  if (!email) throw err('auth/no-current-user');
  return (await signInWithEmailAndPassword(auth, email, pin)).user.uid;
}

/** The very first time: makes the owner's sign-in with the PIN she chooses. */
export async function setUpOwner(pin: string): Promise<string> {
  if (!validPin(pin)) throw err('app/short-pin');
  if (easyPin(pin)) throw err('app/easy-pin');
  return (await createUserWithEmailAndPassword(auth, ownerEmail, pin)).user.uid;
}

/** Staff: their phone number says which sign-in it is (logins/{phone}), the PIN is its password. */
export async function signInStaff(phone: string, pin: string): Promise<string> {
  const key = waNumber(phone);
  if (key.length < 12) throw err('app/bad-phone');
  const snap = await getDoc(doc(db, 'logins', key));
  const email = snap.exists() ? (snap.data() as { email?: string }).email : '';
  if (!email) throw err('app/no-login');
  return (await signInWithEmailAndPassword(auth, email, pin)).user.uid;
}

/** Changes the person's own PIN. Firebase then asks the new PIN on their other devices. */
export async function changePin(oldPin: string, newPin: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw err('auth/no-current-user');
  if (!validPin(newPin)) throw err('app/short-pin');
  if (easyPin(newPin)) throw err('app/easy-pin');
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, oldPin));
  await updatePassword(user, newPin);
}

/** Owner's forgotten PIN: Firebase emails her a link to set a new one. */
export async function sendOwnerReset(): Promise<void> {
  await sendPasswordResetEmail(auth, ownerEmail);
}

/** Signs this person out of this device (the next person signs in with their own phone number or email). */
export async function signOutDevice(): Promise<void> {
  await fbSignOut(auth);
}

/**
 * Owner only: gives a staff member their own sign-in with the PIN the owner types, and closes the old
 * one if they had one (a new PIN for someone who forgot theirs). The account is made on a second,
 * separate connection so the owner stays signed in. Waits for the cloud, so the owner knows it worked.
 */
export async function giveStaffPin(person: Staff, phone: string, pin: string, everyone: Staff[]): Promise<void> {
  if (!auth.currentUser || (auth.currentUser.email ?? '').toLowerCase() !== ownerEmail) throw err('app/not-owner');
  const key = waNumber(phone);
  if (key.length < 12) throw err('app/bad-phone');
  if (everyone.some((s) => s.id !== person.id && !s.archived && s.loginPhone === key)) throw err('app/phone-taken');
  if (!validPin(pin)) throw err('app/short-pin');
  if (easyPin(pin)) throw err('app/easy-pin');

  const email = `${person.id.toLowerCase()}.${Date.now().toString(36)}@${staffDomain}`;
  const maker = initializeApp(config, `maker-${Date.now()}`);
  let uid = '';
  try {
    const makerAuth = getAuth(maker);
    if (useEmulator) connectAuthEmulator(makerAuth, AUTH_EMULATOR, { disableWarnings: true });
    await setPersistence(makerAuth, inMemoryPersistence);
    uid = (await createUserWithEmailAndPassword(makerAuth, email, pin)).user.uid;
    await fbSignOut(makerAuth);
  } finally {
    await deleteApp(maker).catch(() => {});
  }

  const ops: Op[] = [
    ...accessRemoval(person).filter((o) => !(o.col === 'logins' && o.id === key)),
    { op: 'set', col: 'members', id: uid, data: { staffId: person.id, name: person.name, at: new Date().toISOString() } },
    { op: 'set', col: 'logins', id: key, data: { email } },
    { op: 'patch', col: 'staff', id: person.id, data: { loginUid: uid, loginPhone: key, ...(person.phone ? {} : { phone }), updatedAt: new Date().toISOString() } },
  ];
  await commitNow(ops);
}

/** Owner only: closes a staff member's sign-in without marking them as left. */
export async function removeStaffAccess(person: Staff): Promise<void> {
  await commitNow([...accessRemoval(person), { op: 'patch', col: 'staff', id: person.id, data: { loginUid: '', loginPhone: '', updatedAt: new Date().toISOString() } }]);
}

async function commitNow(ops: Op[]): Promise<void> {
  const batch = writeBatch(db);
  for (const o of ops) {
    const r = ref(o.col, o.id);
    if (o.op === 'delete') batch.delete(r);
    else if (o.op === 'set') batch.set(r, clean(o.data));
    else batch.set(r, clean(o.data), { merge: true });
  }
  await batch.commit();
}

/** Plain words for what Firebase reports. */
export function cloudMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('invalid-login')) return 'That PIN is not right.';
  if (code.includes('too-many-requests')) return 'Too many wrong tries. Wait a few minutes, then try again.';
  if (code.includes('network') || code.includes('unavailable')) return 'No connection. Signing in on a phone the first time needs the internet.';
  if (code === 'app/bad-phone') return 'Type the full phone number, for example 0772 123456.';
  if (code === 'app/no-login') return 'That phone number has no PIN yet. Ask the owner to give you one (Staff > your name).';
  if (code === 'app/phone-taken') return 'Someone else already signs in with that phone number.';
  if (code === 'app/short-pin' || code.includes('weak-password')) return 'The PIN must be 6 digits.';
  if (code === 'app/easy-pin') return 'That PIN is too easy to guess. Choose another.';
  if (code === 'app/not-owner') return 'Only the owner can do this.';
  if (code.includes('email-already-in-use')) return "The owner's PIN is already set up. Use it, or tap Forgot the PIN.";
  if (code.includes('user-not-found') || code.includes('user-disabled')) return 'This sign-in is not set up.';
  if (code.includes('requires-recent-login')) return 'Type your present PIN again, then the new one.';
  if (code.includes('permission-denied')) return 'You do not have access to this. Ask the owner.';
  return 'That did not work. Try again.';
}

export function makeCloudStore(isOwner: boolean): Store {
  const store: Store = {
    kind: 'cloud',
    subscribe(col, onRows, onError) {
      if (!isOwner && OWNER_ONLY_READ.has(col)) {
        queueMicrotask(() => onRows([], { fromCache: false, pending: false }));
        return () => {};
      }
      return onSnapshot(
        collection(db, 'biz', 'vannys', col),
        { includeMetadataChanges: true },
        (snap) => {
          const rows = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as Row);
          onRows(rows, { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites });
        },
        (e) => onError(e),
      );
    },
    async commit(ops: Op[]) {
      // Firestore takes at most 500 changes in one go; only a restore or "delete all" is ever that big.
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        for (const o of ops.slice(i, i + 400)) {
          const r = ref(o.col, o.id);
          if (o.op === 'delete') batch.delete(r);
          else if (o.op === 'set') batch.set(r, clean(o.data));
          else batch.set(r, clean(o.data), { merge: true });
        }
        // Not awaited: the change is already kept on the device and shows at once. The promise only
        // settles when the cloud answers, which with no signal could be hours away.
        batch.commit().catch((e: Error) => store.onWriteError?.(Object.assign(new Error(cloudMessage(e)), { code: (e as { code?: string }).code })));
      }
    },
  };
  return store;
}
