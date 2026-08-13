"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, MessageSquareText, RefreshCw, Trash2 } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { getTrainerNextAction } from "@/lib/dashboard-actions";
import { formatDateTime } from "@/lib/format";
import type { Booking, SlotState, TrainerAvailabilitySlot, TrainerWorkspace } from "@/lib/types";

function leaveExpiredSession(error: unknown, navigate: (href: string) => void) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  localStorage.removeItem("fitconnect_token");
  navigate("/login");
  return true;
}

const slotStateCopy: Record<SlotState, string> = {
  available: "พร้อมจอง",
  held: "ล็อกชั่วคราว",
  booked: "ยืนยันแล้ว",
  blocked: "ปิดช่วงเวลา",
};

const dayNameFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "short" });
const dayDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" });
const weekDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", hour12: false });

function startOfWeek(value: Date) {
  const date = new Date(value);
  const day = date.getDay();
  date.setDate(date.getDate() - (day === 0 ? 6 : day - 1));
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function localDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatTimeRange(startsAt: string, endsAt: string) {
  return `${timeFormatter.format(new Date(startsAt))}–${timeFormatter.format(new Date(endsAt))} น.`;
}

const calendarMonthFormatter = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric" });
const calendarDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" });
const calendarWeekdays = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
const slotHours = Array.from({ length: 16 }, (_, index) => index + 6);

function monthKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function monthDays(key: string) {
  const [year, month] = key.split("-").map(Number);
  const sundayIndex = new Date(year, month - 1, 1).getDay();
  const mondayOffset = sundayIndex === 0 ? 6 : sundayIndex - 1;
  const count = new Date(year, month, 0).getDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - mondayOffset + 1;
    return day >= 1 && day <= count ? new Date(year, month - 1, day) : null;
  });
}

function hourLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function overlapsHour(slot: TrainerAvailabilitySlot, start: Date) {
  const slotStart = new Date(slot.startsAt);
  const slotEnd = new Date(slot.endsAt);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return slotStart < end && slotEnd > start;
}

