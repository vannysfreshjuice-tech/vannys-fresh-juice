// Money is whole shillings. Every amount typed into the app goes through cleanAmount() once,
// and every stored amount is read through num(), so a blank, a text value or a negative never
// turns into "UGX NaN" on screen.

/** A stored value as a safe number (text such as "1,200,000" is read properly; anything else is 0). */
export function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** A typed amount: whole shillings, never negative. Blank or unreadable = 0. */
export function cleanAmount(v: unknown): number {
  const n = typeof v === 'string' ? num(v.replace(/[^\d.,\-\s]/g, '')) : num(v);
  return n > 0 ? Math.round(n) : 0;
}

/** A typed quantity: may have a fraction (2.5 kg), never negative. */
export function cleanQty(v: unknown): number {
  const n = num(v);
  return n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

const grouped = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 0 });
const groupedQty = new Intl.NumberFormat('en-UG', { maximumFractionDigits: 3 });

/** 1,200,000 */
export function fmt(n: unknown): string {
  return grouped.format(Math.round(num(n)));
}

/** UGX 1,200,000 (a negative shows as -UGX 5,000) */
export function money(n: unknown, currency = 'UGX'): string {
  const v = Math.round(num(n));
  return `${v < 0 ? '-' : ''}${currency} ${grouped.format(Math.abs(v))}`;
}

/** Short form for small cards: 1.2m, 350k */
export function shortMoney(n: unknown): string {
  const v = Math.round(num(n));
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}m`;
  if (a >= 10_000) return `${sign}${Math.round(a / 1000)}k`;
  return `${sign}${grouped.format(a)}`;
}

export function qty(n: unknown): string {
  return groupedQty.format(num(n));
}

export function sum<T>(rows: readonly T[], pick: (row: T) => unknown): number {
  let total = 0;
  for (const r of rows) total += num(pick(r));
  return total;
}
