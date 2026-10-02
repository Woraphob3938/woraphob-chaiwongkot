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

/** Minutes the member has to pay once the trainer accepts. */
export const PAYMENT_WINDOW_MINUTES = 10;

/**
 * Mirrors WorkflowRules::acceptancePaymentDeadline: accepting starts the ten
 * minute payment window now, so a session that starts sooner cannot be accepted.
 */
export function acceptanceTooLate(sessionStartsAt: string, now: Date = new Date()): boolean {
  return now.getTime() + PAYMENT_WINDOW_MINUTES * 60 * 1000 > new Date(sessionStartsAt).getTime();
}
