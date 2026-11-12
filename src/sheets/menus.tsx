// The + menu, the phone's More menu, and "who is using the app" (until the PIN sign-in).
import { Bell, Blend, Droplet, ReceiptText, ShoppingBasket, ShoppingCart, Thermometer, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSheets, type SheetSpec } from '../components/SheetHost';
import { Sheet, cx } from '../components/ui';
import { useData } from '../data/DataContext';
import { mayOpen, pagesFor } from '../lib/nav';
import { ROLE_NAMES } from '../lib/types';

const tile = 'card flex min-h-24 flex-col items-start gap-2 p-4 text-left font-semibold active:bg-accent-soft';
const iconBox = 'flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent-dark';

export function QuickSheet({ onClose }: { onClose: () => void }) {
  const { role } = useData();
  const sheets = useSheets();
  const navigate = useNavigate();
  const items: { page: string; label: string; icon: typeof Bell; go: () => void }[] = [
    { page: '/sell', label: 'New sale', icon: ShoppingCart, go: () => { onClose(); navigate('/sell'); } },
    { page: '/orders', label: 'New order', icon: Truck, go: () => sheets.swap({ t: 'order' }) },
    { page: '/make', label: 'New batch', icon: Blend, go: () => sheets.swap({ t: 'batch' }) },
    { page: '/buying', label: 'Buy fruit or supplies', icon: ShoppingBasket, go: () => sheets.swap({ t: 'purchase' }) },
    { page: '/expenses', label: 'Expense', icon: ReceiptText, go: () => sheets.swap({ t: 'expense' }) },
    { page: '/stock', label: 'Write off spoiled juice', icon: Droplet, go: () => sheets.swap({ t: 'writeOff' }) },
    { page: '/stock', label: 'Fridge temperature', icon: Thermometer, go: () => sheets.swap({ t: 'reading' }) },
    { page: '/reminders', label: 'Reminder', icon: Bell, go: () => sheets.swap({ t: 'reminder' } as SheetSpec) },
  ].filter((i) => mayOpen(role, i.page) && !(role === 'sales' && i.label.startsWith('Write off')));
  return (
    <Sheet title="New" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2.5">
        {items.map((i) => (
          <button key={i.label} type="button" className={tile} onClick={i.go}>
            <span className={iconBox}>
              <i.icon size={18} aria-hidden />
            </span>
            {i.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function MoreSheet({ onClose }: { onClose: () => void }) {
  const { role } = useData();
  const navigate = useNavigate();
  const list = pagesFor(role).filter((p) => !p.tab);
  return (
    <Sheet title="More" onClose={onClose}>
      <div className="grid grid-cols-2 gap-2.5">
        {list.map((p) => (
          <button
            key={p.to}
            type="button"
            className={tile}
            onClick={() => {
              onClose();
              navigate(p.to);
            }}
          >
            <span className={iconBox}>
              <p.icon size={18} aria-hidden />
            </span>
            {p.label}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** On this device, who is using the app. With the cloud, each person's own PIN decides this. */
export function WhoSheet({ onClose }: { onClose: () => void }) {
  const { staff, me, setMe } = useData();
  const navigate = useNavigate();
  const people = staff.filter((s) => !s.archived);
  const pick = (id: string) => {
    setMe(id);
    onClose();
    navigate('/');
  };
  return (
    <Sheet title="Who is using the app?" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Each person sees only their part of the app. When the app is connected to the cloud, each person opens it with their own PIN instead.</p>
      <div className="card divide-y divide-line overflow-hidden">
        {people.map((s) => (
          <button key={s.id} type="button" onClick={() => pick(s.id)} className={cx('row', me?.id === s.id && 'bg-accent-soft')}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{s.name}</span>
              <span className="text-sm text-muted">
                {ROLE_NAMES[s.role]}
                {s.job ? ` · ${s.job}` : ''}
              </span>
            </span>
            {me?.id === s.id && <span className="text-sm font-semibold text-accent-dark">Using now</span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}
