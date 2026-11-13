// Cloud records (every phone and laptop sees the same records) come from the Firebase project below.
//
// This config is NOT a secret: it only names the project. What protects the records is each person's
// sign-in (their PIN is their password, checked by Firebase) and the rules in firestore.rules.
// Never put a password or a private key here.

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

// Firebase project "Vanny's Fresh Juice" (vanny-s-fresh-juice), owned by Vanessa's Google account.
// Set up 12 Nov 2026: Spark plan (free), Email/Password sign-in, Firestore in africa-south1.
export const firebaseConfig: FirebaseConfig = {
  apiKey: 'AIzaSyDzvZROoVIt5trU_bidpjkZZZq8tyfTicM',
  authDomain: 'vanny-s-fresh-juice.firebaseapp.com',
  projectId: 'vanny-s-fresh-juice',
  storageBucket: 'vanny-s-fresh-juice.firebasestorage.app',
  messagingSenderId: '455097921024',
  appId: '1:455097921024:web:a1df1f79760771cfcb32e5',
};

/** Local test copy only ("npm run emulators" + "npm run dev:emulator"): never talks to the real cloud. */
export const useEmulator = import.meta.env.DEV && import.meta.env.VITE_EMULATOR === '1';

/**
 * The owner's sign-in. It is Vanessa's real mailbox, so "Forgot PIN" can email her a reset link.
 * firestore.rules names the same address (keep the two the same). Not a secret: the PIN is the secret.
 * The emulator uses the same address for its throwaway test account, so the same rules apply there.
 */
export const ownerEmail = 'vanessaklarisa@gmail.com';

/**
 * Staff sign-ins get a made-up address under this domain (staff type their phone number, never this).
 * It is a Google-owned domain with no mailboxes, so no reset link for a staff sign-in can reach anyone.
 */
export const staffDomain = 'staff.vanny-s-fresh-juice.firebaseapp.com';

/**
 * Which records the app uses:
 * - the published app: the real records in the cloud;
 * - "npm run dev:emulator": the local test copy;
 * - "npm run dev": records kept in this browser only, so work on this computer never touches the real records.
 */
export const cloudConfig: FirebaseConfig | null = useEmulator
  ? { apiKey: 'demo-key', authDomain: 'demo-vannys.firebaseapp.com', projectId: 'demo-vannys', appId: 'demo' }
  : import.meta.env.DEV
    ? null
    : firebaseConfig;
