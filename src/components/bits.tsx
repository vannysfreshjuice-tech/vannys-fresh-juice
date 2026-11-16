// Small display pieces shared by pages and windows.
import { LayoutGrid, List } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useData } from '../data/DataContext';
import { batchStatus, priceOf, sizeOf, type BatchStatus, type PayStatus } from '../lib/juice';
import { money } from '../lib/money';
import type { Batch, OrderLine, OrderStage, Product } from '../lib/types';
import { Badge, cx } from './ui';

/** The juice's emoji on its colour; a cocktail shows the colours of its fruits as stripes. */
export function JuiceBadge({ product, size = 40 }: { product: Product | undefined; size?: number }) {
  const colour = product?.colour || '#F7931E';
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-xl"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.52),
        background: product?.kind === 'cocktail' ? `linear-gradient(135deg, ${colour}55 0%, ${colour}22 55%, #3BA93533 100%)` : `${colour}26`,
      }}
      aria-hidden
    >
      {product?.icon || '🥤'}
    </span>
  );
}

export function useJuice() {
  const { productsById, settings } = useData();
  const name = (id: string) => productsById.get(id)?.name ?? 'Juice no longer in the list';
  const sizeLabel = (k: string) => sizeOf(settings.sizes, k)?.label ?? k;
  const lineText = (l: Pick<OrderLine, 'productId' | 'size' | 'qty'>) => `${l.qty} × ${name(l.productId)} ${sizeLabel(l.size)}`;
  const price = (productId: string, size: string) => priceOf(productsById.get(productId), sizeOf(settings.sizes, size));
  return { name, sizeLabel, lineText, price, money: (n: number) => money(n, settings.currency) };
}

export const stageTone = (s: OrderStage) => (s === 'Delivered' ? 'green' : s === 'Out for delivery' ? 'brown' : s === 'Ready' ? 'pink' : s === 'Cancelled' ? 'grey' : 'amber');
export const StageBadge = ({ stage }: { stage: OrderStage }) => <Badge tone={stageTone(stage)}>{stage}</Badge>;

export const PayBadge = ({ status }: { status: PayStatus }) => <Badge tone={status === 'Paid' ? 'green' : status === 'Part paid' ? 'amber' : 'red'}>{status}</Badge>;

export function BatchBadge({ batch }: { batch: Batch }) {
  const { fridge, today } = useData();
  const st: BatchStatus = batchStatus(batch, fridge.get(batch.id));
  const soon = st === 'In the fridge' && batch.bestBefore <= today;
  return <Badge tone={st === 'Making' ? 'pink' : st === 'Finished' ? 'grey' : soon ? 'red' : 'green'}>{soon ? (batch.bestBefore < today ? 'Past best-before' : 'Best before today') : st}</Badge>;
}

/** A margin as a coloured badge: green 30% and over, yellow 20 to 30%, red under 20%. */
export function Margin({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return <Badge tone={pct >= 30 ? 'green' : pct >= 20 ? 'amber' : 'red'}>{pct}%</Badge>;
}

export function Card({ title, icon, action, children, className }: { title?: ReactNode; icon?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('card p-4', className)}>
      {title && (
        <div className="mb-2 flex items-center gap-2">
          {icon}
          <h2 className="min-w-0 flex-1 text-base font-semibold">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export const share = (n: number, total: number) => (total > 0 ? n / total : 0);

export type ViewMode = 'list' | 'cards';

/** List or cards for one page, remembered on this phone. */
export function useViewMode(page: string, initial: ViewMode = 'list'): [ViewMode, (v: ViewMode) => void] {
  const key = `vannys.view.${page}`;
  const [mode, setMode] = useState<ViewMode>(() => (localStorage.getItem(key) === 'cards' ? 'cards' : localStorage.getItem(key) === 'list' ? 'list' : initial));
  return [
    mode,
    (v) => {
      localStorage.setItem(key, v);
      setMode(v);
    },
  ];
}

export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const btn = (v: ViewMode, Icon: typeof List, label: string) => (
    <button type="button" aria-label={label} aria-pressed={value === v} title={label} onClick={() => onChange(v)} className={cx('flex h-10 w-10 items-center justify-center rounded-lg', value === v ? 'bg-accent text-white' : 'text-muted hover:bg-page')}>
      <Icon size={18} aria-hidden />
    </button>
  );
  return (
    <div className="flex shrink-0 gap-0.5 rounded-xl border border-line bg-card p-0.5">
      {btn('list', List, 'List view')}
      {btn('cards', LayoutGrid, 'Card view')}
    </div>
  );
}

/** A thin bar for a rate from 0 to 1: green from 85%, orange from 60%, red below. */
export function RateBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const tone = pct >= 85 ? 'bg-leaf' : pct >= 60 ? 'bg-orange' : 'bg-cherry';
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-line">
      <span className={cx('block h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
    </span>
  );
}
