// A test copy of the app's records: the real device store over an in-memory storage, and the real actions.
import { makeActions } from '../src/data/actions';
import { withDefaults } from '../src/data/DataContext';
import { makeLocalStore } from '../src/data/localStore';
import type { Row } from '../src/data/store';
import { COLLECTIONS, EMPTY_RECORDS, RECORD_COLS, type Records, type Settings } from '../src/lib/types';

export function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    raw: m,
  };
}

export async function testApp() {
  const storage = memoryStorage();
  const store = makeLocalStore(storage);
  const rows: Record<string, Row[]> = {};
  for (const col of COLLECTIONS) store.subscribe(col, (list) => (rows[col] = list), () => {});
  await Promise.resolve();
  const records = (): Records => {
    const out = {} as Record<string, unknown>;
    for (const c of RECORD_COLS) out[c] = rows[c] ?? EMPTY_RECORDS[c];
    return out as unknown as Records;
  };
  const settingsRow = () => (rows.settings?.find((r) => r.id === 'main') as Partial<Settings> | undefined) ?? null;
  const settings = () => withDefaults(settingsRow());
  const actions = makeActions(store, () => ({ records: records(), settings: settings() }));
  return { store, storage, actions, records, settings, settingsRow };
}
