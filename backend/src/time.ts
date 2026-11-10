export type ClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

export function partsInZone(instant: Date, timeZone: string): ClockParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

export function todayInZone(timeZone: string, now = new Date()): string {
  const parts = partsInZone(now, timeZone);
  return isoDate(parts.year, parts.month, parts.day);
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export function formatDateLabel(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}-${month}-${year}`;
}

/** Convert a workplace-local wall time to a UTC instant. */
export function zonedLocalToUtc(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = partsInZone(new Date(utc), timeZone);
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0);
    const drift = desired - observed;
    if (drift === 0) break;
    utc += drift;
  }
  return new Date(utc);
}

export type ShiftBounds = {
  startUtc: Date;
  endUtc: Date;
  crossesMidnight: boolean;
};

export function shiftBounds(workDate: string, startTime: string, endTime: string, timeZone: string): ShiftBounds {
  const crossesMidnight = endTime <= startTime;
  const endDate = crossesMidnight ? addDays(workDate, 1) : workDate;
  return {
    startUtc: zonedLocalToUtc(workDate, startTime, timeZone),
    endUtc: zonedLocalToUtc(endDate, endTime, timeZone),
    crossesMidnight,
  };
}

export function netMinutesBetween(checkInIso: string, checkOutIso: string): number {
  const elapsed = new Date(checkOutIso).getTime() - new Date(checkInIso).getTime();
  if (elapsed <= 0) return 0;
  return Math.floor(elapsed / 60000);
}

export function formatDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${remainder}m`;
}

export function formatTimeInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("hour")}:${read("minute")} ${read("dayPeriod").toUpperCase()}`;
}

export function greetingFor(timeZone: string, now = new Date()): string {
  const hour = partsInZone(now, timeZone).hour;
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function arrivalStatus(
  checkInIso: string,
  workDate: string,
  startTime: string,
  graceMinutes: number,
  timeZone: string,
): "ON_TIME" | "LATE" {
  const start = zonedLocalToUtc(workDate, startTime, timeZone).getTime();
  const limit = start + graceMinutes * 60000;
  return new Date(checkInIso).getTime() <= limit ? "ON_TIME" : "LATE";
}

export function departureStatus(
  checkOutIso: string,
  workDate: string,
  startTime: string,
  endTime: string,
  timeZone: string,
): "ON_TIME" | "EARLY" {
  const end = shiftBounds(workDate, startTime, endTime, timeZone).endUtc.getTime();
  return new Date(checkOutIso).getTime() < end ? "EARLY" : "ON_TIME";
}
