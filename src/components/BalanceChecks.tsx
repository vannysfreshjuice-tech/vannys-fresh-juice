// "Not balanced yet": what does not add up in the records, each line with the button that puts it right.
import { Scale } from 'lucide-react';
import { useState } from 'react';
import { useData } from '../data/DataContext';
import { balanceChecks, type Check, type CheckFix } from '../lib/checks';
import { showDay } from '../lib/dates';
import { qty as showQty } from '../lib/money';
import { Card, useJuice } from './bits';
import { useSheets } from './SheetHost';
import { Button } from './ui';

export function useBalanceChecks(): Check[] {
  const { items, levels, batches, sales, orders, writeOffs, today } = useData();
  return balanceChecks({ items, levels, batches, sales, orders, writeOffs, today });
}

export function BalanceChecks({ max = 6 }: { max?: number }) {
  const { itemsById, batches } = useData();
  const j = useJuice();
  const sheets = useSheets();
  const checks = useBalanceChecks();
  const [all, setAll] = useState(false);
  if (!checks.length) return null;
  const shown = all ? checks : checks.slice(0, max);
  const words = (c: Check) => {
    const it = c.itemId ? itemsById.get(c.itemId) : undefined;
    const juice = c.productId ? j.name(c.productId) : '';
    const number = c.batchId ? batches.find((b) => b.id === c.batchId)?.number : '';
    switch (c.what) {
      case 'stock':
        return {
          title: `${it?.name ?? 'An item'}: ${showQty(c.used ?? 0)} used, only ${showQty(c.had ?? 0)} bought`,
          sub:
            it?.kind === 'packaging'
              ? `${showQty(c.qty)} ${it?.unit ?? ''} not accounted for (last used ${showDay(c.date)}). Washed bottles used again? Count what you have (reason: Washed and used again). Otherwise record the purchase.`
              : `${showQty(c.qty)} ${it?.unit ?? ''} not accounted for (last used ${showDay(c.date)}). Record the purchase on the day it was bought, or count what is there.`,
        };
      case 'sold':
        return { title: `${c.qty} × ${juice} ${j.sizeLabel(c.size ?? '')} sold ${showDay(c.date)}`, sub: 'No bottles made recorded for them. Add the bottles made that day, or, if they were tapped as the wrong juice, change them to the juice they really were.' };
      case 'bottling':
        return { title: `${number} ${juice} (${showDay(c.date)}) not bottled yet`, sub: `${showQty(c.qty)} litres made: fill in the bottles, or change or delete the batch.` };
      case 'fruit':
        return { title: `${c.qty} × ${juice} made ${showDay(c.date)}`, sub: `Nothing recorded about what went in (${number}), so Stock and the cost miss it. Change the batch and add the fruit used.` };
    }
  };
  const fix = (f: CheckFix, c: Check) => {
    switch (f.kind) {
      case 'buy':
        return (
          <Button key="buy" small variant="soft" onClick={() => sheets.open({ t: 'purchase', itemId: f.itemId, date: f.date })}>
            Record purchase
          </Button>
        );
      case 'count':
        return (
          <Button key="count" small variant="plain" onClick={() => sheets.open({ t: 'count', itemId: f.itemId })}>
            Count
          </Button>
        );
      case 'made':
        return (
          <Button key="made" small variant="soft" onClick={() => sheets.open({ t: 'batch', productId: f.productId, date: f.date })}>
            Add bottles made
          </Button>
        );
      case 'soldAs':
        return (
          <Button key="soldAs" small variant="plain" onClick={() => sheets.open({ t: 'soldAs', productId: f.productId, size: f.size, date: f.date, qty: f.qty })}>
            Wrong juice?
          </Button>
        );
      case 'bottle':
        return (
          <Button key="bottle" small variant="soft" onClick={() => sheets.open({ t: 'batchView', id: f.batchId })}>
            Open batch
          </Button>
        );
      case 'whatWentIn':
        return (
          <Button key="fruit" small variant="soft" onClick={() => sheets.open({ t: 'batch', id: c.batchId })}>
            Change batch
          </Button>
        );
    }
  };
  return (
    <Card title={`Not balanced yet (${checks.length})`} icon={<Scale size={18} className="text-amber" aria-hidden />}>
      <p className="mb-1 text-sm text-muted">Things recorded late or forgotten. Put each right and it leaves this list.</p>
      <div className="divide-y divide-line">
        {shown.map((c) => {
          const w = words(c);
          return (
            <div key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <span className="min-w-0 flex-1 basis-60">
                <span className="block font-semibold">{w.title}</span>
                <span className="block text-sm text-muted">{w.sub}</span>
              </span>
              <span className="flex gap-1.5">{c.fixes.map((f) => fix(f, c))}</span>
            </div>
          );
        })}
      </div>
      {checks.length > max && (
        <Button small variant="plain" className="mt-1" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${checks.length}`}
        </Button>
      )}
    </Card>
  );
}
