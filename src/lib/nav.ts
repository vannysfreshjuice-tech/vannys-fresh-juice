// The app's pages, defined once: the sidebar, the phone tabs, the More menu and who may open what.
import { BarChart3, Bell, BookOpen, Boxes, CalendarDays, CupSoda, House, ReceiptText, Settings as SettingsIcon, ShoppingBasket, ShoppingCart, Truck, UserRound, Users, Blend, type LucideIcon } from 'lucide-react';
import type { Role } from './types';

export interface PageDef {
  to: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  group: 'Daily work' | 'Making juice' | 'The business';
  roles: Role[] | 'all';
  /** A phone tab (for everyone who may open it, or only for these roles); the rest are under More */
  tab?: boolean | Role[];
}

export const isTab = (p: PageDef, role: Role) => (Array.isArray(p.tab) ? p.tab.includes(role) : !!p.tab);

export const PAGES: PageDef[] = [
  { to: '/', label: 'Home', icon: House, group: 'Daily work', roles: 'all', tab: true },
  { to: '/day', label: 'Day list', short: 'Day list', icon: CalendarDays, group: 'Daily work', roles: ['owner', 'sales'], tab: true },
  { to: '/sell', label: 'Sell', icon: ShoppingCart, group: 'Daily work', roles: ['owner', 'sales'], tab: true },
  { to: '/orders', label: 'Orders and deliveries', short: 'Orders', icon: Truck, group: 'Daily work', roles: ['owner', 'sales', 'rider'], tab: true },
  { to: '/reminders', label: 'Reminders', icon: Bell, group: 'Daily work', roles: 'all' },
  // A phone tab for the production staff only; for the owner the Day list took its place (Production is under More).
  { to: '/make', label: 'Production', short: 'Make', icon: Blend, group: 'Making juice', roles: ['owner', 'production'], tab: ['production'] },
  { to: '/recipes', label: 'Recipes and prices', short: 'Recipes', icon: CupSoda, group: 'Making juice', roles: ['owner', 'production'] },
  { to: '/stock', label: 'Stock', icon: Boxes, group: 'Making juice', roles: ['owner', 'production', 'sales'] },
  { to: '/buying', label: 'Buying and suppliers', short: 'Buying', icon: ShoppingBasket, group: 'Making juice', roles: ['owner', 'production'] },
  { to: '/customers', label: 'Customers', icon: Users, group: 'The business', roles: ['owner', 'sales'] },
  { to: '/expenses', label: 'Expenses', icon: ReceiptText, group: 'The business', roles: ['owner'] },
  { to: '/staff', label: 'Staff and wages', short: 'Staff', icon: UserRound, group: 'The business', roles: ['owner'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, group: 'The business', roles: ['owner'] },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, group: 'The business', roles: ['owner'] },
  { to: '/help', label: 'Help (user manual)', short: 'Help', icon: BookOpen, group: 'The business', roles: 'all' },
];

export const GROUPS: PageDef['group'][] = ['Daily work', 'Making juice', 'The business'];

export function mayOpen(role: Role, to: string): boolean {
  const p = PAGES.find((x) => x.to === to);
  return !!p && (p.roles === 'all' || p.roles.includes(role));
}

export const pagesFor = (role: Role) => PAGES.filter((p) => p.roles === 'all' || p.roles.includes(role));

/** Who sees money (sales figures, profit, balances). */
export const seesMoney = (role: Role) => role === 'owner' || role === 'sales';
