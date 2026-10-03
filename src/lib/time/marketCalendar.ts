/**
 * U.S. equity market calendar, always evaluated in America/New_York.
 *
 * Holidays follow the NYSE rule set (Rule 7.2):
 *  - New Year's Day, MLK Day (3rd Mon Jan), Washington's Birthday (3rd Mon Feb), Good Friday,
 *    Memorial Day (last Mon May), Juneteenth (from 2022), Independence Day, Labor Day (1st Mon Sep),
 *    Thanksgiving (4th Thu Nov), Christmas.
 *  - Saturday holidays are observed on the preceding Friday, Sunday holidays on the following Monday,
 *    EXCEPT New Year's Day on a Saturday, which is not observed (Dec 31 stays a trading day).
 *  - Early 1:00 pm ET closes: July 3 (when a weekday trading day), the day after Thanksgiving, Dec 24.
 * Unscheduled closures (e.g. national days of mourning) are configured via MARKET_EXTRA_CLOSURES
 * (comma-separated YYYY-MM-DD) so they can be added without a code change.
 *
 * Daylight-saving time is handled by Intl with the IANA zone, never by fixed UTC offsets.
 */

export const MARKET_TZ = "America/New_York";

/** YYYY-MM-DD */
export type IsoDate = string;

export interface EtParts {
  date: IsoDate;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday */
  weekday: number;
  /** minutes since midnight ET */
  minutes: number;
}

const etFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: MARKET_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function toEt(instant: Date): EtParts {
  const parts = Object.fromEntries(etFormatter.formatToParts(instant).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    year,
    month,
    day,
    hour,
    minute,
    weekday: WEEKDAYS[parts.weekday as string] ?? 0,
    minutes: hour * 60 + minute,
  };
}

/** Convert a wall-clock time in New York to a UTC instant (DST-aware). */
export function etWallTimeToUtc(date: IsoDate, hour: number, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  // Start with the naive UTC guess, then correct by the zone offset observed at that instant (twice for DST edges).
  let guess = Date.UTC(y, m - 1, d, hour, minute);
  for (let i = 0; i < 2; i++) {
    const et = toEt(new Date(guess));
    const etAsUtc = Date.UTC(et.year, et.month - 1, et.day, et.hour, et.minute);
    guess += Date.UTC(y, m - 1, d, hour, minute) - etAsUtc;
  }
  return new Date(guess);
}

