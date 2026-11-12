// Every form and detail window in the app is opened from here by name, e.g. open({ t: 'order' }).
// Windows stack: a detail window can open its edit form on top, and closing returns to the detail.
// (Windows are opened by this call, not by a "?new=1" in the address, which caused trouble before.)
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { ItemKind, OrderLine, PaymentKind, ProductKind } from '../lib/types';
import { MoreSheet, QuickSheet, WhoSheet } from '../sheets/menus';
import { OrderForm, OrderView } from '../sheets/orders';
import { CustomerForm, CustomerView, ExpenseForm, ReminderForm, StaffForm, WageForm } from '../sheets/people';
import { BatchForm, BatchView, BottleForm, ProductForm, WriteOffForm } from '../sheets/production';
import { Checkout, PaymentForm, Receipt, SaleView } from '../sheets/sales';
import { CountForm, ItemForm, PurchaseForm, PurchaseView, ReadingForm, SupplierForm } from '../sheets/stock';

export type SheetSpec =
  | { t: 'quick' }
  | { t: 'more' }
  | { t: 'who' }
  | { t: 'checkout'; lines: OrderLine[]; onDone: () => void }
  | { t: 'receipt'; id: string }
  | { t: 'saleView'; id: string }
  | { t: 'payment'; kind: PaymentKind; refId: string }
  | { t: 'order'; id?: string; customerName?: string }
  | { t: 'orderView'; id: string }
  | { t: 'batch'; productId?: string }
  | { t: 'batchView'; id: string }
  | { t: 'bottle'; id: string }
  | { t: 'writeOff'; batchId?: string }
  | { t: 'product'; id?: string; kind?: ProductKind }
  | { t: 'item'; id?: string; kind?: ItemKind }
  | { t: 'count'; itemId: string }
  | { t: 'purchase'; itemId?: string }
  | { t: 'purchaseView'; id: string }
  | { t: 'supplier'; id?: string }
  | { t: 'customer'; id?: string }
  | { t: 'customerView'; id: string }
  | { t: 'expense'; id?: string }
  | { t: 'staff'; id?: string }
  | { t: 'wage'; staffId?: string; kind?: 'wage' | 'advance'; amount?: number }
  | { t: 'reminder'; id?: string; orderId?: string }
  | { t: 'reading' };

interface SheetsApi {
  open: (spec: SheetSpec) => void;
  /** Closes the top window and opens another in its place */
  swap: (spec: SheetSpec) => void;
  close: () => void;
}

const SheetsContext = createContext<SheetsApi>({ open: () => {}, swap: () => {}, close: () => {} });
export const useSheets = () => useContext(SheetsContext);

function render(spec: SheetSpec, close: () => void) {
  switch (spec.t) {
    case 'quick':
      return <QuickSheet onClose={close} />;
    case 'more':
      return <MoreSheet onClose={close} />;
    case 'who':
      return <WhoSheet onClose={close} />;
    case 'checkout':
      return <Checkout lines={spec.lines} onDone={spec.onDone} onClose={close} />;
    case 'receipt':
      return <Receipt id={spec.id} onClose={close} />;
    case 'saleView':
      return <SaleView id={spec.id} onClose={close} />;
    case 'payment':
      return <PaymentForm kind={spec.kind} refId={spec.refId} onClose={close} />;
    case 'order':
      return <OrderForm id={spec.id} customerName={spec.customerName} onClose={close} />;
    case 'orderView':
      return <OrderView id={spec.id} onClose={close} />;
    case 'batch':
      return <BatchForm productId={spec.productId} onClose={close} />;
    case 'batchView':
      return <BatchView id={spec.id} onClose={close} />;
    case 'bottle':
      return <BottleForm id={spec.id} onClose={close} />;
    case 'writeOff':
      return <WriteOffForm batchId={spec.batchId} onClose={close} />;
    case 'product':
      return <ProductForm id={spec.id} kind={spec.kind} onClose={close} />;
    case 'item':
      return <ItemForm id={spec.id} kind={spec.kind} onClose={close} />;
    case 'count':
      return <CountForm itemId={spec.itemId} onClose={close} />;
    case 'purchase':
      return <PurchaseForm itemId={spec.itemId} onClose={close} />;
    case 'purchaseView':
      return <PurchaseView id={spec.id} onClose={close} />;
    case 'supplier':
      return <SupplierForm id={spec.id} onClose={close} />;
    case 'customer':
      return <CustomerForm id={spec.id} onClose={close} />;
    case 'customerView':
      return <CustomerView id={spec.id} onClose={close} />;
    case 'expense':
      return <ExpenseForm id={spec.id} onClose={close} />;
    case 'staff':
      return <StaffForm id={spec.id} onClose={close} />;
    case 'wage':
      return <WageForm staffId={spec.staffId} kind={spec.kind} amount={spec.amount} onClose={close} />;
    case 'reminder':
      return <ReminderForm id={spec.id} orderId={spec.orderId} onClose={close} />;
    case 'reading':
      return <ReadingForm onClose={close} />;
  }
}

export function SheetProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ key: number; spec: SheetSpec }[]>([]);
  const open = useCallback((spec: SheetSpec) => setStack((s) => [...s, { key: Date.now() + Math.random(), spec }]), []);
  const close = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const swap = useCallback((spec: SheetSpec) => setStack((s) => [...s.slice(0, -1), { key: Date.now() + Math.random(), spec }]), []);
  const api = useMemo(() => ({ open, close, swap }), [open, close, swap]);
  // Going to another page closes any open window.
  const { pathname } = useLocation();
  useEffect(() => setStack([]), [pathname]);
  return (
    <SheetsContext.Provider value={api}>
      {children}
      {stack.map((s) => (
        <div key={s.key}>{render(s.spec, close)}</div>
      ))}
    </SheetsContext.Provider>
  );
}
