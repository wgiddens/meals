/**
 * Date helpers. Everything the planner does is in terms of calendar dates
 * ("YYYY-MM-DD") in the household's timezone, never JS Date objects at
 * midnight UTC, which are a classic source of off-by-one-day bugs.
 */

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function householdTimezone(): string {
  return process.env.HOUSEHOLD_TIMEZONE || "America/New_York";
}

/** Today's calendar date in the household timezone, as YYYY-MM-DD. */
export function todayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: householdTimezone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toUtcDate(value).getTime());
}

/** Parse an ISO date into a Date at UTC midnight (safe for arithmetic). */
export function toUtcDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toUtcDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtcDate(d);
}

/** 0 = Sunday ... 6 = Saturday */
export function dayOfWeek(iso: string): number {
  return toUtcDate(iso).getUTCDay();
}

export function dayName(iso: string): string {
  return DAY_NAMES[dayOfWeek(iso)];
}

/** The Sunday on or before the given date. Weeks start on Sunday here. */
export function weekStart(iso: string): string {
  return addDays(iso, -dayOfWeek(iso));
}

export function weekDates(start: string, days = 7): string[] {
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

export function formatShort(iso: string): string {
  return toUtcDate(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatLong(iso: string): string {
  return toUtcDate(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "tonight", "tomorrow", "Thursday", or a date, relative to today. */
export function relativeLabel(iso: string, today = todayIso()): string {
  if (iso === today) return "tonight";
  if (iso === addDays(today, 1)) return "tomorrow";
  if (iso === addDays(today, -1)) return "last night";
  const diff = (toUtcDate(iso).getTime() - toUtcDate(today).getTime()) / 86_400_000;
  if (diff > 1 && diff < 7) return dayName(iso);
  return formatLong(iso);
}
