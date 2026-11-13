// Records kept on this device only (the browser's own storage). Used until cloud sync is set up.
import { COLLECTIONS, type Col } from '../lib/types';
import { clean, type Op, type Row, type SnapshotInfo, type Store } from './store';

const PREFIX = 'vannys.v1.';
const INFO: SnapshotInfo = { fromCache: false, pending: false };

type Table = Record<string, Row>;

interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function read(storage: KeyValue, col: Col): Table {
  try {
    const raw = storage.getItem(PREFIX + col);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Table) : {};
  } catch {
    return {};
  }
}

export function makeLocalStore(storage: KeyValue = window.localStorage): Store {
  const tables = new Map<Col, Table>();
  const listeners = new Map<Col, Set<(rows: Row[], info: SnapshotInfo) => void>>();

  const table = (col: Col) => {
    let t = tables.get(col);
    if (!t) tables.set(col, (t = read(storage, col)));
    return t;
  };
  const emit = (col: Col) => {
    const rows = Object.values(table(col));
    listeners.get(col)?.forEach((fn) => fn(rows, INFO));
  };

  // Another tab or window of the app changed something: pick it up.
  if (typeof window !== 'undefined')
    window.addEventListener('storage', (e) => {
      if (!e.key?.startsWith(PREFIX)) return;
      const col = e.key.slice(PREFIX.length) as Col;
      if (!COLLECTIONS.includes(col)) return;
      tables.delete(col);
      emit(col);
    });

  return {
    kind: 'device',
    subscribe(col, onRows) {
      let set = listeners.get(col);
      if (!set) listeners.set(col, (set = new Set()));
      set.add(onRows);
      queueMicrotask(() => {
        if (set.has(onRows)) onRows(Object.values(table(col)), INFO);
      });
      return () => {
        set.delete(onRows);
      };
    },
    async commit(ops: Op[]) {
      // Work on copies, write them all, and only then swap them in: all or nothing.
      const next = new Map<Col, Table>();
      for (const o of ops) {
        if (!(COLLECTIONS as readonly string[]).includes(o.col)) continue; // cloud access lists: nothing to keep here
        const col = o.col as Col;
        let t = next.get(col);
        if (!t) next.set(col, (t = { ...table(col) }));
        if (o.op === 'delete') delete t[o.id];
        else if (o.op === 'set') t[o.id] = { ...clean(o.data), id: o.id };
        else t[o.id] = { ...(t[o.id] ?? {}), ...clean(o.data), id: o.id };
      }
      const written: [Col, string | null][] = [];
      try {
        for (const [col, t] of next) {
          written.push([col, storage.getItem(PREFIX + col)]);
          storage.setItem(PREFIX + col, JSON.stringify(t));
        }
      } catch {
        for (const [col, old] of written) if (old !== null) try { storage.setItem(PREFIX + col, old); } catch { /* keep going */ }
        throw new Error('This device has no room left to save. Download a backup in Settings, then free some space.');
      }
      for (const [col, t] of next) tables.set(col, t);
      for (const col of next.keys()) emit(col);
    },
  };
}

/** Everything saved on this device, for moving it into the cloud account. */
export function readDeviceRecords(storage: KeyValue = window.localStorage): Partial<Record<Col, Row[]>> {
  const out: Partial<Record<Col, Row[]>> = {};
  for (const col of COLLECTIONS) {
    const rows = Object.values(read(storage, col));
    if (rows.length) out[col] = rows;
  }
  return out;
}
