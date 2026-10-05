import type { Booking, SlotState, TrainerAvailabilitySlot } from "@/lib/types";

export const slotStateCopy: Record<SlotState, string> = {
  available: "พร้อมจอง",
  held: "มีคำขอจอง",
  booked: "ยืนยันแล้ว",
  blocked: "ปิดช่วงเวลา",
};

// Every visible date and time is pinned to Bangkok so a trainer's schedule reads
// the same whatever timezone the machine that rendered it sits in.
export const BANGKOK = "Asia/Bangkok";
export const dayNameFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "short", timeZone: BANGKOK });
export const dayDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: BANGKOK });
export const weekDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: BANGKOK });

/** Midnight at the start of the given day. The calendar runs seven days from
 *  today rather than Monday to Sunday: on a Sunday a calendar week was six days
 *  of past and hid tomorrow's session. */
export function startOfDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

export function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export const calendarMonthFormatter = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: BANGKOK });
export const calendarDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: BANGKOK });
export const heroDateFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: BANGKOK });
export const calendarWeekdays = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
export const slotHours = Array.from({ length: 16 }, (_, index) => index + 6);

export function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

export function monthDays(key: string) {
  const [year, month] = key.split("-").map(Number);
  const sundayIndex = new Date(year, month - 1, 1).getDay();
  const mondayOffset = sundayIndex === 0 ? 6 : sundayIndex - 1;
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - mondayOffset + 1;
    return day >= 1 && day <= count ? new Date(year, month - 1, day) : null;
  });
}

export function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function overlapsHour(slot: TrainerAvailabilitySlot, start: Date) {
  const slotStart = new Date(slot.startsAt);
  const slotEnd = new Date(slot.endsAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return slotStart < end && slotEnd > start;
}

/** The hour grid always spans at least this working day. */
export const DEFAULT_START_HOUR = 7;
export const DEFAULT_END_HOUR = 21;

/**
 * Side-by-side lanes for a day's overlapping items: each item takes the first
 * lane free at its start, and every item in an overlapping cluster shares that
 * cluster's lane count so the columns line up.
 */
export function layoutDay(items: Array<{ key: string; startsAt: string; endsAt: string }>) {
  const places = new Map<string, { lane: number; lanes: number }>();
  const sorted = items.slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  let cluster: string[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;
  const closeCluster = () => {
    for (const key of cluster) places.set(key, { lane: places.get(key)?.lane ?? 0, lanes: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    const start = new Date(item.startsAt).getTime();
    const end = Math.max(start + 30 * 60 * 1000, new Date(item.endsAt).getTime());
    if (start >= clusterEnd) {
      closeCluster();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    places.set(item.key, { lane, lanes: 1 });
    cluster.push(item.key);
    clusterEnd = Math.max(clusterEnd, end);
  }
  closeCluster();
  return places;
}

export type WeeklyScheduleItem = {
  key: string;
  startsAt: string;
  endsAt: string;
  kind: "slot" | "booking";
  state: SlotState | "confirmed";
  title: string;
  detail: string;
  slot?: TrainerAvailabilitySlot;
  booking?: Booking;
};
