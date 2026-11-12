// Counter sales: tap a juice and a size, then take payment. Bottles come off the oldest batch first.
import { ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { JuiceBadge, useJuice } from '../components/bits';
import { useSheets } from '../components/SheetHost';
import { Badge, Button, Empty, PageHead, cx, useNotice } from '../components/ui';
import { useData } from '../data/DataContext';
import { fridgeCount, fridgeTotal, linesValue } from '../lib/juice';
import type { OrderLine, ProductKind } from '../lib/types';

const KINDS: { kind: ProductKind; label: string }[] = [
  { kind: 'single', label: 'Single fruit' },
  { kind: 'cocktail', label: 'Juice cocktails' },
];

export function Sell() {
  const { products, settings, fridge } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const notify = useNotice();
  const [cart, setCart] = useState<Record<string, number>>({});
  const live = products.filter((p) => !p.archived);
  const lines: OrderLine[] = Object.entries(cart)
    .filter(([, q]) => q > 0)
    .map(([k, qty]) => {
      const [productId, size] = k.split('|');
      return { productId, size, qty, price: j.price(productId, size) };
    });
  const total = linesValue(lines);
  const count = lines.reduce((t, l) => t + l.qty, 0);
  const add = (productId: string, size: string, d = 1) => {
    const k = `${productId}|${size}`;
    const have = cart[k] ?? 0;
    const inFridge = fridgeCount(fridge, productId, size);
    if (d > 0 && have >= inFridge) return notify(`Only ${inFridge} × ${j.name(productId)} ${j.sizeLabel(size)} in the fridge`, 'info');
    setCart((c) => ({ ...c, [k]: Math.max(0, have + d) }));
  };
  const checkout = () => sheets.open({ t: 'checkout', lines, onDone: () => setCart({}) });

  if (!live.length) return <Empty icon={ShoppingCart} title="No juices yet" body="Add your juices on Recipes and prices (or from Home), then make a batch." />;

  return (
    <div className="pb-20 lg:pb-0">
      <PageHead title="Sell" eyebrow="Tap a size to add a bottle" />
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
        <div>
          {KINDS.map(({ kind, label }) => {
            const list = live.filter((p) => p.kind === kind);
            if (!list.length) return null;
            return (
              <div key={kind} className="mb-4">
                <h2 className="mb-2 text-sm font-bold tracking-wide text-muted uppercase">
                  {kind === 'cocktail' ? '🍹' : '🍊'} {label}
                </h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {list.map((p) => (
                    <div key={p.id} className="card p-3">
                      <div className="mb-2 flex items-center gap-3">
                        <JuiceBadge product={p} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold">
                            {p.name} {p.premium && <Badge tone="brown">Premium</Badge>}
                          </span>
                          {p.tag && <span className="block truncate text-xs text-muted">{p.tag}</span>}
                        </span>
                        <span className="text-xs text-muted">{fridgeTotal(fridge, p.id)} in fridge</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {settings.sizes.map((s) => {
                          const left = fridgeCount(fridge, p.id, s.key) - (cart[`${p.id}|${s.key}`] ?? 0);
                          return (
                            <button key={s.key} type="button" disabled={left <= 0} onClick={() => add(p.id, s.key)} className={cx('min-h-14 rounded-xl border border-line bg-page px-1 py-1.5 text-center active:bg-accent-soft disabled:opacity-40')}>
                              <span className="block text-[13px] font-bold">{s.label}</span>
                              <span className="num block text-[11px] text-muted">{j.money(j.price(p.id, s.key)).replace('UGX ', '')}</span>
                              <span className={cx('block text-[10px] font-bold', left > 0 ? 'text-leaf' : 'text-faint')}>{left > 0 ? `${left} left` : 'none'}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="lg:hidden">
            <TodaySales />
          </div>
        </div>

        <div className="hidden lg:sticky lg:top-4 lg:block">
          <div className="card p-4">
            <h2 className="mb-2 font-semibold">This sale</h2>
            {!lines.length ? (
              <p className="text-sm text-muted">Nothing yet.</p>
            ) : (
              <>
                <div className="divide-y divide-line">
                  {lines.map((l) => (
                    <div key={`${l.productId}|${l.size}`} className="flex items-center gap-2 py-2">
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block font-medium">{j.name(l.productId)}</span>
                        <span className="text-muted">
                          {j.sizeLabel(l.size)} · {j.money(l.price)}
                        </span>
                      </span>
                      <button type="button" className="h-9 w-9 rounded-lg border border-line text-lg font-bold" onClick={() => add(l.productId, l.size, -1)} aria-label="One less">
                        −
                      </button>
                      <span className="num w-6 text-center font-semibold">{l.qty}</span>
                      <button type="button" className="h-9 w-9 rounded-lg border border-line text-lg font-bold" onClick={() => add(l.productId, l.size)} aria-label="One more">
                        +
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-2 flex items-center justify-between text-lg font-semibold">
                  <span>Total</span>
                  <span className="num">{j.money(total)}</span>
                </div>
                <div className="mt-3 flex gap-2 [&>*]:flex-1">
                  <Button variant="plain" onClick={() => setCart({})}>
                    Clear
                  </Button>
                  <Button onClick={checkout}>Take payment</Button>
                </div>
              </>
            )}
          </div>
          <TodaySales />
        </div>
      </div>

      {count > 0 && (
        <button type="button" onClick={checkout} className="fixed inset-x-4 bottom-[calc(4.6rem+env(safe-area-inset-bottom,0px))] z-30 flex items-center gap-3 rounded-2xl bg-choc px-4 py-3 text-left text-white shadow-xl md:left-[17rem] lg:hidden">
          <span className="flex-1">
            <b>{count} bottles</b>
            <span className="block text-sm opacity-80">{j.money(total)}</span>
          </span>
          <span className="rounded-xl bg-accent px-3 py-2 text-sm font-semibold">Take payment</span>
          <span
            role="button"
            tabIndex={0}
            className="rounded-xl bg-white/15 px-3 py-2 text-sm"
            onClick={(e) => {
              e.stopPropagation();
              setCart({});
            }}
          >
            Clear
          </span>
        </button>
      )}
    </div>
  );
}

/** Today's counter sales; tap one to see it or undo it. */
function TodaySales() {
  const { sales, today } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const todays = sales.filter((s) => s.date === today).sort((a, b) => b.time.localeCompare(a.time));
  if (!todays.length) return null;
  return (
    <div className="card mt-4 p-4">
      <h2 className="mb-1 font-semibold">Today's sales</h2>
      <div className="divide-y divide-line">
        {todays.slice(0, 12).map((s) => (
          <button key={s.id} type="button" className="flex min-h-11 w-full items-center gap-2 py-2 text-left text-sm" onClick={() => sheets.open({ t: 'saleView', id: s.id })}>
            <span className="w-11 text-muted">{s.time}</span>
            <span className="min-w-0 flex-1 truncate">
              {s.customerName || 'Walk-in'} · {s.method}
            </span>
            <span className="num">{j.money(linesValue(s.lines))}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