function iso(y: number, m: number, d: number): IsoDate {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function nthWeekday(y: number, m: number, weekday: number, n: number): IsoDate {
  const first = weekdayOf(y, m, 1);
  const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  return iso(y, m, day);
}

function lastWeekday(y: number, m: number, weekday: number): IsoDate {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wd = weekdayOf(y, m, lastDay);
  return iso(y, m, lastDay - ((wd - weekday + 7) % 7));
}

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(y: number): IsoDate {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(y, month, day);
}

function observed(y: number, m: number, d: number): IsoDate {
  const wd = weekdayOf(y, m, d);
  if (wd === 6) return addDays(iso(y, m, d), -1);
  if (wd === 0) return addDays(iso(y, m, d), 1);
  return iso(y, m, d);
}

export interface Holiday {
  date: IsoDate;
  name: string;
}

const holidayCache = new Map<number, Holiday[]>();

export function nyseHolidays(year: number): Holiday[] {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const list: Holiday[] = [];
  // New Year's Day: Saturday -> not observed; Sunday -> Monday.
  const nyWd = weekdayOf(year, 1, 1);
  if (nyWd !== 6) list.push({ date: nyWd === 0 ? iso(year, 1, 2) : iso(year, 1, 1), name: "New Year's Day" });
  list.push({ date: nthWeekday(year, 1, 1, 3), name: "Martin Luther King Jr. Day" });
  list.push({ date: nthWeekday(year, 2, 1, 3), name: "Washington's Birthday" });
  list.push({ date: addDays(easterSunday(year), -2), name: "Good Friday" });
  list.push({ date: lastWeekday(year, 5, 1), name: "Memorial Day" });
  if (year >= 2022) list.push({ date: observed(year, 6, 19), name: "Juneteenth National Independence Day" });
  list.push({ date: observed(year, 7, 4), name: "Independence Day" });
  list.push({ date: nthWeekday(year, 9, 1, 1), name: "Labor Day" });
  list.push({ date: nthWeekday(year, 11, 4, 4), name: "Thanksgiving Day" });
  list.push({ date: observed(year, 12, 25), name: "Christmas Day" });
  list.sort((a, b) => a.date.localeCompare(b.date));
  holidayCache.set(year, list);
  return list;
}

function extraClosures(): Set<IsoDate> {
  return new Set(
    (process.env.MARKET_EXTRA_CLOSURES ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  );
}

export function holidayOn(date: IsoDate): Holiday | undefined {
  const year = Number(date.slice(0, 4));
  const found = nyseHolidays(year).find((h) => h.date === date);
  if (found) return found;
  if (extraClosures().has(date)) return { date, name: "Unscheduled market closure" };
  return undefined;
}

export function isWeekend(date: IsoDate): boolean {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const wd = weekdayOf(y, m, d);
  return wd === 0 || wd === 6;
}

export function isTradingDay(date: IsoDate): boolean {
  return !isWeekend(date) && !holidayOn(date);
}

/** Regular close in minutes after midnight ET (960 = 4:00 pm, 780 = 1:00 pm early close). */
export function closeMinutes(date: IsoDate): number | null {
  if (!isTradingDay(date)) return null;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  if (date === addDays(thanksgiving, 1)) return 13 * 60;
  if (m === 12 && d === 24) return 13 * 60;
  if (m === 7 && d === 3) return 13 * 60;
  return 16 * 60;
}

export const OPEN_MINUTES = 9 * 60 + 30;

export function previousTradingDay(date: IsoDate): IsoDate {
  let d = addDays(date, -1);
  while (!isTradingDay(d)) d = addDays(d, -1);
  return d;
}

export function nextTradingDay(date: IsoDate): IsoDate {
  let d = addDays(date, 1);
  while (!isTradingDay(d)) d = addDays(d, 1);
  return d;
}

export type MarketStatus = "pre_market" | "open" | "after_hours" | "closed";

export function marketStatus(now: Date): { status: MarketStatus; label: string; date: IsoDate; holiday?: string } {
  const et = toEt(now);
  const holiday = holidayOn(et.date);
  if (isWeekend(et.date) || holiday) {
    return { status: "closed", label: holiday ? `Market closed (${holiday.name})` : "Market closed (weekend)", date: et.date, holiday: holiday?.name };
  }
  const close = closeMinutes(et.date)!;
  if (et.minutes < 4 * 60) return { status: "closed", label: "Market closed", date: et.date };
  if (et.minutes < OPEN_MINUTES) return { status: "pre_market", label: "Pre-market", date: et.date };
  if (et.minutes < close) return { status: "open", label: close < 960 ? "Market open (early close 1:00 pm ET)" : "Market open", date: et.date };
  if (et.minutes < 20 * 60) return { status: "after_hours", label: "After hours", date: et.date };
  return { status: "closed", label: "Market closed", date: et.date };
}

/**
 * The most recent trading session whose regular close has already happened (+ a settle buffer),
 * i.e. the session a post-market job should be processing at `now`.
 */
export function lastCompletedSession(now: Date, settleMinutes = 15): IsoDate {
  const et = toEt(now);
  const close = closeMinutes(et.date);
  if (close !== null && et.minutes >= close + settleMinutes) return et.date;
  return previousTradingDay(et.date);
}

/** ISO-8601 week key, e.g. "2026-W40", evaluated on the ET calendar date. */
export function isoWeekKey(date: IsoDate): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
