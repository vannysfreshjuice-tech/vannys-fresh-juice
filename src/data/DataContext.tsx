// Loads every record list ONCE for the whole app (one listener per list, not one per page) and
// works out the shared figures once. Pages read from here; they never load records themselves.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { todayYmd } from '../lib/dates';
import { averageCosts, customerBalances, fridgeByBatch, itemLevels, latestCosts, paymentsByRef, supplierOwed, type BatchLeft, type ItemLevel } from '../lib/juice';
import { COLLECTIONS, DEFAULT_SETTINGS, EMPTY_RECORDS, RECORD_COLS, type Col, type Customer, type Order, type Payment, type Product, type Records, type Role, type Settings, type Staff, type StockItem } from '../lib/types';
import { makeActions, type Actions } from './actions';
import type { Row, SnapshotInfo, Store } from './store';

export type SyncState = 'device' | 'saved' | 'sending' | 'offline';

interface DataValue extends Records {
  settings: Settings;
  /** The settings exactly as stored (without the defaults filled in), for backups */
  settingsRow: Partial<Settings> | null;
  /** false until every list has arrived; pages show "Loading" rather than "no records" */
  ready: boolean;
  loadError: string;
  sync: SyncState;
  storeKind: Store['kind'];
  today: string;
  actions: Actions;
  byRef: Map<string, Payment[]>;
  productsById: Map<string, Product>;
  itemsById: Map<string, StockItem>;
  customersById: Map<string, Customer>;
  staffById: Map<string, Staff>;
  ordersById: Map<string, Order>;
  /** Average cost of each stock item (for batches) */
  avgCosts: Map<string, number>;
  /** Last price paid for each stock item (for recipes: today's prices) */
  lastCosts: Map<string, number>;
  levels: Map<string, ItemLevel>;
  fridge: Map<string, BatchLeft>;
  customerBal: Map<string, number>;
  supplierBal: Map<string, number>;
  /** Who is using the app on this device, and what they may open */
  me: Staff | null;
  role: Role;
  setMe: (staffId: string) => void;
}

const DataContext = createContext<DataValue | null>(null);

export function useData(): DataValue {
  const v = useContext(DataContext);
  if (!v) throw new Error('useData must be used inside DataProvider');
  return v;
}

function useToday(): string {
  const [today, setToday] = useState(todayYmd());
  useEffect(() => {
    const check = () => setToday((t) => (t === todayYmd() ? t : todayYmd()));
    const timer = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return today;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

const ME_KEY = 'vannys.v1.me';

/** Fills the defaults in memory. They are never written back, so a new device can never overwrite the stored settings. */
export function withDefaults(row: Partial<Settings> | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!row) return out;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const v = row[key];
    const d = DEFAULT_SETTINGS[key];
    const ok = Array.isArray(d) ? Array.isArray(v) && v.length > 0 : typeof d === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === 'string' && (v !== '' || key === 'merchantCode');
    if (ok) (out as unknown as Record<string, unknown>)[key] = v;
  }
  return out;
}

export function DataProvider({ store, onWriteError, children }: { store: Store; onWriteError: (message: string) => void; children: ReactNode }) {
  const [rows, setRows] = useState<Partial<Record<Col, Row[]>>>({});
  const [infos, setInfos] = useState<Partial<Record<Col, SnapshotInfo>>>({});
  const [loadError, setLoadError] = useState('');
  const [meId, setMeId] = useState(() => localStorage.getItem(ME_KEY) ?? '');
  const today = useToday();
  const online = useOnline();

  useEffect(() => {
    setRows({});
    setInfos({});
    setLoadError('');
    store.onWriteError = (e) => onWriteError(`A change could not be saved to the cloud: ${e.message}`);
    const stops = COLLECTIONS.map((col) =>
      store.subscribe(
        col,
        (list, info) => {
          setRows((r) => ({ ...r, [col]: list }));
          setInfos((i) => (i[col]?.fromCache === info.fromCache && i[col]?.pending === info.pending ? i : { ...i, [col]: info }));
        },
        (e) => setLoadError(e.message || 'The records could not be loaded.'),
      ),
    );
    return () => stops.forEach((stop) => stop());
    // onWriteError is a stable notice function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const ready = COLLECTIONS.every((col) => rows[col] !== undefined);

  const records: Records = useMemo(() => {
    const out = {} as Record<string, unknown>;
    for (const col of RECORD_COLS) out[col] = (rows[col] as unknown) ?? EMPTY_RECORDS[col];
    return out as unknown as Records;
  }, [rows]);

  const settingsRow = useMemo(() => {
    const row = rows.settings?.find((r) => r.id === 'main');
    if (!row) return null;
    const { id: _id, ...rest } = row;
    return rest as Partial<Settings>;
  }, [rows.settings]);
  const settings = useMemo(() => withDefaults(settingsRow), [settingsRow]);

  const current = useRef({ records, settings });
  current.current = { records, settings };
  const actions = useMemo(() => makeActions(store, () => current.current), [store]);
  // On the development server only (never in the published app): lets a test script use the same actions.
  if (import.meta.env.DEV) (window as unknown as { __vannys: unknown }).__vannys = { actions, now: () => current.current };

  const derived = useMemo(() => {
    const byRef = paymentsByRef(records.payments);
    return {
      byRef,
      productsById: new Map(records.products.map((p) => [p.id, p])),
      itemsById: new Map(records.items.map((i) => [i.id, i])),
      customersById: new Map(records.customers.map((c) => [c.id, c])),
      staffById: new Map(records.staff.map((s) => [s.id, s])),
      ordersById: new Map(records.orders.map((o) => [o.id, o])),
      avgCosts: averageCosts(records.purchases),
      lastCosts: latestCosts(records.purchases),
      levels: itemLevels(records.items, records.purchases, records.batches, records.counts, settings.sizes, settings.perBottle),
      fridge: fridgeByBatch(records.batches, records.sales, records.orders, records.writeOffs),
      customerBal: customerBalances(records.customers, records.orders, records.sales, byRef),
      supplierBal: supplierOwed(records, byRef),
    };
  }, [records, settings.sizes, settings.perBottle]);

  const me = records.staff.find((s) => s.id === meId && !s.archived) ?? null;
  const role: Role = me?.role ?? 'owner';
  const setMe = (id: string) => {
    localStorage.setItem(ME_KEY, id);
    setMeId(id);
  };

  const sync: SyncState =
    store.kind === 'device'
      ? 'device'
      : !online
        ? 'offline'
        : Object.values(infos).some((i) => i?.pending)
          ? 'sending'
          : Object.values(infos).some((i) => i?.fromCache)
            ? 'offline'
            : 'saved';

  const value: DataValue = { ...records, ...derived, settings, settingsRow, ready, loadError, sync, storeKind: store.kind, today, actions, me, role, setMe };
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}
