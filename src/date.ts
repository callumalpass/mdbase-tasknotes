import { isValid, parseISO } from "date-fns";

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))?$/;
const RELAXED_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T| )(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|([+-])(\d{2}):(\d{2}))?$/;

export type DateTimeRangeBound = "from" | "to";

export function parseDateToUTC(dateString: string): Date {
  if (!dateString || dateString.trim().length === 0) {
    throw new Error("Date string cannot be empty");
  }

  const trimmed = dateString.trim();
  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const parsed = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));

    if (
      parsed.getUTCFullYear() !== y ||
      parsed.getUTCMonth() !== m - 1 ||
      parsed.getUTCDate() !== d
    ) {
      throw new Error(`Invalid date "${dateString}".`);
    }
    return parsed;
  }

  if (!isStrictDateTime(trimmed)) {
    throw new Error(`Invalid date "${dateString}".`);
  }

  const parsed = parseISO(trimmed);
  if (!isValid(parsed)) {
    throw new Error(`Invalid date "${dateString}".`);
  }
  return parsed;
}

export function parseDateToLocal(dateString: string): Date {
  if (!dateString || dateString.trim().length === 0) {
    throw new Error("Date string cannot be empty");
  }

  const trimmed = dateString.trim();
  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    const parsed = new Date(y, m - 1, d, 0, 0, 0, 0);

    if (
      parsed.getFullYear() !== y ||
      parsed.getMonth() !== m - 1 ||
      parsed.getDate() !== d
    ) {
      throw new Error(`Invalid date "${dateString}".`);
    }
    return parsed;
  }

  if (!isStrictDateTime(trimmed)) {
    throw new Error(`Invalid date "${dateString}".`);
  }

  const parsed = parseISO(trimmed);
  if (!isValid(parsed)) {
    throw new Error(`Invalid date "${dateString}".`);
  }
  return parsed;
}

export function formatDateForStorage(date: Date): string {
  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getCurrentDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function resolveDateOrToday(date?: string): string {
  if (!date) {
    return getCurrentDateString();
  }
  return validateDateString(date);
}

/**
 * Resolve operation target date for recurring instance actions.
 * Priority:
 * 1) explicit input date
 * 2) scheduled date part
 * 3) due date part
 * 4) current local day
 */
export function resolveOperationTargetDate(
  explicitDate: string | undefined,
  scheduled: string | undefined,
  due: string | undefined,
): string {
  if (explicitDate) {
    return validateDateString(explicitDate);
  }

  const scheduledDatePart = extractValidDatePartOrUndefined(scheduled);
  if (scheduledDatePart) {
    return scheduledDatePart;
  }

  const dueDatePart = extractValidDatePartOrUndefined(due);
  if (dueDatePart) {
    return dueDatePart;
  }

  return getCurrentDateString();
}

export function validateDateString(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date "${date}". Expected YYYY-MM-DD.`);
  }

  parseDateToUTC(date);
  return date;
}

export function resolveDateTimeRangeBound(value: string, bound: DateTimeRangeBound): Date {
  if (!value || value.trim().length === 0) {
    throw new Error("Datetime cannot be empty.");
  }

  const trimmed = value.trim();
  const dateOnlyMatch = trimmed.match(DATE_ONLY_RE);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!isValidCalendarDate(y, m, d)) {
      throw new Error(`Invalid datetime "${value}".`);
    }

    return bound === "from"
      ? new Date(y, m - 1, d, 0, 0, 0, 0)
      : new Date(y, m - 1, d, 23, 59, 59, 999);
  }

  const match = trimmed.match(RELAXED_DATE_TIME_RE);
  if (!match) {
    throw new Error(
      `Invalid datetime "${value}". Expected YYYY-MM-DD, YYYY-MM-DD HH:mm, or YYYY-MM-DDTHH:mm.`,
    );
  }

  const [, year, month, day, hours, minutes, seconds, fraction, tz, tzSign, tzHours, tzMinutes] = match;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const hh = Number(hours);
  const mm = Number(minutes);
  const ss = seconds === undefined ? (bound === "to" ? 59 : 0) : Number(seconds);
  const ms = fraction
    ? Number(fraction.slice(1).padEnd(3, "0"))
    : bound === "to"
      ? 999
      : 0;

  if (
    !isValidCalendarDate(y, m, d) ||
    !isValidClockTime(hh, mm, ss) ||
    !isValidOffset(tzSign, tzHours, tzMinutes)
  ) {
    throw new Error(`Invalid datetime "${value}".`);
  }

  const normalized =
    `${year}-${month}-${day}T${hours}:${minutes}:${String(ss).padStart(2, "0")}` +
    `.${String(ms).padStart(3, "0")}${tz || ""}`;
  const parsed = parseISO(normalized);
  if (!isValid(parsed)) {
    throw new Error(`Invalid datetime "${value}".`);
  }
  return parsed;
}

export function hasTimeComponent(dateString: string | undefined): boolean {
  if (!dateString) return false;
  return /T\d{2}:\d{2}/.test(dateString);
}

export function getDatePart(dateString: string): string {
  if (!dateString) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  const tIndex = dateString.indexOf("T");
  if (tIndex > -1) {
    return dateString.slice(0, tIndex);
  }
  return formatDateForStorage(parseDateToUTC(dateString));
}

function extractValidDatePartOrUndefined(dateString: string | undefined): string | undefined {
  if (!dateString || dateString.trim().length === 0) {
    return undefined;
  }

  try {
    const datePart = getDatePart(dateString.trim());
    return validateDateString(datePart);
  } catch {
    return undefined;
  }
}

export function isSameDateSafe(date1: string, date2: string): boolean {
  try {
    const d1 = parseDateToUTC(getDatePart(date1));
    const d2 = parseDateToUTC(getDatePart(date2));
    return d1.getTime() === d2.getTime();
  } catch {
    return false;
  }
}

export function isBeforeDateSafe(date1: string, date2: string): boolean {
  try {
    const d1 = parseDateToUTC(getDatePart(date1));
    const d2 = parseDateToUTC(getDatePart(date2));
    return d1.getTime() < d2.getTime();
  } catch {
    return false;
  }
}

function isStrictDateTime(value: string): boolean {
  const match = value.match(DATE_TIME_RE);
  if (!match) return false;

  const [, year, month, day, hours, minutes, seconds, , tzSign, tzHours, tzMinutes] = match;

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const hh = Number(hours);
  const mm = Number(minutes);
  const ss = Number(seconds);

  if (!isValidClockTime(hh, mm, ss) || !isValidCalendarDate(y, m, d)) {
    return false;
  }

  return isValidOffset(tzSign, tzHours, tzMinutes);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function isValidClockTime(hours: number, minutes: number, seconds: number): boolean {
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && seconds >= 0 && seconds <= 59;
}

function isValidOffset(
  tzSign: string | undefined,
  tzHours: string | undefined,
  tzMinutes: string | undefined,
): boolean {
  if (!tzSign) return true;

  const offsetHours = Number(tzHours);
  const offsetMinutes = Number(tzMinutes);
  if (offsetHours > 14 || offsetMinutes > 59) return false;
  if (offsetHours === 14 && offsetMinutes !== 0) return false;
  return true;
}
