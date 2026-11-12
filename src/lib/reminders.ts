// Reminders reach a phone two ways that need no server:
// - a calendar file (.ics) with an alarm 15 minutes before: iPhone and Android calendars both open it;
// - a WhatsApp message with the reminder already written (the person presses Send).
// (Notifications sent by the app itself are a future addition: they need a server job.)
import type { Order, Reminder, Staff } from './types';

const pad = (n: number) => String(n).padStart(2, '0');

/** The text a calendar file needs: commas, semicolons and line breaks escaped. */
const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\r?\n/g, '\\n');

export function reminderIcs(r: Reminder, who: string, businessName: string, stamp = new Date()): string {
  const start = `${r.date.replace(/-/g, '')}T${(r.time || '06:00').replace(':', '')}00`;
  const dtstamp = `${stamp.getUTCFullYear()}${pad(stamp.getUTCMonth() + 1)}${pad(stamp.getUTCDate())}T${pad(stamp.getUTCHours())}${pad(stamp.getUTCMinutes())}00Z`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    "PRODID:-//Vanny's Fresh Juice//Reminders//EN",
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:reminder-${r.id}@vannys-fresh-juice`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${start}`,
    'DURATION:PT30M',
    `SUMMARY:${esc(`${businessName}: ${r.what}`)}`,
    `DESCRIPTION:${esc(who ? `For ${who}` : businessName)}`,
    ...(r.repeat === 'daily' ? ['RRULE:FREQ=DAILY'] : r.repeat === 'weekly' ? ['RRULE:FREQ=WEEKLY'] : []),
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(r.what)}`,
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}

/** Ugandan numbers: 0772 123456 -> 256772123456. */
export function waNumber(phone: string | undefined): string {
  const d = (phone ?? '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('256')) return d;
  if (d.startsWith('0')) return '256' + d.slice(1);
  return d;
}

export function whatsappLink(phone: string | undefined, text: string): string {
  const n = waNumber(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** A reminder is shown until it is ticked done, or (when made for an order) the order is delivered or cancelled. */
export function isOpen(r: Reminder, orders: Map<string, Order>): boolean {
  if (r.done) return false;
  if (r.orderId) {
    const o = orders.get(r.orderId);
    if (!o || o.stage === 'Delivered' || o.stage === 'Cancelled') return false;
  }
  return true;
}

export const staffName = (staff: Map<string, Staff>, id?: string) => (id ? (staff.get(id)?.name ?? '') : '');
