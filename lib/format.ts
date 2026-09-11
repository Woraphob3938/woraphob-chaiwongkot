const weekdays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function bangkokDate(value: string) {
  return new Date(new Date(value).getTime() + 7 * 60 * 60 * 1000);
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateTime(value: string) {
  return `${formatDay(value)} · ${formatTime(value)} น.`;
}

export function formatDay(value: string) {
  const date = bangkokDate(value);
  return `${weekdays[date.getUTCDay()]} ${date.getUTCDate()} ${months[date.getUTCMonth()]}`;
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
  const range = `${formatTime(startsAt)} ถึง ${formatTime(endsAt)} น.`;
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
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.at(0))
    .join("");
}
