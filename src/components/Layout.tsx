// The frame around every page.
// Laptop: a sidebar with the pages (only those the person may open). Phone: a top bar, bottom tabs,
// a More tab and a + button, all kept clear of the notch and the home bar.
import { Cloud, CloudOff, Ellipsis, Plus, RefreshCw, Smartphone } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useData, type SyncState } from '../data/DataContext';
import { GROUPS, pagesFor } from '../lib/nav';
import { ROLE_NAMES } from '../lib/types';
import { useSheets } from './SheetHost';
import { Button, cx } from './ui';

const SYNC: Record<SyncState, { text: string; icon: typeof Cloud; tone: string }> = {
  device: { text: 'Kept on this device', icon: Smartphone, tone: 'text-muted' },
  saved: { text: 'Saved to the cloud', icon: Cloud, tone: 'text-leaf' },
  sending: { text: 'Sending changes', icon: RefreshCw, tone: 'text-amber' },
  offline: { text: 'No connection: changes wait on this device', icon: CloudOff, tone: 'text-amber' },
};

export function SyncChip({ short }: { short?: boolean }) {
  const { sync } = useData();
  const s = SYNC[sync];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', s.tone)} title={s.text}>
      <s.icon size={14} aria-hidden />
      {short ? <span className="sr-only">{s.text}</span> : s.text}
    </span>
  );
}

/** Which page of the menu is on: the longest matching address. */
function activePage(pathname: string, list: { to: string }[]): string {
  let best = '/';
  for (const p of list) if (p.to !== '/' && (pathname === p.to || pathname.startsWith(p.to + '/')) && p.to.length > best.length) best = p.to;
  return best;
}

/** Who is using the app on this device (until the PIN sign-in arrives with the cloud). */
export function WhoChip() {
  const { me, role, staff, storeKind } = useData();
  const sheets = useSheets();
  if (storeKind !== 'device' || staff.filter((s) => !s.archived).length === 0) return null;
  return (
    <button type="button" onClick={() => sheets.open({ t: 'who' })} className="chip min-h-8 max-w-44 truncate px-2.5 text-xs">
      {me ? `${me.name} · ${ROLE_NAMES[role]}` : 'Owner'}
    </button>
  );
}

function Sidebar() {
  const { role, settings } = useData();
  const { pathname } = useLocation();
  const list = pagesFor(role);
  const active = activePage(pathname, list);
  const sheets = useSheets();
  const link = 'flex min-h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-muted hover:bg-page hover:text-ink';
  return (
    <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-line bg-card md:flex">
      <Link to="/" className="block px-4 pt-4 pb-3" aria-label="Home">
        <img src="./brand/logo.jpg" alt={settings.businessName} className="w-full rounded-xl" />
      </Link>
      <div className="px-3">
        <Button icon={Plus} className="w-full" onClick={() => sheets.open({ t: 'quick' })}>
          New
        </Button>
      </div>
      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-3" aria-label="Pages">
        {GROUPS.map((g) => {
          const items = list.filter((p) => p.group === g);
          if (!items.length) return null;
          return (
            <div key={g}>
              <p className="px-3 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-faint uppercase">{g}</p>
              {items.map((m) => (
                <Link key={m.to} to={m.to} aria-current={active === m.to ? 'page' : undefined} className={cx(link, active === m.to && 'bg-accent !text-white shadow-sm')}>
                  <m.icon size={18} aria-hidden />
                  {m.label}
                </Link>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="space-y-2 border-t border-line px-5 py-3">
        <WhoChip />
        <div>
          <SyncChip />
        </div>
      </div>
    </aside>
  );
}

function PhoneTop() {
  const { role } = useData();
  const { pathname } = useLocation();
  const list = pagesFor(role);
  const page = list.find((p) => p.to === activePage(pathname, list));
  return (
    <header className="no-print pt-safe border-b border-line bg-card md:hidden">
      <div className="px-safe flex h-12 items-center gap-2">
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-2" aria-label="Home">
          <img src="./brand/mark.png" alt="" className="h-9 w-auto" />
          <span className="truncate font-semibold">{page?.short ?? page?.label ?? "Vanny's"}</span>
        </Link>
        <WhoChip />
        <SyncChip short />
      </div>
    </header>
  );
}

function PhoneTabs() {
  const { role } = useData();
  const { pathname } = useLocation();
  const sheets = useSheets();
  const list = pagesFor(role);
  const active = activePage(pathname, list);
  const tabs = list.filter((m) => m.tab);
  const moreOn = !tabs.some((t) => t.to === active);
  const tab = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium';
  return (
    <nav className="no-print pb-safe border-t border-line bg-card md:hidden" aria-label="Pages">
      <div className="flex">
        {tabs.map((m) => (
          <Link key={m.to} to={m.to} aria-current={active === m.to ? 'page' : undefined} className={cx(tab, active === m.to ? 'text-accent-dark' : 'text-muted')}>
            <m.icon size={22} strokeWidth={active === m.to ? 2.4 : 1.9} aria-hidden />
            {m.short ?? m.label}
          </Link>
        ))}
        <button type="button" className={cx(tab, moreOn ? 'text-accent-dark' : 'text-muted')} onClick={() => sheets.open({ t: 'more' })}>
          <Ellipsis size={22} aria-hidden />
          More
        </button>
      </div>
    </nav>
  );
}

export function LoadNotice() {
  const { loadError, ready } = useData();
  if (loadError)
    return (
      <div role="alert" className="mb-4 rounded-2xl bg-cherry-soft px-4 py-3 text-sm text-cherry">
        <p className="font-semibold">The records could not be loaded.</p>
        <p className="mt-0.5">Nothing is lost: what you see may be incomplete, so do not rely on the figures. Check the connection, then reload.</p>
        <Button small variant="danger" className="mt-2" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  if (!ready) return <p className="mb-4 text-sm text-muted">Loading the records…</p>;
  return null;
}

export function Layout({ children, hideAdd }: { children: ReactNode; hideAdd?: boolean }) {
  const sheets = useSheets();
  const { pathname } = useLocation();
  // Each page starts at the top.
  useEffect(() => {
    document.getElementById('page-scroll')?.scrollTo(0, 0);
  }, [pathname]);
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <PhoneTop />
        <main id="page-scroll" className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-safe mx-auto w-full max-w-5xl pt-5 pb-28 md:px-8 md:pt-8 md:pb-12">
            <LoadNotice />
            {children}
          </div>
        </main>
        {!hideAdd && (
          <button
            type="button"
            aria-label="New"
            onClick={() => sheets.open({ t: 'quick' })}
            className="no-print absolute right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] flex h-14 w-14 items-center justify-center rounded-full bg-accent text-white shadow-lg shadow-accent/30 active:bg-accent-dark md:hidden"
          >
            <Plus size={28} aria-hidden />
          </button>
        )}
        <PhoneTabs />
      </div>
    </div>
  );
}
