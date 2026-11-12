// Small display pieces shared by pages and windows.
import type { ReactNode } from 'react';
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
