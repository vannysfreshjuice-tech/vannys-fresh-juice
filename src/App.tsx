// How the app is put together:
//   notices and confirms > where the records live (this device for now; the cloud with a PIN
//   per person comes next) > the records themselves (loaded once) > windows > pages.
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { LockGate } from './components/Lock';
import { SheetProvider } from './components/SheetHost';
import { Button, ConfirmProvider, NoticeProvider, useNotice } from './components/ui';
import { DataProvider, useData } from './data/DataContext';
import { makeLocalStore } from './data/localStore';
import { mayOpen } from './lib/nav';
import { onUpdateReady } from './lib/update';
import { Customers, Expenses, StaffPage } from './pages/Business';
import { Home } from './pages/Home';
import { ManualPage } from './pages/Manual';
import { Orders, Reminders } from './pages/Orders';
import { Production, Recipes } from './pages/Production';
import { Reports } from './pages/Reports';
import { Sell } from './pages/Sell';
import { SettingsPage } from './pages/Settings';
import { Buying, Stock } from './pages/StockPages';

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error(error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <img src="./brand/mark.png" alt="" className="h-20" />
        <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
        <p className="max-w-sm text-muted">Your records are safe. Reload the app to carry on.</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }
}

function UpdateBanner() {
  const [apply, setApply] = useState<(() => void) | null>(null);
  const [updating, setUpdating] = useState(false);
  useEffect(() => onUpdateReady((fn) => setApply(() => fn)), []);
  if (!apply) return null;
  return (
    <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] z-[85] flex justify-center px-4 md:bottom-6">
      <div className="flex items-center gap-3 rounded-2xl bg-choc py-2 pr-2 pl-4 text-sm font-medium text-white shadow-xl">
        {updating ? 'Updating, one moment…' : 'A new version is ready'}
        <button
          type="button"
          className="btn btn-sm min-h-11 bg-white px-4 text-choc"
          disabled={updating}
          onClick={() => {
            setUpdating(true);
            apply();
          }}
        >
          {updating ? 'Updating…' : 'Update'}
        </button>
      </div>
    </div>
  );
}

/** A page the person may open, inside the frame; otherwise back to Home. */
function Page({ to, children }: { to: string; children: ReactNode }) {
  const { role } = useData();
  if (!mayOpen(role, to)) return <Navigate to="/" replace />;
  return <Layout hideAdd={to === '/sell'}>{children}</Layout>;
}

function Pages() {
  return (
    <SheetProvider>
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<Page to="/"><Home /></Page>} />
          <Route path="/sell" element={<Page to="/sell"><Sell /></Page>} />
          <Route path="/orders" element={<Page to="/orders"><Orders /></Page>} />
          <Route path="/reminders" element={<Page to="/reminders"><Reminders /></Page>} />
          <Route path="/make" element={<Page to="/make"><Production /></Page>} />
          <Route path="/recipes" element={<Page to="/recipes"><Recipes /></Page>} />
          <Route path="/stock" element={<Page to="/stock"><Stock /></Page>} />
          <Route path="/buying" element={<Page to="/buying"><Buying /></Page>} />
          <Route path="/customers" element={<Page to="/customers"><Customers /></Page>} />
          <Route path="/expenses" element={<Page to="/expenses"><Expenses /></Page>} />
          <Route path="/staff" element={<Page to="/staff"><StaffPage /></Page>} />
          <Route path="/reports" element={<Page to="/reports"><Reports /></Page>} />
          <Route path="/settings" element={<Page to="/settings"><SettingsPage /></Page>} />
          <Route path="/help" element={<Page to="/help"><ManualPage /></Page>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </SheetProvider>
  );
}

function WithRecords() {
  const notify = useNotice();
  const store = useMemo(() => makeLocalStore(), []);
  return (
    <DataProvider store={store} onWriteError={(m) => notify(m, 'bad')}>
      <LockGate>
        <HashRouter>
          <Pages />
        </HashRouter>
      </LockGate>
    </DataProvider>
  );
}

export default function App() {
  return (
    <NoticeProvider>
      <ConfirmProvider>
        <WithRecords />
      </ConfirmProvider>
      <UpdateBanner />
    </NoticeProvider>
  );
}
