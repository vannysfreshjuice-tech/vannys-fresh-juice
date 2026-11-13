// Backup, restore and CSV downloads.
// A backup holds EVERY record type plus the settings, with a count of each, and Restore reads the
// same file back. (Lesson from MANSOL Finance: an export that leaves record types out is not a backup.)
import { accessRemoval, type Op, type Row } from '../data/store';
import { todayYmd } from './dates';
import { COLLECTIONS, type Col, type Records, type Settings } from './types';

export interface Backup {
  app: 'vannys-fresh-juice';
  version: 1;
  madeAt: string;
  counts: Record<string, number>;
  data: Partial<Record<Col, Row[]>>;
}

export function makeBackup(records: Records, settingsRow: Partial<Settings> | null): Backup {
  const data: Partial<Record<Col, Row[]>> = {};
  const counts: Record<string, number> = {};
  for (const col of COLLECTIONS) {
    if (col === 'settings') continue;
    const rows = records[col] as unknown as Row[];
    data[col] = rows;
    counts[col] = rows.length;
  }
  if (settingsRow) data.settings = [{ ...settingsRow, id: 'main' } as Row];
  return { app: 'vannys-fresh-juice', version: 1, madeAt: new Date().toISOString(), counts, data };
}

export function readBackup(text: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This file could not be read. Choose a backup file made by this app.');
  }
  const b = parsed as Backup;
  if (!b || b.app !== 'vannys-fresh-juice' || typeof b.data !== 'object') throw new Error("This is not a Vanny's Fresh Juice backup file.");
  return b;
}

/** Changes that put every record of a backup back. Records with the same id are replaced; nothing else is touched. */
export function restoreOps(data: Partial<Record<Col, Row[]>>): Op[] {
  const ops: Op[] = [];
  for (const col of COLLECTIONS) {
    for (const row of data[col] ?? []) {
      if (!row || typeof row.id !== 'string' || !row.id) continue;
      const { id, ...rest } = row;
      ops.push({ op: col === 'settings' ? 'patch' : 'set', col, id, data: rest });
    }
  }
  return ops;
}

export function countRows(data: Partial<Record<Col, Row[]>>): number {
  let n = 0;
  for (const col of COLLECTIONS) if (col !== 'settings') n += data[col]?.length ?? 0;
  return n;
}

export function deleteAllOps(records: Records): Op[] {
  const ops: Op[] = [];
  for (const col of COLLECTIONS) {
    if (col === 'settings') continue;
    for (const row of records[col] as unknown as Row[]) ops.push({ op: 'delete', col, id: row.id });
  }
  // Staff removed from the records must not keep a way into the cloud records.
  for (const s of records.staff) ops.push(...accessRemoval(s));
  return ops;
}

// ---------- CSV ----------

function cell(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Stop a spreadsheet reading text that starts with = + - @ as a formula.
  if (/^[=+\-@]/.test(s) && typeof v !== 'number') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  // The first character (BOM) tells Excel the file is UTF-8, so names with accents show properly.
  return '﻿' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Hands a file to the person: the iPhone share sheet (Save to Files, WhatsApp...) where there is one, a download elsewhere. */
export async function giveFile(name: string, content: string | Blob, type: string): Promise<void> {
  const file = new File([content], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  if (touch && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // the person closed the share sheet
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const backupFileName = () => `vannys-backup-${todayYmd()}.json`;
