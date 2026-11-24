// Proves on the local EMULATOR (never the real cloud) how a patch is written: the cloud store's
// patchOptions ({ mergeFields }) must replace a changed map field whole, as the device store does, so a
// bottle size removed from a batch's `filled` is really removed (audit, 24 Nov 2026).
// Run with:  npx firebase emulators:exec --only firestore,auth --project demo-vannys "node scripts/check-patch.mjs"
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, writeBatch } from 'firebase/firestore';

const PROJECT = 'demo-vannys';
const OWNER = 'vanessaklarisa@gmail.com'; // the owner address in firestore.rules
const PIN = '246810'; // throwaway, exists only inside the emulator
const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com`, appId: 'demo' });
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const db = getFirestore(app);
connectFirestoreEmulator(db, '127.0.0.1', 8085);
try {
  await createUserWithEmailAndPassword(auth, OWNER, PIN);
} catch {
  await signInWithEmailAndPassword(auth, OWNER, PIN);
}
const r = doc(db, 'biz', 'vannys', 'batches', 'check');
const write = async (data, opts) => {
  const b = writeBatch(db);
  if (opts) b.set(r, data, opts);
  else b.set(r, data);
  await b.commit();
};
let failed = 0;
const check = (label, ok) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};
await write({ number: 'B-1', filled: { 500: 20 }, note: 'kept' });
// what the app sends now: mergeFields with the patch's own top-level keys
const patch = { filled: { 1000: 20 }, updatedAt: 1 };
await write(patch, { mergeFields: Object.keys(patch) });
let d = (await getDoc(r)).data();
check(`mergeFields replaces the map: ${JSON.stringify(d.filled)}`, JSON.stringify(d.filled) === '{"1000":20}');
check(`mergeFields keeps the other fields: ${d.number} / ${d.note}`, d.number === 'B-1' && d.note === 'kept');
// what it used to send
await write({ number: 'B-1', filled: { 500: 20 } });
await write(patch, { merge: true });
d = (await getDoc(r)).data();
check(`merge:true (old way) merges the map: ${JSON.stringify(d.filled)}`, d.filled['500'] === 20 && d.filled['1000'] === 20);
// a patch can still create a missing document (settings 'main' on a new business)
const r2 = doc(db, 'biz', 'vannys', 'batches', 'new-one');
const b = writeBatch(db);
b.set(r2, { a: 1 }, { mergeFields: ['a'] });
await b.commit();
check('mergeFields creates a missing document', (await getDoc(r2)).data()?.a === 1);
console.log(failed ? `${failed} FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