type WeeklyScheduleItem = {
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

export function TrainerWorkbench({ onIncompleteProfile }: { onIncompleteProfile?: () => void } = {}) {
  const router = useRouter();
  const navigate = router.push;
  const [workspace, setWorkspace] = useState<TrainerWorkspace | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [completionError, setCompletionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [slotDate, setSlotDate] = useState("");
  const [slotTimes, setSlotTimes] = useState<string[]>([]);
  const [copyNextDay, setCopyNextDay] = useState(false);
  const [slotDialogOpen, setSlotDialogOpen] = useState(false);
  const [visibleSlotMonth, setVisibleSlotMonth] = useState(() => monthKey(new Date()));
  const [busy, setBusy] = useState<string | null>(null);
  const [slotToDelete, setSlotToDelete] = useState<TrainerAvailabilitySlot | null>(null);
  const [bookingToComplete, setBookingToComplete] = useState<Booking | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [bookingsReady, setBookingsReady] = useState(false);
  const actionNoticeRef = useRef<HTMLParagraphElement>(null);
  const completionErrorRef = useRef<HTMLDivElement>(null);
  const onIncompleteProfileRef = useRef(onIncompleteProfile);

  useEffect(() => {
    onIncompleteProfileRef.current = onIncompleteProfile;
  }, [onIncompleteProfile]);

  const loadWorkspace = useCallback(async () => {
    try {
      const data = await authenticatedRequest<TrainerWorkspace>("/v1/trainer/me");
      setWorkspace(data);
      setWorkspaceError("");
      setWorkspaceReady(true);
      if (data.profile === null) onIncompleteProfileRef.current?.();
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setWorkspaceReady(false);
      setWorkspaceError(error instanceof Error ? error.message : "โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ");
    }
  }, [navigate]);

  const refreshBookings = useCallback(async () => {
    try {
      const data = await authenticatedRequest<Booking[]>("/v1/bookings");
      setBookings(data);
      setBookingsReady(true);
    } catch (error) {
      setBookingsReady(false);
      throw error;
    }
  }, []);

  const loadBookings = useCallback(async () => {
    try {
      await refreshBookings();
      setBookingError("");
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setBookingError(error instanceof Error ? error.message : "โหลดคำขอจองไม่สำเร็จ");
    }
  }, [navigate, refreshBookings]);

  useEffect(() => {
    const initialLoad = Promise.allSettled([
      authenticatedRequest<TrainerWorkspace>("/v1/trainer/me"),
      authenticatedRequest<Booking[]>("/v1/bookings"),
    ]);
    void initialLoad.then(([workspaceResult, bookingResult]) => {
      if (workspaceResult.status === "fulfilled") {
        setWorkspace(workspaceResult.value);
        setWorkspaceError("");
        setWorkspaceReady(true);
        if (workspaceResult.value.profile === null) onIncompleteProfileRef.current?.();
      } else if (!leaveExpiredSession(workspaceResult.reason, navigate)) {
        setWorkspaceReady(false);
        setWorkspaceError(workspaceResult.reason instanceof Error ? workspaceResult.reason.message : "โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ");
      }

      if (bookingResult.status === "fulfilled") {
        setBookings(bookingResult.value);
        setBookingError("");
        setBookingsReady(true);
      } else if (!leaveExpiredSession(bookingResult.reason, navigate)) {
        setBookingsReady(false);
        setBookingError(bookingResult.reason instanceof Error ? bookingResult.reason.message : "โหลดคำขอจองไม่สำเร็จ");
      }
      setLoading(false);
    });
  }, [navigate]);

  useEffect(() => {
    if (actionNotice) actionNoticeRef.current?.focus();
  }, [actionNotice]);

  useEffect(() => {
    if (completionError) completionErrorRef.current?.focus();
  }, [completionError]);

  const now = useMemo(() => {
    const value = new Date();
    value.setSeconds(0, 0);
    value.setMinutes(value.getMinutes() + 1);
    return value;
  }, []);
  const maxDate = useMemo(() => {
    const value = new Date(now);
    value.setMonth(value.getMonth() + 2);
    return value;
  }, [now]);
  const slotMonths = useMemo(() => {
    const months: string[] = [];
    const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    while (cursor <= last) {
      months.push(monthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [maxDate, now]);
  const selectedStarts = slotDate
    ? slotTimes
      .map((time) => new Date(`${slotDate}T${time}`))
      .filter((start) => start > now && start <= maxDate)
    : [];
  const selectedSlotIsValid = selectedStarts.length > 0;
  const approved = workspace?.profile?.approvalStatus === "approved";
  const confirmedBookings = bookingsReady ? bookings.filter((booking) => booking.status === "confirmed") : [];
  const nextAction = workspaceReady && bookingsReady ? getTrainerNextAction(workspace, bookings) : null;
  const slots = workspace?.slots ?? [];
  const slotsOnSelectedDay = slotDate
    ? slots.filter((slot) => localDateKey(new Date(slot.startsAt)) === slotDate)
    : [];
  const weekStart = addDays(startOfWeek(now), weekOffset * 7);
  const weekDays = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const weekEnd = addDays(weekStart, 7);
  const confirmedSessions = confirmedBookings.flatMap((booking) => (
    booking.sessions?.length
      ? booking.sessions.map((session, index) => ({ booking, session, index }))
      : [{ booking, session: { id: 0, startsAt: booking.startsAt, endsAt: booking.endsAt }, index: 0 }]
  ));
  const confirmedPeriods = new Set(confirmedSessions.map(({ session }) => `${session.startsAt}|${session.endsAt}`));
  const weeklySchedule: WeeklyScheduleItem[] = [
    ...slots
      .filter((slot) => {
        const startsAt = new Date(slot.startsAt);
        const duplicatesConfirmedBooking = slot.state === "booked" && confirmedPeriods.has(`${slot.startsAt}|${slot.endsAt}`);
        return !duplicatesConfirmedBooking && startsAt >= weekStart && startsAt < weekEnd;
      })
      .map((slot) => ({
        key: `slot-${slot.id}`,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        kind: "slot" as const,
        state: slot.state,
        title: slotStateCopy[slot.state],
        detail: slot.state === "held" ? "สมาชิกกำลังส่งสลิป ล็อก 10 นาที" : "ช่วงเวลาว่าง",
        slot,
      })),
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

  async function createSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAvailabilityError("");
    setActionNotice("");
    setFieldErrors({});
    setBusy("slot-create");
    try {
      if (!slotDate || selectedStarts.length === 0) {
        setFieldErrors({ startsAt: "เลือกวันและเวลาในอนาคตภายในสองเดือน" });
        return;
      }
      const starts = [...selectedStarts];
      if (copyNextDay) {
        for (const start of selectedStarts) {
          const copied = addDays(start, 1);
          if (copied > now && copied <= maxDate) starts.push(copied);
        }
      }
      for (const start of starts) {
        await authenticatedRequest<TrainerAvailabilitySlot>("/v1/availability-slots", {
          method: "POST",
          body: JSON.stringify({ startsAt: start.toISOString() }),
        });
      }
      await loadWorkspace();
      setSlotDate("");
      setSlotTimes([]);
      setCopyNextDay(false);
      setSlotDialogOpen(false);
      setActionNotice(starts.length === 1 ? "เพิ่มช่วงเวลาว่างแล้ว" : `เพิ่ม ${starts.length} ช่วงเวลาว่างแล้ว`);
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      if (error instanceof ApiError) setFieldErrors(error.fields ?? {});
      setAvailabilityError(error instanceof Error ? error.message : "เพิ่มช่วงเวลาไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function deleteSlot(slotId: number) {
    setAvailabilityError("");
    setActionNotice("");
    setBusy(`slot-${slotId}`);
    try {
      await authenticatedRequest(`/v1/availability-slots/${slotId}`, { method: "DELETE" });
      await loadWorkspace();
      setSlotToDelete(null);
      setActionNotice("ลบช่วงเวลาว่างแล้ว");
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setAvailabilityError(error instanceof Error ? error.message : "ลบช่วงเวลาไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function completeBooking(bookingId: string) {
    setBusy(`booking-${bookingId}`);
    setBookingError("");
    setCompletionError("");
    setActionNotice("");
    try {
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      });
      setBookings((current) => current.map((booking) => booking.id === bookingId
        ? { ...booking, status: "completed", actions: { ...booking.actions, canComplete: false } }
        : booking));
      setBookingToComplete(null);
      try {
        await refreshBookings();
        setBookingError("");
      } catch (error) {
        if (leaveExpiredSession(error, navigate)) return;
        setCompletionError("บันทึกว่าฝึกเสร็จแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setActionNotice(`บันทึกว่าคำขอ ${bookingId} ฝึกเสร็จแล้ว`);
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setCompletionError(error instanceof Error ? error.message : "บันทึกการฝึกเสร็จแล้วไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function retryBookingRefresh() {
    setBusy("bookings-refresh");
    setActionNotice("");
    completionErrorRef.current?.focus();
    try {
      await refreshBookings();
      setBookingError("");
      setCompletionError("");
      setActionNotice("โหลดรายการนัดหมายล่าสุดแล้ว");
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setCompletionError("ยังโหลดรายการนัดหมายล่าสุดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(null);
    }
  }

  function renderConfirmedBooking(booking: Booking) {
    const isBusy = busy === `booking-${booking.id}`;
    return (
      <article className="trainer-booking-card" id={`booking-${booking.id}`} key={booking.id} aria-busy={isBusy}>
        <div className="trainer-booking-card__identity"><span>{booking.id}</span><h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3></div>
        <dl>
          <div><dt>เริ่มฝึก</dt><dd>{formatDateTime(booking.startsAt)}</dd></div>
          <div><dt>สิ้นสุด</dt><dd>{formatDateTime(booking.endsAt)}</dd></div>
        </dl>
        {booking.bookingType === "monthly" && (
          <div className="monthly-booking-sessions">
            <strong>แพ็กเกจ 30 วัน · {booking.sessionCount ?? booking.sessions?.length ?? 0} ครั้ง</strong>
            <ol>{(booking.sessions ?? []).map((session) => <li key={`${session.id}-${session.startsAt}`}>{formatDateTime(session.startsAt)}</li>)}</ol>
          </div>
        )}
        <div className="queue-actions">
          {!booking.actions.canComplete && <span>ฝึกเสร็จได้หลัง {formatDateTime(booking.endsAt)}</span>}
          {booking.actions.canReadChat && (
            <Link href={`/chat?booking=${encodeURIComponent(booking.id)}`}>
              <MessageSquareText aria-hidden="true" size={17} /> เปิดการสนทนา
            </Link>
          )}
          <button type="button" disabled={!booking.actions.canComplete || isBusy} aria-label={`${booking.actions.canComplete ? "ฝึกเสร็จแล้ว" : "รอสิ้นสุดการฝึก"} ${booking.id}`} onClick={() => setBookingToComplete(booking)}>
            {isBusy ? "กำลังบันทึก…" : booking.actions.canComplete ? "ฝึกเสร็จแล้ว" : "รอสิ้นสุดการฝึก"}
          </button>
        </div>
      </article>
    );
  }

  if (loading && !workspace) {
    return <section className="queue-loading" aria-live="polite">กำลังเตรียมโต๊ะทำงานเทรนเนอร์…</section>;
  }

  if (!workspaceReady) {
    return (
      <div className="trainer-workbench">
        <section className="queue-retry" role="alert">
          <h2>ยังแสดงโต๊ะทำงานเทรนเนอร์ไม่ได้</h2>
          <p>{workspaceError || "โหลดสถานะเทรนเนอร์ไม่สำเร็จ"}</p>
          <button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button>
        </section>
      </div>
    );
  }

  if (workspace?.profile === null) {
    return (
      <div className="trainer-workbench">
        <section className="approval-panel approval-panel--empty">
          <div><h2>ข้อมูลวิชาชีพยังไม่ครบ</h2><p>บัญชีเทรนเนอร์สร้างแล้ว กรอกข้อมูลการให้บริการและใบรับรองเพื่อส่งให้ผู้ดูแลระบบตรวจ</p></div>
          <div className="approval-panel__actions">
            <Link className="button button--accent" href="/trainer/apply">กรอกข้อมูลวิชาชีพ</Link>
          </div>
          {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
        </section>
        {bookingError && <div className="workbench-error" role="alert"><span>{bookingError}</span><button type="button" onClick={() => void loadBookings()}><RefreshCw aria-hidden="true" size={15} /> ลองใหม่</button></div>}
        {nextAction && <NextActionCard action={nextAction} />}
      </div>
    );
  }

  return (
    <div className="trainer-workbench">
      <section className="approval-panel" id="approval-status">
        <div>
          <h2>{approved ? "โปรไฟล์พร้อมเปิดตาราง" : "โปรไฟล์ยังเปิดตารางไม่ได้"}</h2>
          <p>{workspace?.profile?.approvalNote ?? (approved ? "สร้างช่วงเวลาว่างล่วงหน้าได้ไม่เกิน 2 เดือน" : "รอผู้ดูแลระบบตรวจใบรับรองก่อนสร้างช่วงเวลาว่าง")}</p>
        </div>
        {workspace?.profile && (
          <div className="approval-panel__actions">
            <Link className="button button--accent" href={`/trainers/${encodeURIComponent(workspace.profile.slug)}`}>
              หน้าโปรไฟล์เทรนเนอร์
            </Link>
            <StatusBadge status={workspace.profile.approvalStatus} />
          </div>
        )}
        {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
      </section>

      {nextAction && <NextActionCard action={nextAction} />}
      {actionNotice && <p ref={actionNoticeRef} className="queue-notice workbench-success" role="status" tabIndex={-1}>{actionNotice}</p>}

      <section className="trainer-week" id="schedule" aria-labelledby="trainer-week-title">
        <header className="trainer-week__heading">
          <div>
            <h2 id="trainer-week-title">ตารางรายสัปดาห์</h2>
            <p>ช่วงเวลาว่างและนัดยืนยันในมุมมองเดียว</p>
          </div>
          <div className="trainer-week__controls" aria-label="เปลี่ยนสัปดาห์">
            <button type="button" aria-label="สัปดาห์ก่อนหน้า" onClick={() => setWeekOffset((current) => current - 1)}>
              <ChevronLeft aria-hidden="true" size={18} />
            </button>
            <button type="button" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>สัปดาห์นี้</button>
            <button type="button" aria-label="สัปดาห์ถัดไป" onClick={() => setWeekOffset((current) => current + 1)}>
              <ChevronRight aria-hidden="true" size={18} />
            </button>
          </div>
          <p className="trainer-week__range" aria-live="polite">
            {weekDateFormatter.format(weekStart)} – {weekDateFormatter.format(addDays(weekEnd, -1))}
          </p>
        </header>
        <div className="trainer-week__grid">
          {weekDays.map((day) => {
            const dayItems = weeklySchedule.filter((item) => localDateKey(new Date(item.startsAt)) === localDateKey(day));
            const dayLabel = `${dayNameFormatter.format(day)} ${dayDateFormatter.format(day)}`;
            return (
              <section className="trainer-week__day" role="group" aria-label={dayLabel} key={localDateKey(day)}>
                <header>
                  <span>{dayNameFormatter.format(day)}</span>
                  <strong>{dayDateFormatter.format(day)}</strong>
                </header>
                <div className="trainer-week__events">
                  {dayItems.map((item) => {
                    const timeRange = formatTimeRange(item.startsAt, item.endsAt);
                    const canDeleteSlot = item.slot?.state === "available" && new Date(item.startsAt).getTime() > now.getTime();
                    const booking = item.booking;
                    const canCompleteBooking = Boolean(booking?.actions.canComplete);
                    const canOpenChat = Boolean(booking?.actions.canReadChat);
                    const eventClass = `trainer-week-event trainer-week-event--${item.kind} trainer-week-event--${item.state}`;
                    if (canDeleteSlot && item.slot) {
                      const slot = item.slot;
                      return (
                        <button type="button" className={eventClass} key={item.key} aria-label={`ลบช่วงว่าง ${timeRange}`} onClick={() => setSlotToDelete(slot)}>
                          <time dateTime={item.startsAt}>{timeRange}</time>
                          <strong>{item.title}</strong>
                          <span>ลบ</span>
                        </button>
                      );
                    }
                    if (booking && (canCompleteBooking || canOpenChat)) {
                      return (
                        <article className={eventClass} key={item.key}>
                          <time dateTime={item.startsAt}>{timeRange}</time>
                          <strong>{item.title}</strong>
                          <span className="trainer-week-event__actions">
                            {canCompleteBooking && (
                              <button type="button" onClick={() => setBookingToComplete(booking)}>ฝึกเสร็จ</button>
                            )}
                            {canOpenChat && (
                              <Link href={`/chat?booking=${encodeURIComponent(booking.id)}`}>แชต</Link>
                            )}
                          </span>
                        </article>
                      );
                    }
                    return (
                      <article className={eventClass} key={item.key}>
                        <time dateTime={item.startsAt}>{timeRange}</time>
                        <strong>{item.title}</strong>
                        <span>{item.detail}</span>
                      </article>
                    );
                  })}
                  {dayItems.length === 0 && <p className="trainer-week__empty">ไม่มีรายการ</p>}
                </div>
              </section>
            );
          })}
        </div>
        <footer className="trainer-week__legend" aria-label="คำอธิบายสถานะตาราง">
          <span><i className="is-available" aria-hidden="true" /> พร้อมจอง · กดเพื่อลบ</span>
          <span><i className="is-held" aria-hidden="true" /> ล็อกชั่วคราว · สมาชิกกำลังส่งสลิป 10 นาที</span>
          <span><i className="is-confirmed" aria-hidden="true" /> นัดยืนยันแล้ว · ฝึกเสร็จหรือแชต</span>
          <span><i className="is-blocked" aria-hidden="true" /> ปิดช่วงเวลา</span>
        </footer>
      </section>

      {bookingError && <div className="workbench-error" role="alert"><span>{bookingError}</span><button type="button" onClick={() => void loadBookings()}><RefreshCw aria-hidden="true" size={15} /> ลองใหม่</button></div>}

      <details
        className="trainer-disclosure trainer-availability"
        id="availability"
        key={nextAction?.href === "/trainer#availability" ? "availability-action" : "availability-idle"}
        open={nextAction?.href === "/trainer#availability" || undefined}
      >
        <summary><span><CalendarPlus aria-hidden="true" size={20} /><strong>จัดการช่วงเวลาว่าง</strong></span><small>{slots.length} ช่วงเวลา</small></summary>
        <div className="availability-launch">
          <p id="availability-add-hint">{approved ? "เลือกวันแล้วเลือกชั่วโมงเริ่มต้น ระบบกำหนดเวลาฝึกครั้งละ 1 ชั่วโมง" : "รอผู้ดูแลระบบอนุมัติโปรไฟล์ก่อนจึงจะเพิ่มช่วงเวลาได้"}</p>
          <Button className="button button--accent" type="button" disabled={!approved} aria-describedby="availability-add-hint" onClick={() => {
            setAvailabilityError("");
            setFieldErrors({});
            setVisibleSlotMonth(monthKey(now));
            setSlotTimes([]);
            setCopyNextDay(false);
            setSlotDialogOpen(true);
          }}>
            <CalendarPlus aria-hidden="true" /> เพิ่มช่วงเวลาว่าง
          </Button>
        </div>
        {availabilityError && !slotDialogOpen && <p className="row-error" role="alert">{availabilityError}</p>}
        <div className="trainer-slot-list">
          {slots.map((slot) => {
            const canDelete = slot.state === "available" && new Date(slot.startsAt).getTime() > now.getTime();
            return (
              <div className="trainer-slot-row" key={slot.id} aria-busy={busy === `slot-${slot.id}`}>
                <span><strong>{formatDateTime(slot.startsAt)}</strong><small>{slotStateCopy[slot.state]}</small></span>
                {canDelete && <button type="button" disabled={busy === `slot-${slot.id}`} onClick={() => setSlotToDelete(slot)} aria-label={`ลบช่วงเวลา ${formatDateTime(slot.startsAt)}`}><Trash2 aria-hidden="true" size={16} /> ลบ</button>}
              </div>
            );
          })}
          {slots.length === 0 && <div className="empty-state"><strong>ยังไม่มีช่วงเวลาว่าง</strong><p>เพิ่มช่วงเวลาแรกเมื่อโปรไฟล์ได้รับการอนุมัติ</p></div>}
        </div>
      </details>

      <Dialog open={slotDialogOpen} onOpenChange={(open) => {
        if (busy === "slot-create") return;
        setSlotDialogOpen(open);
        if (!open) {
          setAvailabilityError("");
          setFieldErrors({});
        }
      }}>
        <DialogContent className="slot-calendar-dialog availability-calendar-dialog">
          <DialogHeader className="slot-calendar-dialog__header">
            <DialogTitle>เพิ่มช่วงเวลาว่าง</DialogTitle>
            <DialogDescription>เลือกวันและเวลาเริ่มต้น ระบบจะกำหนดเวลาสิ้นสุดให้อัตโนมัติอีก 1 ชั่วโมง</DialogDescription>
          </DialogHeader>
          <form className="availability-calendar-form" onSubmit={createSlot}>
            <div className="slot-calendar-dialog__body">
              <section className="slot-calendar" aria-label="ปฏิทินวันเริ่มต้น">
                <div className="slot-calendar__toolbar">
                  <Button type="button" size="icon" variant="outline" aria-label="เดือนก่อนหน้า" disabled={slotMonths.indexOf(visibleSlotMonth) <= 0} onClick={() => setVisibleSlotMonth(slotMonths[slotMonths.indexOf(visibleSlotMonth) - 1])}>
                    <ChevronLeft aria-hidden="true" />
                  </Button>
                  <h3>{calendarMonthFormatter.format(new Date(`${visibleSlotMonth}-15T12:00:00`))}</h3>
                  <Button type="button" size="icon" variant="outline" aria-label="เดือนถัดไป" disabled={slotMonths.indexOf(visibleSlotMonth) >= slotMonths.length - 1} onClick={() => setVisibleSlotMonth(slotMonths[slotMonths.indexOf(visibleSlotMonth) + 1])}>
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </div>
                <div className="slot-calendar__weekdays" aria-hidden="true">{calendarWeekdays.map((day) => <span key={day}>{day}</span>)}</div>
                <div className="slot-calendar__days">
                  {monthDays(visibleSlotMonth).map((date, index) => {
                    if (!date) return <span key={`blank-${index}`} aria-hidden="true" />;
                    const key = localDateKey(date);
                    const enabled = date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
                      && date <= new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
                    const selected = key === slotDate;
                    return (
                      <button key={key} type="button" className={`slot-calendar__day${selected ? " is-selected" : ""}`} disabled={!enabled} aria-pressed={selected} aria-label={`เลือกวันที่ ${calendarDateFormatter.format(date)}`} onClick={() => {
                        setSlotDate(key);
                        setFieldErrors((current) => {
                          const rest = { ...current };
                          delete rest.startsAt;
                          return rest;
                        });
                      }}>
                        <span>{date.getDate()}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
              <section className="slot-calendar-times availability-calendar-time" aria-label="เวลาเริ่มต้นที่เลือก">
                <div><CalendarDays aria-hidden="true" /><h3>เวลาเริ่มต้น</h3></div>
                {slotDate ? (
                  <ul className="slot-calendar-times__list">
                    {slotHours.map((hour) => {
                      const value = hourLabel(hour);
                      const start = new Date(`${slotDate}T${value}`);
                      const taken = slotsOnSelectedDay.some((slot) => overlapsHour(slot, start));
                      const enabled = start > now && start <= maxDate && !taken;
                      const selected = slotTimes.includes(value);
                      return (
                        <li key={value}>
                          <button
                            type="button"
                            className={`slot-calendar-time${selected ? " is-selected" : ""}`}
                            disabled={!enabled || busy === "slot-create"}
                            aria-pressed={selected}
                            aria-label={taken ? `${value} มีช่วงนี้อยู่แล้ว` : `เริ่ม ${value} น.`}
                            onClick={() => {
                              setSlotTimes((current) => (
                                current.includes(value)
                                  ? current.filter((time) => time !== value)
                                  : [...current, value].sort()
                              ));
                              setFieldErrors((current) => {
                                const rest = { ...current };
                                delete rest.startsAt;
                                return rest;
                              });
                            }}
                          >
                            {value}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p>เลือกวันเพื่อดูชั่วโมงที่เปิดได้</p>}
                {slotsOnSelectedDay.length > 0 && (
                  <p className="availability-day-slots">วันนี้มีอยู่แล้ว {slotsOnSelectedDay.map((slot) => `${timeFormatter.format(new Date(slot.startsAt))} น. · ${slotStateCopy[slot.state]}`).join(" · ")}</p>
                )}
                {selectedStarts.length > 0
                  ? <p className="availability-calendar-time__end">จะเพิ่ม {selectedStarts.length} ช่วง · แต่ละช่วงสิ้นสุดใน 1 ชั่วโมง</p>
                  : <p>เลือกวันและชั่วโมงได้มากกว่าหนึ่งช่อง</p>}
                <label className="availability-copy-next">
                  <input type="checkbox" checked={copyNextDay} disabled={selectedStarts.length === 0 || busy === "slot-create"} onChange={(event) => setCopyNextDay(event.target.checked)} />
                  คัดลอกชั่วโมงเหล่านี้ไปวันถัดไป
                </label>
                {fieldErrors.startsAt && <small id="availability-start-error" className="field-error">{fieldErrors.startsAt}</small>}
                {availabilityError && <p className="row-error" role="alert">{availabilityError}</p>}
              </section>
            </div>
            <DialogFooter className="slot-calendar-dialog__footer">
              <DialogClose asChild><Button type="button" variant="outline" disabled={busy === "slot-create"}>ยกเลิก</Button></DialogClose>
              <Button className="button button--accent" type="submit" disabled={!approved || !selectedSlotIsValid || busy === "slot-create"}>
                {busy === "slot-create" ? "กำลังเพิ่ม…" : selectedStarts.length > 1 ? `ยืนยันเพิ่ม ${selectedStarts.length} ช่วงเวลา` : "ยืนยันเพิ่มช่วงเวลา"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <section className="trainer-booking-list" aria-labelledby="trainer-confirmed-title">
        <details className="trainer-disclosure" open={nextAction?.href.startsWith("/trainer#booking-") || undefined}>
          <summary><span><strong id="trainer-confirmed-title">นัดหมายที่ยืนยันแล้ว</strong><small>เปิดเพื่อจัดการและบันทึกผลหลังเวลานัด</small></span><span className="queue-count">{bookingsReady ? String(confirmedBookings.length) : "—"}</span></summary>
          {completionError && (
            <div ref={completionErrorRef} className="workbench-error" role="alert" tabIndex={-1}>
              <span>{completionError}</span>
              <button type="button" disabled={busy === "bookings-refresh"} onClick={() => void retryBookingRefresh()}>
                <RefreshCw aria-hidden="true" size={15} /> {busy === "bookings-refresh" ? "กำลังโหลด…" : "ลองโหลดใหม่"}
              </button>
            </div>
          )}
          {confirmedBookings.map(renderConfirmedBooking)}
          {bookingsReady && confirmedBookings.length === 0 && <div className="empty-state"><strong>ยังไม่มีนัดที่ยืนยันแล้ว</strong><p>นัดหมายจะย้ายมาที่นี่หลังผู้ดูแลระบบอนุมัติการชำระเงิน</p></div>}
        </details>
      </section>

      <Dialog open={slotToDelete !== null} onOpenChange={(open) => {
        if (busy?.startsWith("slot-")) return;
        if (!open) setSlotToDelete(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบช่วงเวลานี้?</DialogTitle>
            <DialogDescription className="grid gap-1">
              <span>{slotToDelete ? formatDateTime(slotToDelete.startsAt) : ""}</span>
              <span>สมาชิกจะไม่เห็นช่วงเวลานี้อีก</span>
            </DialogDescription>
          </DialogHeader>
          {availabilityError && <p className="row-error" role="alert">{availabilityError}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy?.startsWith("slot-"))}>กลับไป</Button></DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={!slotToDelete || busy === `slot-${slotToDelete.id}`}
              onClick={() => {
                if (!slotToDelete) return;
                void deleteSlot(slotToDelete.id);
              }}
            >
              {busy === `slot-${slotToDelete?.id}` ? "กำลังลบ…" : "ยืนยันลบช่วงเวลา"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bookingToComplete !== null} onOpenChange={(open) => {
        if (busy?.startsWith("booking-")) return;
        if (!open) setBookingToComplete(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>บันทึกว่าฝึกเสร็จแล้ว?</DialogTitle>
            <DialogDescription className="grid gap-1">
              <span>{bookingToComplete?.member?.displayName ?? "สมาชิก FitConnect"}</span>
              <span>{bookingToComplete ? `${formatDateTime(bookingToComplete.startsAt)} – ${formatDateTime(bookingToComplete.endsAt)}` : ""}</span>
              <span>คำสั่งนี้ปิดการจอง {bookingToComplete?.id} และให้สมาชิกเขียนรีวิวได้</span>
            </DialogDescription>
          </DialogHeader>
          {completionError && <p className="row-error" role="alert">{completionError}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy?.startsWith("booking-"))}>กลับไป</Button></DialogClose>
            <Button
              className="button button--accent"
              type="button"
              disabled={!bookingToComplete || busy === `booking-${bookingToComplete.id}`}
              onClick={() => {
                if (!bookingToComplete) return;
                void completeBooking(bookingToComplete.id);
              }}
            >
              {busy === `booking-${bookingToComplete?.id}` ? "กำลังบันทึก…" : "ยืนยันว่าฝึกเสร็จแล้ว"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
