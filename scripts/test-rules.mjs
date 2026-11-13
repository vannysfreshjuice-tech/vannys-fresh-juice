// Proves firestore.rules on the local EMULATOR (never the real cloud): who can read and write what.
// Run with:  npm run test:rules   (starts the emulators, runs this, stops them)
// The accounts and PINs here are throwaway test values that exist only inside the emulator.
import { deleteApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { connectFirestoreEmulator, deleteDoc, doc, getDoc, getDocs, collection, getFirestore, setDoc } from 'firebase/firestore';

const PROJECT = 'demo-vannys';
const OWNER = 'vanessaklarisa@gmail.com'; // the same address as firestore.rules and src/firebase-config.ts
const STAFF = 'aisha.test@staff.vanny-s-fresh-juice.firebaseapp.com';
const STRANGER = 'stranger.test@example.test';
const PIN = '246810';

const probe = await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT}/config`).catch(() => null);
if (!probe?.ok) {
  console.error('The Auth emulator is not running on 127.0.0.1:9099. Use: npm run test:rules');
  process.exit(1);
}

let n = 0;
const apps = [];
function person(name) {
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com`, appId: 'demo' }, `${name}-${n++}`);
  apps.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const db = getFirestore(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8085);
  return { auth, db };
}
async function account(p, email) {
  try {
    return (await createUserWithEmailAndPassword(p.auth, email, PIN)).user.uid;
  } catch {
    return (await signInWithEmailAndPassword(p.auth, email, PIN)).user.uid;
  }
}

let failed = 0;
async function expect(label, allowed, fn) {
  let ok;
  try {
    await fn();
    ok = true;
  } catch (e) {
    if (!String(e?.code ?? e).includes('permission-denied')) throw e;
    ok = false;
  }
  const pass = ok === allowed;
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}: ${ok ? 'allowed' : 'refused'}`);
}

const biz = (db, col, id) => doc(db, 'biz', 'vannys', col, id);

const owner = person('owner');
const staff = person('staff');
const stranger = person('stranger');
const nobody = person('nobody');

const ownerUid = await account(owner, OWNER);
const staffUid = await account(staff, STAFF);
await account(stranger, STRANGER);
console.log('Accounts ready (owner, staff, stranger).');

// The owner, before giving anyone access
await expect('owner writes an order', true, () => setDoc(biz(owner.db, 'orders', 'o1'), { number: 'VF-0001' }));
await expect('owner writes a staff record', true, () => setDoc(biz(owner.db, 'staff', 's1'), { name: 'Aisha', role: 'sales' }));
await expect('owner writes settings', true, () => setDoc(biz(owner.db, 'settings', 'main'), { businessName: "Vanny's" }));
await expect('owner writes a wage', true, () => setDoc(biz(owner.db, 'wages', 'w1'), { amount: 10000 }));
await expect('owner reads wages', true, () => getDocs(collection(owner.db, 'biz', 'vannys', 'wages')));
await expect('staff (no PIN given yet) reads orders', false, () => getDocs(collection(staff.db, 'biz', 'vannys', 'orders')));

// The owner gives the staff member a PIN
await expect('owner gives access (members)', true, () => setDoc(doc(owner.db, 'members', staffUid), { staffId: 's1', name: 'Aisha' }));
await expect('owner writes the phone lookup', true, () => setDoc(doc(owner.db, 'logins', '256772000001'), { email: STAFF }));

// Nobody signed in
await expect('nobody reads orders', false, () => getDocs(collection(nobody.db, 'biz', 'vannys', 'orders')));
await expect('nobody writes an order', false, () => setDoc(biz(nobody.db, 'orders', 'x'), { number: 'X' }));
await expect('nobody looks up one phone number', true, () => getDoc(doc(nobody.db, 'logins', '256772000001')));
await expect('nobody lists the phone numbers', false, () => getDocs(collection(nobody.db, 'logins')));
await expect('nobody reads a member', false, () => getDoc(doc(nobody.db, 'members', staffUid)));

// The staff member
await expect('staff reads orders', true, () => getDocs(collection(staff.db, 'biz', 'vannys', 'orders')));
await expect('staff writes a sale', true, () => setDoc(biz(staff.db, 'sales', 'sa1'), { number: 'S-1' }));
await expect('staff reads settings', true, () => getDoc(biz(staff.db, 'settings', 'main')));
await expect('staff changes settings', false, () => setDoc(biz(staff.db, 'settings', 'main'), { businessName: 'X' }, { merge: true }));
await expect('staff changes a staff record', false, () => setDoc(biz(staff.db, 'staff', 's1'), { role: 'owner' }, { merge: true }));
await expect('staff reads wages', false, () => getDocs(collection(staff.db, 'biz', 'vannys', 'wages')));
await expect('staff writes a wage', false, () => setDoc(biz(staff.db, 'wages', 'w2'), { amount: 1 }));
await expect('staff reads own member record', true, () => getDoc(doc(staff.db, 'members', staffUid)));
await expect("staff reads the owner's member slot", false, () => getDoc(doc(staff.db, 'members', ownerUid)));
await expect('staff gives someone access', false, () => setDoc(doc(staff.db, 'members', 'someone'), { staffId: 's9' }));
await expect('staff changes a phone lookup', false, () => setDoc(doc(staff.db, 'logins', '256772000001'), { email: 'x@y.z' }));

// A stranger with an account of their own
await expect('stranger reads orders', false, () => getDocs(collection(stranger.db, 'biz', 'vannys', 'orders')));
await expect('stranger writes an order', false, () => setDoc(biz(stranger.db, 'orders', 'z'), { number: 'Z' }));
await expect('stranger gives themself access', false, () => setDoc(doc(stranger.db, 'members', stranger.auth.currentUser.uid), { staffId: 's1' }));

// The staff member leaves: the owner removes their access
await expect('owner removes access', true, () => deleteDoc(doc(owner.db, 'members', staffUid)));
await expect('staff (after leaving) reads orders', false, () => getDocs(collection(staff.db, 'biz', 'vannys', 'orders')));
await expect('staff (after leaving) writes a sale', false, () => setDoc(biz(staff.db, 'sales', 'sa2'), { number: 'S-2' }));

for (const p of [owner, staff, stranger]) await signOut(p.auth);
await Promise.all(apps.map((a) => deleteApp(a)));
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
