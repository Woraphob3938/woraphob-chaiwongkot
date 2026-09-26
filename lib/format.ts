const weekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Thai Buddhist Era runs 543 years ahead of the Gregorian year. */
const BUDDHIST_ERA_OFFSET = 543;

function bangkokDate(value: string) {
  return new Date(new Date(value).getTime() + BANGKOK_OFFSET_MS);
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

/** Buddhist Era year, as Thai readers expect it: 2026 becomes 2569. */
export function buddhistYear(value: string | Date) {
  const date = typeof value === "string" ? bangkokDate(value) : value;
  return date.getUTCFullYear() + BUDDHIST_ERA_OFFSET;
}

export function formatDateTime(value: string) {
  return `${formatDay(value)} · ${formatTime(value)} น.`;
}

export function formatDay(value: string) {
  const date = bangkokDate(value);
  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]} ${buddhistYear(value)}`;
}

/** Day and month without the weekday or year, for tight rows and chips. */
export function formatShortDay(value: string) {
  const date = bangkokDate(value);
  return `${date.getUTCDate()} ${months[date.getUTCMonth()]} ${buddhistYear(value)}`;
}

export function formatTime(value: string) {
  const date = bangkokDate(value);
  return `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}`;
}

export function crossesBangkokDay(startsAt: string, endsAt: string) {
  const start = bangkokDate(startsAt);
  const end = bangkokDate(endsAt);
  return start.getUTCFullYear() !== end.getUTCFullYear()
    || start.getUTCMonth() !== end.getUTCMonth()
    || start.getUTCDate() !== end.getUTCDate();
}

export function formatTimeRange(startsAt: string, endsAt: string) {
  const range = `${formatTime(startsAt)}–${formatTime(endsAt)} น.`;
  return crossesBangkokDay(startsAt, endsAt)
    ? `${range} · สิ้นสุดวันถัดไป ${formatDay(endsAt)}`
    : range;
}

export function formatMoney(value?: number) {
  return value === undefined ? "รอยืนยันราคา" : `฿${Math.round(value).toLocaleString("en-US")}`;
}

const trainingTypeNames: Record<string, string> = {
  "เฉพาะเเต่ละกีฬา": "เฉพาะแต่ละกีฬา",
  "เวทเทรนนิง": "เวทเทรนนิ่ง",
};

export function formatTrainingTypeName(value: string) {
  return trainingTypeNames[value] ?? value;
}

export function initials(name: string) {
  // Array.from keeps a Thai combining mark attached to its base character.
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "FC";
  return parts.slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("th-TH");
}

/**
 * บทที่ 1: the two daily rounds (Bangkok time) at which an accepted request is
 * confirmed to the member. The training time itself never moves.
 */
export const CONFIRMATION_TIMES = ["12:00", "18:00"] as const;
export type ConfirmationTime = (typeof CONFIRMATION_TIMES)[number];
export const PAYMENT_WINDOW_MINUTES = 10;

/**
 * Mirrors WorkflowRules::confirmationRelease: the next occurrence of the round
 * after `now`. `tooLate` is true when the member could not pay before the
 * session starts, which the backend refuses.
 */
export function confirmationRelease(time: ConfirmationTime, sessionStartsAt: string, now: Date = new Date()) {
  const [hour, minute] = time.split(":").map(Number);
  const local = bangkokDate(now.toISOString());
  let releaseUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - BANGKOK_OFFSET_MS;
  if (releaseUtc <= now.getTime()) releaseUtc += 24 * 60 * 60 * 1000;
  const paymentClosesAt = releaseUtc + PAYMENT_WINDOW_MINUTES * 60 * 1000;
  return {
    releaseAt: new Date(releaseUtc).toISOString(),
    tooLate: paymentClosesAt > new Date(sessionStartsAt).getTime(),
  };
}
