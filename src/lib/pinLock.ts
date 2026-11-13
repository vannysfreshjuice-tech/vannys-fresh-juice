// The PIN lock on this device. It is off until someone sets a PIN in Settings.
// Each person can have their own 6-digit PIN; the PIN typed decides who is using the app.
// Only a slow salted fingerprint of each PIN is kept on this device, never the PIN itself.
// The app locks when it starts and after LOCK_AFTER_MS in the background.
//
// That is the device lock (records kept on the device: npm run dev). In the published app the
// records are in the cloud and each person's PIN is their own Firebase password; after Firebase has
// accepted it once on a device, rememberCloudPin keeps its fingerprint so it also opens offline.

const KEY = 'vannys.pins';
const HIDDEN_AT = 'vannys.hiddenAt';
const TRIES = 'vannys.pinTries';
const CLOUD_KEY = 'vannys.cloudPin';
export const PIN_LENGTH = 6;
export const LOCK_AFTER_MS = 5 * 60 * 1000;
/** The key used for the owner when no staff record is marked Owner. */
export const OWNER_KEY = 'owner';
const ROUNDS = 150_000;

interface Saved {
  salt: string;
  hash: string;
}
type Pins = Record<string, Saved>;

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array((hex.match(/../g) ?? []).map((h) => parseInt(h, 16)));

async function fingerprint(pin: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ROUNDS }, key, 256);
  return toHex(bits);
}

function read(): Pins {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (!v || typeof v !== 'object') return {};
    const out: Pins = {};
    for (const [k, s] of Object.entries(v as Record<string, Saved>)) if (s && typeof s.salt === 'string' && typeof s.hash === 'string') out[k] = s;
    return out;
  } catch {
    return {};
  }
}

function write(pins: Pins) {
  try {
    if (Object.keys(pins).length) localStorage.setItem(KEY, JSON.stringify(pins));
    else localStorage.removeItem(KEY);
  } catch {
    throw new Error('This device would not keep the PIN (private browsing?). Open the app normally and try again.');
  }
}

export const validPin = (pin: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);

/** 111111, 123456, 987654 and the like. */
export const easyPin = (pin: string) => /^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin);

/** Is the lock on (at least one PIN set on this device)? */
export const lockIsOn = () => Object.keys(read()).length > 0;

/** Whose PINs are set on this device (staff ids, or OWNER_KEY). */
export const pinKeys = () => Object.keys(read());

/** Who this PIN belongs to, or null. */
export async function findPin(pin: string): Promise<string | null> {
  if (!validPin(pin)) return null;
  for (const [k, s] of Object.entries(read())) if ((await fingerprint(pin, fromHex(s.salt))) === s.hash) return k;
  return null;
}

/** Sets (or changes) one person's PIN. Two people cannot share a PIN, since the PIN says who you are. */
export async function setPin(who: string, pin: string): Promise<void> {
  if (!validPin(pin)) throw new Error(`The PIN must be ${PIN_LENGTH} digits.`);
  if (easyPin(pin)) throw new Error('That PIN is too easy to guess. Choose another.');
  const taken = await findPin(pin);
  if (taken && taken !== who) throw new Error('Someone else already uses that PIN. Choose another.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const pins = read();
  pins[who] = { salt: toHex(salt.buffer), hash: await fingerprint(pin, salt) };
  write(pins);
}

export function removePin(who: string): void {
  const pins = read();
  delete pins[who];
  write(pins);
}

export function removeAllPins(): void {
  write({});
}

// ---------- cloud: the signed-in person's PIN, for opening with no signal ----------

/** Keeps the fingerprint of the PIN Firebase has just accepted for this sign-in (uid). */
export async function rememberCloudPin(uid: string, pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await fingerprint(pin, salt);
  try {
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ uid, salt: toHex(salt.buffer), hash }));
  } catch {
    /* private mode: the PIN then goes to Firebase each time */
  }
}

/** true = right; false = wrong; null = no fingerprint for this sign-in here yet (ask Firebase). */
export async function checkCloudPin(uid: string, pin: string): Promise<boolean | null> {
  try {
    const v = JSON.parse(localStorage.getItem(CLOUD_KEY) ?? 'null') as { uid?: string; salt?: string; hash?: string } | null;
    if (!v || v.uid !== uid || typeof v.salt !== 'string' || typeof v.hash !== 'string') return null;
    return (await fingerprint(pin, fromHex(v.salt))) === v.hash;
  } catch {
    return null;
  }
}

export function forgetCloudPin(): void {
  try {
    localStorage.removeItem(CLOUD_KEY);
  } catch {
    /* nothing stored */
  }
}

// ---------- wrong tries on this device: 5 free, then a growing wait ----------

export function waitSeconds(): number {
  try {
    const t = JSON.parse(localStorage.getItem(TRIES) ?? '{"n":0,"until":0}');
    return Math.max(0, Math.ceil((Number(t.until) - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

export function noteWrongTry(): number {
  let n = 0;
  try {
    n = Number(JSON.parse(localStorage.getItem(TRIES) ?? '{"n":0}').n) || 0;
  } catch {
    n = 0;
  }
  n += 1;
  const wait = n < 5 ? 0 : Math.min(15 * 60, 30 * 2 ** (n - 5)); // 30 s, 1 min, 2 min ... up to 15 min
  try {
    localStorage.setItem(TRIES, JSON.stringify({ n, until: Date.now() + wait * 1000 }));
  } catch {
    /* ignore */
  }
  return wait;
}

export function clearTries(): void {
  try {
    localStorage.removeItem(TRIES);
  } catch {
    /* ignore */
  }
}

// ---------- background timing ----------

export function noteHidden(): void {
  try {
    sessionStorage.setItem(HIDDEN_AT, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/** Was the app away long enough to lock again? Clears the mark either way. */
export function awayTooLong(): boolean {
  try {
    const at = Number(sessionStorage.getItem(HIDDEN_AT));
    sessionStorage.removeItem(HIDDEN_AT);
    return at > 0 && Date.now() - at > LOCK_AFTER_MS;
  } catch {
    return false;
  }
}
