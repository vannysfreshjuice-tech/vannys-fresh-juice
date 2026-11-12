// Attendance and wages, worked out from the attendance marks and the payments made.
import { addDays, fromYmd } from './dates';
import { num, sum } from './money';
import type { Attendance, Staff, WagePayment } from './types';

/** The Monday of the week that holds this day. */
export function weekStart(day: string): string {
  const d = fromYmd(day).getDay(); // 0 Sunday
  return addDays(day, d === 0 ? -6 : 1 - d);
}

export const weekDays = (day: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));

export interface WageLine {
  staff: Staff;
  /** true present, false absent, undefined not marked, for Monday to Sunday */
  week: (boolean | undefined)[];
  daysPresent: number;
  earned: number;
  advances: number;
  paid: number;
  due: number;
  /** 'this week' for day workers, 'this month' for monthly staff */
  period: string;
}

/**
 * Day workers: days marked present this week x the day rate, less advances and wages paid this week.
 * Monthly staff: the month's pay, less advances and wages paid this month.
 */
export function wageLines(staff: Staff[], attendance: Attendance[], wages: WagePayment[], today: string): WageLine[] {
  const days = weekDays(today);
  const month = today.slice(0, 7);
  return staff
    .filter((s) => !s.archived)
    .map((s) => {
      const week = days.map((d) => attendance.find((a) => a.staffId === s.id && a.date === d)?.present);
      const daysPresent = week.filter((w) => w === true).length;
      const inWeek = (w: WagePayment) => w.date >= days[0] && w.date <= days[6];
      const inMonth = (w: WagePayment) => w.date.slice(0, 7) === month;
      const mine = wages.filter((w) => w.staffId === s.id && (s.payKind === 'day' ? inWeek(w) : inMonth(w)));
      const earned = s.payKind === 'day' ? daysPresent * num(s.rate) : s.payKind === 'month' ? num(s.rate) : 0;
      const advances = sum(mine.filter((w) => w.kind === 'advance'), (w) => w.amount);
      const paid = sum(mine.filter((w) => w.kind === 'wage'), (w) => w.amount);
      return { staff: s, week, daysPresent, earned, advances, paid, due: Math.max(0, earned - advances - paid), period: s.payKind === 'day' ? 'this week' : 'this month' };
    });
}
