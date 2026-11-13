// The app talks to its records through this one small interface. Two stores implement it:
// - deviceStore (this file's neighbour localStore.ts): records kept on this phone or laptop only.
// - cloudStore (cloud.ts): records kept in the cloud account and shared by every signed-in device.
import type { Col, Staff } from '../lib/types';

export type Row = Record<string, unknown> & { id: string };

/**
 * Who may open the cloud records (cloud only; the device store ignores these):
 * - members/{sign-in id}: a staff sign-in the owner gave access to ({ staffId, name });
 * - logins/{phone, 256...}: which sign-in a staff phone number opens ({ email }).
 */
export type AccessCol = 'members' | 'logins';
export const ACCESS_COLS: readonly AccessCol[] = ['members', 'logins'];

export type Op =
  | { op: 'set'; col: Col | AccessCol; id: string; data: Record<string, unknown> } // write the whole record
  | { op: 'patch'; col: Col | AccessCol; id: string; data: Record<string, unknown> } // change only the named fields
  | { op: 'delete'; col: Col | AccessCol; id: string };

export interface SnapshotInfo {
  /** true while the rows come from this device's copy and the cloud has not confirmed them yet */
  fromCache: boolean;
  /** true while some change is still waiting to reach the cloud */
  pending: boolean;
}

export interface Store {
  kind: 'device' | 'cloud';
  subscribe(col: Col, onRows: (rows: Row[], info: SnapshotInfo) => void, onError: (e: Error) => void): () => void;
  /**
   * Saves all the changes together or none of them. It returns as soon as the changes are kept on
   * this device; it does not wait for the network, so a form never hangs on "Saving" with no signal.
   * A later refusal by the cloud is reported through onWriteError.
   */
  commit(ops: Op[]): Promise<void>;
  onWriteError?: (e: Error) => void;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
}

/** Firestore refuses "undefined"; drop such fields so both stores behave the same. */
export function clean(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) out[k] = v;
  return out;
}

/** The changes that close a staff member's cloud sign-in (nothing when they have none). */
export function accessRemoval(s: Staff): Op[] {
  const ops: Op[] = [];
  if (s.loginUid) ops.push({ op: 'delete', col: 'members', id: s.loginUid });
  if (s.loginPhone) ops.push({ op: 'delete', col: 'logins', id: s.loginPhone });
  return ops;
}
