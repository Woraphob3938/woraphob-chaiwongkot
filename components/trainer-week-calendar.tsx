"use client";

import { CSSProperties, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import type { Trigger } from "@/components/trainer-booking-cards";
import {
  DEFAULT_END_HOUR, DEFAULT_START_HOUR, addDays, dayDateFormatter, dayNameFormatter, hourLabel, layoutDay,
  localDateKey, slotHours, slotStateCopy, startOfDay, weekDateFormatter, type WeeklyScheduleItem,
} from "@/components/trainer-schedule";
import { Button } from "@/components/ui/button";
import { hasValidBookingPeriod } from "@/lib/dashboard-actions";
import { formatDateTime, formatTime } from "@/lib/format";
import type { Booking, TrainerAvailabilitySlot } from "@/lib/types";

/**
 * The trainer's week as one hour grid: open slots and confirmed sessions side
 * by side. A click on a slot edits it, a click on an empty hour offers it as a
 * new slot, and a click on a session opens the booking.
 */
export function TrainerWeekCalendar({ active, slots, confirmedBookings, decisionBookings, busy, error, now, maxDate, onAddSlot, onEditSlot, onOpenBooking }: {
  /** Whether the tab holding the calendar is on screen. */
  active: boolean;
  slots: TrainerAvailabilitySlot[];
  confirmedBookings: Booking[];
  /** Open requests, used to name the member a held slot is kept for. */
  decisionBookings: Booking[];
  busy: string | null;
  error: string;
  now: Date;
  maxDate: Date;
  onAddSlot: (trigger: HTMLElement, day?: Date, hour?: number) => void;
  onEditSlot: (slot: TrainerAvailabilitySlot, event: Trigger) => void;
  onOpenBooking: (booking: Booking, event: Trigger) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  // A minute clock for the calendar only: the red "now" line and which hours
  // may still take a new slot move with real time while the page stays open.
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const weekStart = addDays(startOfDay(now), weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = addDays(weekStart, 7);
  const confirmedSessions = confirmedBookings.flatMap((booking) => (
    booking.sessions?.length
      ? booking.sessions.map((session, index) => ({ booking, session, index }))
      : [{ booking, session: { id: 0, startsAt: booking.startsAt, endsAt: booking.endsAt }, index: 0 }]
  ));
  const confirmedPeriods = new Set(confirmedSessions.map(({ session }) => `${session.startsAt}|${session.endsAt}`));
  /** The open request a held slot is kept for, matched on its period. */
  function heldBooking(slot: TrainerAvailabilitySlot) {
    const start = new Date(slot.startsAt).getTime();
    const end = new Date(slot.endsAt).getTime();
    return decisionBookings.find((booking) => (
      new Date(booking.startsAt).getTime() === start && new Date(booking.endsAt).getTime() === end
    ));
  }
  const weeklySchedule: WeeklyScheduleItem[] = [
    ...slots
      .filter((slot) => {
        const startsAt = new Date(slot.startsAt);
        const duplicatesConfirmedBooking = slot.state === "booked" && confirmedPeriods.has(`${slot.startsAt}|${slot.endsAt}`);
        return !duplicatesConfirmedBooking && startsAt >= weekStart && startsAt < weekEnd;
      })
      .map((slot) => {
        const heldFor = slot.state === "held" ? heldBooking(slot) : undefined;
        return {
          key: `slot-${slot.id}`,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          kind: "slot" as const,
          state: slot.state,
          title: heldFor ? heldFor.member?.displayName ?? "สมาชิก FitConnect" : slotStateCopy[slot.state],
          detail: slot.state === "held" ? "มีคำขอจองในช่วงนี้" : slot.state === "booked" ? "ถูกจองแล้ว" : slot.state === "blocked" ? "ปิดช่วงเวลา" : "ช่วงเวลาว่าง",
          slot,
          booking: heldFor,
        };
      }),
    ...confirmedSessions
      .filter(({ session }) => {
        const startsAt = new Date(session.startsAt);
        return startsAt >= weekStart && startsAt < weekEnd;
      })
      .map(({ booking, session, index }) => ({
        key: `booking-${booking.id}-${session.id || index}`,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        kind: "booking" as const,
        state: "confirmed" as const,
        title: booking.member?.displayName ?? "สมาชิก FitConnect",
        detail: "นัดยืนยันแล้ว",
        booking,
      })),
  ].sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  const weekBookingCount = weeklySchedule.filter((item) => item.kind === "booking").length;
  const weekSlotCount = weeklySchedule.length - weekBookingCount;
  // The hour rows stretch to cover whatever the week holds, but never shrink
  // below a working day so an empty week still reads as a calendar.
  const calendarStartHour = Math.min(DEFAULT_START_HOUR, ...weeklySchedule.map((item) => new Date(item.startsAt).getHours()));
  const calendarEndHour = Math.max(DEFAULT_END_HOUR, ...weeklySchedule.map((item) => {
    const end = new Date(item.endsAt);
    return Math.min(24, end.getHours() + (end.getMinutes() > 0 ? 1 : 0) || 24);
  }));
  const calendarHours = Array.from({ length: calendarEndHour - calendarStartHour }, (_, index) => calendarStartHour + index);
  const todayKey = localDateKey(now);

  // Each new week scrolls the hour grid to its first item (or to "now" on the
  // current week), so the calendar never opens on an empty early morning.
  useEffect(() => {
    const container = calendarScrollRef.current;
    const hourRow = container?.querySelector<HTMLElement>(".trainer-cal__hour");
    if (!container || !hourRow) return;
    const firstHour = weeklySchedule.length > 0
      ? Math.min(...weeklySchedule.map((item) => new Date(item.startsAt).getHours()))
      : weekOffset === 0 ? now.getHours() : DEFAULT_START_HOUR;
    container.scrollTop = Math.max(0, (firstHour - calendarStartHour - 0.5) * hourRow.getBoundingClientRect().height);
    // Only a week change re-aims the scroll; later data refreshes keep the
    // trainer's own scroll position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekOffset, active]);

  /** A click on an empty stretch of a day column offers that hour as a new slot. */
  function onCalendarColumnClick(event: ReactMouseEvent<HTMLDivElement>, day: Date) {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return;
    const hour = calendarStartHour + Math.floor(((event.clientY - rect.top) / rect.height) * calendarHours.length);
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    if (start <= clock || start > maxDate || !slotHours.includes(hour)) return;
    onAddSlot(event.currentTarget, day, hour);
  }

  function renderCalendarItem(item: WeeklyScheduleItem, place: { lane: number; lanes: number }) {
    const start = new Date(item.startsAt);
    const end = new Date(item.endsAt);
    const offset = start.getHours() + start.getMinutes() / 60 - calendarStartHour;
    const span = Math.max(0.5, (end.getTime() - start.getTime()) / 3_600_000);
    const booking = item.booking;
    const validBookingPeriod = !booking || hasValidBookingPeriod(booking);
    const style = {
      "--cal-start": offset,
      "--cal-span": span,
      "--cal-lane": place.lane,
      "--cal-lanes": place.lanes,
    } as CSSProperties;
    const className = `trainer-cal__event trainer-week-event trainer-week-event--${item.kind} trainer-week-event--${item.state}`;
    const body = (
      <>
        <time dateTime={item.startsAt}>{formatTime(item.startsAt)}–{formatTime(item.endsAt)}</time>
        <strong>{item.title}</strong>
        {validBookingPeriod
          ? <span className="sr-only">{item.detail}</span>
          : <span className="trainer-week-event__warning">ข้อมูลเวลาไม่ถูกต้อง</span>}
      </>
    );
    if (booking) {
      return (
        <button type="button" className={className} style={style} key={item.key} onClick={(event) => onOpenBooking(booking, event)}>
          {body}
        </button>
      );
    }
    // Only a slot that is still open and ahead of "now" may move: editing a
    // booked one would move a member's session.
    const slot = item.slot;
    if (slot && slot.state === "available" && start.getTime() > now.getTime()) {
      return (
        <button
          type="button"
          className={className}
          style={style}
          key={item.key}
          disabled={busy === `slot-${slot.id}`}
          aria-label={`แก้ไขช่วงเวลา ${formatDateTime(slot.startsAt)}`}
          onClick={(event) => onEditSlot(slot, event)}
        >
          {body}
        </button>
      );
    }
    return <article className={className} style={style} key={item.key}>{body}</article>;
  }

  return (
    <section className="trainer-cal" id="schedule" aria-labelledby="trainer-cal-title">
      <header className="trainer-cal__toolbar">
        <div className="trainer-cal__title">
          <h2 id="trainer-cal-title"><CalendarDays aria-hidden="true" size={20} /> ตารางงาน</h2>
          <p aria-live="polite">
            <span>{weekDateFormatter.format(weekStart)} – {weekDateFormatter.format(addDays(weekEnd, -1))}</span>
            <small>{weekBookingCount} นัด · {weekSlotCount} ช่วงเวลา</small>
          </p>
        </div>
        <div className="trainer-week-strip__controls" aria-label="เปลี่ยนช่วงวัน">
          <button type="button" aria-label="7 วันก่อนหน้า" onClick={() => setWeekOffset(weekOffset - 1)}><ChevronLeft aria-hidden="true" size={18} /></button>
          <button type="button" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>วันนี้</button>
          <button type="button" aria-label="7 วันถัดไป" onClick={() => setWeekOffset(weekOffset + 1)}><ChevronRight aria-hidden="true" size={18} /></button>
        </div>
        <span id="availability" className="trainer-cal__add">
          <Button type="button" onClick={(event) => onAddSlot(event.currentTarget)}>
            <CalendarPlus aria-hidden="true" size={18} /> เพิ่มช่วงเวลาว่าง
          </Button>
        </span>
      </header>
      {error && <p className="row-error trainer-cal__error" role="alert">{error}</p>}

      <div className="trainer-cal__scroll" ref={calendarScrollRef} role="region" aria-label="ตารางรายสัปดาห์" tabIndex={0}>
        <div className="trainer-cal__grid" style={{ "--cal-hours": calendarHours.length } as CSSProperties}>
          <span className="trainer-cal__corner" aria-hidden="true" />
          {weekDays.map((day) => (
            <div className={`trainer-cal__head${localDateKey(day) === todayKey ? " is-today" : ""}`} key={`head-${localDateKey(day)}`} aria-hidden="true">
              <span>{dayNameFormatter.format(day)}</span>
              <strong>{day.getDate()}</strong>
            </div>
          ))}
          <div className="trainer-cal__gutter" aria-hidden="true">
            {calendarHours.map((hour) => <span className="trainer-cal__hour" key={hour}>{hourLabel(hour)}</span>)}
          </div>
          {weekDays.map((day) => {
            const key = localDateKey(day);
            const dayItems = weeklySchedule.filter((item) => localDateKey(new Date(item.startsAt)) === key);
            const places = layoutDay(dayItems);
            const dayEnd = new Date(day);
            dayEnd.setHours(23, 59, 59, 999);
            const canAdd = dayEnd > clock && day <= maxDate;
            const nowOffset = clock.getHours() + clock.getMinutes() / 60 - calendarStartHour;
            return (
              <div
                className={`trainer-cal__col${key === todayKey ? " is-today" : ""}${canAdd ? " can-add" : ""}`}
                role="group"
                aria-label={`${dayNameFormatter.format(day)} ${dayDateFormatter.format(day)} · ${dayItems.length} รายการ`}
                key={key}
                title={canAdd ? "คลิกช่องว่างเพื่อเพิ่มช่วงเวลาว่าง" : undefined}
                onClick={canAdd ? (event) => onCalendarColumnClick(event, day) : undefined}
              >
                {key === localDateKey(clock) && nowOffset >= 0 && nowOffset <= calendarHours.length && (
                  <span className="trainer-cal__now" style={{ "--cal-start": nowOffset } as CSSProperties} aria-hidden="true" />
                )}
                {dayItems.map((item) => renderCalendarItem(item, places.get(item.key) ?? { lane: 0, lanes: 1 }))}
              </div>
            );
          })}
        </div>
      </div>
      <footer className="trainer-week__legend" aria-label="คำอธิบายสถานะตาราง">
        <span><i className="is-available" aria-hidden="true" /> พร้อมจอง</span>
        <span><i className="is-held" aria-hidden="true" /> มีคำขอจอง</span>
        <span><i className="is-confirmed" aria-hidden="true" /> นัดยืนยันแล้ว</span>
        <span><i className="is-blocked" aria-hidden="true" /> ปิดช่วงเวลา</span>
      </footer>
    </section>
  );
}
