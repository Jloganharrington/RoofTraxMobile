/**
 * Business-day math for trial turnaround (spec §7).
 * Excludes weekends and US federal holidays (with weekend observance shifts).
 */

function observed(d: Date): Date {
  const day = d.getUTCDay();
  const out = new Date(d);
  if (day === 6) out.setUTCDate(out.getUTCDate() - 1); // Sat → Fri
  if (day === 0) out.setUTCDate(out.getUTCDate() + 1); // Sun → Mon
  return out;
}

function nthWeekday(year: number, month: number, weekday: number, n: number): Date {
  const d = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (true) {
    if (d.getUTCDay() === weekday) {
      count++;
      if (count === n) return d;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

function lastWeekday(year: number, month: number, weekday: number): Date {
  const d = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

const holidayCache = new Map<number, Set<string>>();

/** ISO date strings (YYYY-MM-DD) of observed US federal holidays for a year. */
export function usFederalHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const days: Date[] = [
    observed(new Date(Date.UTC(year, 0, 1))),     // New Year's Day
    nthWeekday(year, 0, 1, 3),                    // MLK Day — 3rd Mon Jan
    nthWeekday(year, 1, 1, 3),                    // Washington's Birthday — 3rd Mon Feb
    lastWeekday(year, 4, 1),                      // Memorial Day — last Mon May
    observed(new Date(Date.UTC(year, 5, 19))),    // Juneteenth
    observed(new Date(Date.UTC(year, 6, 4))),     // Independence Day
    nthWeekday(year, 8, 1, 1),                    // Labor Day — 1st Mon Sep
    nthWeekday(year, 9, 1, 2),                    // Columbus Day — 2nd Mon Oct
    observed(new Date(Date.UTC(year, 10, 11))),   // Veterans Day
    nthWeekday(year, 10, 4, 4),                   // Thanksgiving — 4th Thu Nov
    observed(new Date(Date.UTC(year, 11, 25))),   // Christmas Day
  ];
  const set = new Set(days.map((d) => d.toISOString().slice(0, 10)));
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(d: Date): boolean {
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;
  return !usFederalHolidays(d.getUTCFullYear()).has(d.toISOString().slice(0, 10));
}

/** Add N business days to a date (skipping weekends + federal holidays). */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}
