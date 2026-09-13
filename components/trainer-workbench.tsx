"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, MessageSquareText, RefreshCw, Search, Trash2 } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import { TrainerPaymentReview } from "@/components/admin-review-queue";
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
import { getTrainerNextAction, hasValidBookingPeriod } from "@/lib/dashboard-actions";
import { formatDateTime, formatMoney, formatShortDay, formatTime, formatTimeRange } from "@/lib/format";
import { leaveExpiredSession } from "@/lib/session";
import type { AdminQueue, Booking, SlotState, TrainerAvailabilitySlot, TrainerWorkspace } from "@/lib/types";

const slotStateCopy: Record<SlotState, string> = {
  available: "พร้อมจอง",
  held: "ล็อกชั่วคราว",
  booked: "ยืนยันแล้ว",
  blocked: "ปิดช่วงเวลา",
};

// Every visible date and time is pinned to Bangkok so a trainer's schedule reads
// the same whatever timezone the machine that rendered it sits in.
const BANGKOK = "Asia/Bangkok";
/** How many appointments the trainer sees before asking for the next page. */
const APPOINTMENTS_PER_PAGE = 4;
const dayNameFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "short", timeZone: BANGKOK });
const dayDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: BANGKOK });
const weekDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: BANGKOK });

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

const calendarMonthFormatter = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: BANGKOK });
const calendarDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: BANGKOK });
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
  const [appointmentLimit, setAppointmentLimit] = useState(APPOINTMENTS_PER_PAGE);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"work" | "finance">("work");
  const [bookingQuery, setBookingQuery] = useState("");
  const [bookingDate, setBookingDate] = useState("");
  const [slotFilterDate, setSlotFilterDate] = useState("");
  const [slotPage, setSlotPage] = useState(0);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [bookingsReady, setBookingsReady] = useState(false);
  // Slips waiting for this trainer's own review. `null` means the count could
  // not be read, which never invents work that is not there.
  const [pendingSlips, setPendingSlips] = useState<number | null>(null);
  const actionNoticeRef = useRef<HTMLParagraphElement>(null);
  const completionErrorRef = useRef<HTMLDivElement>(null);
  // Every dialog here is opened from a plain button rather than a DialogTrigger,
  // so the element that opened it is remembered and focused again on close.
  // Without this, dismissing with Escape dropped focus onto <body> and a
  // keyboard user restarted from the top of the document.
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
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
      authenticatedRequest<AdminQueue>("/v1/trainer/review-queue"),
    ]);
    void initialLoad.then(([workspaceResult, bookingResult, queueResult]) => {
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

      const queue = queueResult.status === "fulfilled" ? queueResult.value : null;
      setPendingSlips(Array.isArray(queue?.payments) ? queue.payments.length : null);
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
  const completedBookings = bookingsReady ? bookings.filter((booking) => booking.status === "completed") : [];
  // Money is only claimed where the review that makes it real has happened, so
  // the ledger keeps settled amounts apart from slips still under review.
  const approvedEarned = completedBookings
    .filter((booking) => booking.paymentStatus === "approved")
    .reduce((sum, b) => sum + (b.quotedPrice ?? 0), 0);
  const approvedCompletedCount = completedBookings.filter((booking) => booking.paymentStatus === "approved").length;
  const reviewEarned = completedBookings
    .filter((booking) => booking.paymentStatus === "reviewing")
    .reduce((sum, b) => sum + (b.quotedPrice ?? 0), 0);
  const upcomingEarned = confirmedBookings.reduce((sum, b) => sum + (b.quotedPrice ?? 0), 0);
  const nextAction = workspaceReady && bookingsReady ? getTrainerNextAction(workspace, bookings, pendingSlips ?? 0) : null;
  const actionBookingId = nextAction?.href.match(/(?:booking-|booking=)([^&#]+)/)?.[1];
  const orderedConfirmedBookings = confirmedBookings.slice().sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());
  const urgentBooking = orderedConfirmedBookings.find((booking) => booking.id === actionBookingId && booking.actions.canComplete && hasValidBookingPeriod(booking));
  function nextSession(booking: Booking) {
    return (booking.sessions?.length ? booking.sessions : [booking])
      .filter((session) => new Date(session.endsAt) > now)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
  }
  const upcomingBookings = orderedConfirmedBookings.filter((booking) => nextSession(booking))
    .sort((a, b) => new Date(nextSession(a)!.startsAt).getTime() - new Date(nextSession(b)!.startsAt).getTime());
  const pendingBookings = orderedConfirmedBookings.filter((booking) => !nextSession(booking));

  // The next-action card names one record, so following its link has to land on
  // that record's own button rather than merely near it. It runs only when the
  // URL targets that booking, so a plain visit to /trainer never steals focus.
  useEffect(() => {
    function focusTargetedRow() {
      if (!actionBookingId || window.location.hash !== `#booking-${actionBookingId}`) return;
      const row = document.getElementById(`booking-${actionBookingId}`);
      row?.querySelector<HTMLElement>(".queue-actions button:not([disabled])")?.focus();
    }
    focusTargetedRow();
    window.addEventListener("hashchange", focusTargetedRow);
    return () => window.removeEventListener("hashchange", focusTargetedRow);
    // `bookingsReady` re-runs it once the rows are mounted and the hash can hit.
  }, [actionBookingId, bookingsReady]);
  // One list owns every appointment: the records still owing a result first (the
  // actionable one on top), then the upcoming ones in date order. Two sections
  // made the page pay twice — a header, a count, an empty state and an expansion
  // control — for one collection split by a rule the trainer cannot see.
  const appointments = [
    ...(urgentBooking ? [urgentBooking, ...pendingBookings.filter((booking) => booking.id !== urgentBooking.id)] : pendingBookings),
    ...upcomingBookings,
  ];
  const filteredAppointments = appointments.filter((booking) =>
    `${booking.id} ${booking.member?.displayName ?? ""}`.toLocaleLowerCase("th-TH").includes(bookingQuery.trim().toLocaleLowerCase("th-TH"))
    && (!bookingDate || (booking.sessions?.length ? booking.sessions : [booking]).some((session) => localDateKey(new Date(session.startsAt)) === bookingDate)));
  // "Show more" appends the next page; the row named by the next-action card is
  // always on screen, even when it sits deeper in the list.
  const actionIndex = filteredAppointments.findIndex((booking) => booking.id === actionBookingId);
  const appointmentLimitApplied = actionIndex >= appointmentLimit ? actionIndex + 1 : appointmentLimit;
  const visibleAppointments = filteredAppointments.slice(0, appointmentLimitApplied);
  const hiddenAppointmentCount = Math.max(0, filteredAppointments.length - visibleAppointments.length);
  const slots = workspace?.slots ?? [];
  const filteredSlots = slots.filter((slot) => !slotFilterDate || localDateKey(new Date(slot.startsAt)) === slotFilterDate)
    .slice().sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const slotPages = Math.max(1, Math.ceil(filteredSlots.length / 6));
  const activeSlotPage = Math.min(slotPage, slotPages - 1);
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
        detail: slot.state === "held" ? "สมาชิกกำลังส่งสลิป ล็อก 10 นาที" : slot.state === "booked" ? "ถูกจองแล้ว" : slot.state === "blocked" ? "ปิดช่วงเวลา" : "ช่วงเวลาว่าง",
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
  const weekBookingCount = weeklySchedule.filter((item) => item.kind === "booking").length;

  // Arrow keys move between the two tabs, matching the profile page's tablist.
  function onTrainerTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    if (!approved) return; // a single-tab list has nowhere to move
    event.preventDefault();
    const next = event.key === "ArrowLeft" || event.key === "Home" ? "work" : "finance";
    setActiveTab(next);
    document.getElementById(`trainer-${next}-tab`)?.focus();
  }

  function openSlotDialog() {
    setAvailabilityError("");
    setFieldErrors({});
    setVisibleSlotMonth(monthKey(now));
    setSlotTimes([]);
    setCopyNextDay(false);
    setSlotDialogOpen(true);
  }

  function renderBookingRow(booking: Booking) {
    const session = nextSession(booking);
    const validPeriod = hasValidBookingPeriod(booking);
    const canComplete = validPeriod && booking.actions.canComplete;
    const isBusy = busy === `booking-${booking.id}`;
    return (
      <article className="trainer-appointment-row" id={`booking-${booking.id}`} key={booking.id} aria-busy={isBusy}>
        <div><strong>{booking.member?.displayName ?? "สมาชิก FitConnect"}</strong><small>{booking.id}</small></div>
        <div><span>{formatDateTime(session?.startsAt ?? booking.startsAt)}</span><small className={canComplete ? "trainer-appointment-row__pending" : undefined}>{canComplete ? "รอบันทึกผลการฝึก" : session ? "นัดที่กำลังจะถึง" : "รอจัดเวลาที่เหลือ / ตรวจรายละเอียด"}</small></div>
        {/* The row carries the action it is asking for, so the next-action card
            does not hand the trainer a place where the action does not exist. */}
        <div className="queue-actions">
          {canComplete && (
            <button
              type="button"
              disabled={isBusy}
              aria-label={`บันทึกผลการฝึก ${booking.id}`}
              onClick={(event) => { dialogTriggerRef.current = event.currentTarget; setBookingToComplete(booking); }}
            >
              {isBusy ? "กำลังบันทึก…" : "บันทึกผลการฝึก"}
            </button>
          )}
          {!validPeriod && <span>ข้อมูลเวลาไม่ถูกต้อง</span>}
          <button type="button" onClick={(event) => { dialogTriggerRef.current = event.currentTarget; setSelectedBooking(booking); }}>ดูรายละเอียด</button>
        </div>
      </article>
    );
  }

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
      setSelectedBooking(null);
      try {
        await refreshBookings();
        setBookingError("");
      } catch (error) {
        if (leaveExpiredSession(error, navigate)) return;
        setCompletionError("บันทึกผลแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setActionNotice(`บันทึกผลการฝึกสำหรับคำขอ ${bookingId} แล้ว`);
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setCompletionError(error instanceof Error ? error.message : "บันทึกผลการฝึกไม่สำเร็จ");
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
    const validPeriod = hasValidBookingPeriod(booking);
    return (
      <article className="trainer-booking-card" key={booking.id} aria-busy={isBusy}>
        <div className="trainer-booking-card__identity"><span>{booking.id}</span><h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3></div>
        <dl>
          <div><dt>เริ่มฝึก</dt><dd>{formatDateTime(booking.startsAt)}</dd></div>
          <div><dt>สิ้นสุด</dt><dd>{formatDateTime(booking.endsAt)}</dd></div>
          {/* A booking carries its own price and the review state that makes the
              money real, so nothing has to be recalled from an aggregate. */}
          <div><dt>ค่าฝึก</dt><dd>{formatMoney(booking.quotedPrice ?? undefined)}</dd></div>
          <div><dt>การชำระเงิน</dt><dd><StatusBadge status={booking.status} /></dd></div>
        </dl>
        {(booking.member?.goals || booking.member?.medicalNote || booking.member?.weight || booking.member?.height) && (
          <div className="trainer-booking-card__health text-sm space-y-1 my-2 p-2 bg-muted/40 rounded">
            {booking.member.goals && <div><span className="font-semibold text-xs text-muted-foreground">เป้าหมาย:</span> {booking.member.goals}</div>}
            {(booking.member.weight || booking.member.height) && (
              <div className="text-xs text-muted-foreground">
                {booking.member.weight && <span>น้ำหนัก: {booking.member.weight} กก. </span>}
                {booking.member.height && <span>ส่วนสูง: {booking.member.height} ซม.</span>}
              </div>
            )}
            {booking.member.medicalNote && <div className="text-destructive text-xs"><span>ข้อควรระวัง:</span> {booking.member.medicalNote}</div>}
          </div>
        )}
        {booking.note && (
          <div className="trainer-booking-card__note text-sm my-2 p-2 bg-accent/20 rounded">
            <span className="font-semibold text-xs text-muted-foreground">บันทึกเพิ่มเติมจากสมาชิก:</span>
            <p>{booking.note}</p>
          </div>
        )}
        {booking.bookingType === "monthly" && (
          <div className="monthly-booking-sessions">
            <strong>แพ็กเกจ 30 วัน · {booking.sessionCount ?? booking.sessions?.length ?? 0} ครั้ง</strong>
            <ol>{(booking.sessions ?? []).map((session) => <li key={`${session.id}-${session.startsAt}`}>{formatDateTime(session.startsAt)}</li>)}</ol>
          </div>
        )}
        <div className="queue-actions">
          {!validPeriod && <span className="booking-time-error">ข้อมูลเวลาไม่ถูกต้อง</span>}
          {validPeriod && !booking.actions.canComplete && <span>บันทึกผลได้หลัง {formatDateTime(booking.endsAt)}</span>}
          {booking.actions.canReadChat && (
            <Link href={`/chat?booking=${encodeURIComponent(booking.id)}`}>
              <MessageSquareText aria-hidden="true" size={17} /> เปิดการสนทนา
            </Link>
          )}
          {validPeriod && <button type="button" disabled={!booking.actions.canComplete || isBusy} aria-label={`${booking.actions.canComplete ? "บันทึกผลการฝึก" : "รอสิ้นสุดการฝึก"} ${booking.id}`} onClick={() => setBookingToComplete(booking)}>
            {isBusy ? "กำลังบันทึก…" : booking.actions.canComplete ? "บันทึกผลการฝึก" : "รอสิ้นสุดการฝึก"}
          </button>}
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
        {nextAction && (
        <NextActionCard
          action={nextAction}
          onFollow={() => {
            // After Next has pushed the hash, land the caret on the record's own
            // button so the card's promise is kept in one click.
            if (!actionBookingId) return;
            window.setTimeout(() => {
              document.getElementById(`booking-${actionBookingId}`)
                ?.querySelector<HTMLElement>(".queue-actions button:not([disabled])")
                ?.focus();
            }, 0);
          }}
        />
      )}
      </div>
    );
  }

  return (
    <div className="trainer-workbench">
      <section className={approved ? "trainer-workspace-status" : "approval-panel"} id="approval-status" aria-label="สถานะโปรไฟล์">
        {!approved && <div>
          <h2>โปรไฟล์ยังเปิดตารางไม่ได้</h2>
          <p>{workspace?.profile?.approvalNote ?? "รอผู้ดูแลระบบตรวจใบรับรองก่อนสร้างช่วงเวลาว่าง"}</p>
        </div>}
        {workspace?.profile && (
          <div className="approval-panel__actions">
            <Link className="button button--outline" href={`/trainers/${encodeURIComponent(workspace.profile.slug)}`}>
              หน้าโปรไฟล์เทรนเนอร์
            </Link>
            <StatusBadge status={workspace.profile.approvalStatus} />
            {approved && <Button type="button" onClick={(event) => { dialogTriggerRef.current = event.currentTarget; openSlotDialog(); }}><CalendarPlus aria-hidden="true" size={18} /> เปิดเวลารับจอง</Button>}
          </div>
        )}
        {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
      </section>

      {nextAction && (
        <NextActionCard
          action={nextAction}
          onFollow={() => {
            // After Next has pushed the hash, land the caret on the record's own
            // button so the card's promise is kept in one click.
            if (!actionBookingId) return;
            window.setTimeout(() => {
              document.getElementById(`booking-${actionBookingId}`)
                ?.querySelector<HTMLElement>(".queue-actions button:not([disabled])")
                ?.focus();
            }, 0);
          }}
        />
      )}
      {actionNotice && <p ref={actionNoticeRef} className="queue-notice workbench-success" role="status" tabIndex={-1}>{actionNotice}</p>}

      {/* The result of recording a session must stay visible even when the
          follow-up refresh failed and the list is no longer on screen. */}
      {completionError && (
        <div ref={completionErrorRef} className="workbench-error" role="alert" tabIndex={-1}>
          <span>{completionError}</span>
          <button type="button" disabled={busy === "bookings-refresh"} onClick={() => void retryBookingRefresh()}>
            <RefreshCw aria-hidden="true" size={15} /> {busy === "bookings-refresh" ? "กำลังโหลด…" : "ลองโหลดใหม่"}
          </button>
        </div>
      )}

      {/* Two questions, two tabs: the work itself, and the money it earned. The
          ledger used to sit in the work column as a fourth disclosure; as its own
          tab it stops competing with the records a trainer acts on. */}
      <div className="profile-tabs" role="tablist" aria-label="มุมมองพื้นที่เทรนเนอร์">
        <button
          type="button"
          role="tab"
          id="trainer-work-tab"
          aria-selected={activeTab === "work"}
          aria-controls="trainer-work-panel"
          tabIndex={activeTab === "work" ? 0 : -1}
          onClick={() => setActiveTab("work")}
          onKeyDown={onTrainerTabKeyDown}
        >
          งานและตาราง <span>{appointments.length}</span>
        </button>
        {approved && (
          <button
            type="button"
            role="tab"
            id="trainer-finance-tab"
            aria-selected={activeTab === "finance"}
            aria-controls="trainer-finance-panel"
            tabIndex={activeTab === "finance" ? 0 : -1}
            onClick={() => setActiveTab("finance")}
            onKeyDown={onTrainerTabKeyDown}
          >
            สรุปการเงิน <span>{bookingsReady ? formatMoney(approvedEarned) : "—"}</span>
          </button>
        )}
      </div>

      <div id="trainer-work-panel" role="tabpanel" aria-labelledby="trainer-work-tab" hidden={activeTab !== "work"}>

      {bookingsReady ? (
        <section className="trainer-booking-list" id="appointments" aria-labelledby="trainer-appointments-title">
          <header className="section-line-heading trainer-booking-list__heading">
            <div>
              <h2 id="trainer-appointments-title">นัดของสมาชิก</h2>
              <p>รอบันทึกผลการฝึกก่อน แล้วจึงเป็นนัดที่กำลังจะถึง</p>
            </div>
            <div className="trainer-booking-list__meta">
              <span className="queue-count">{filteredAppointments.length} รายการ</span>
              <a className="button button--outline" href="#schedule" onClick={() => setScheduleOpen(true)}>ดูตารางเต็ม</a>
            </div>
          </header>

          <details className="trainer-disclosure trainer-list-filters" open={bookingQuery !== "" || bookingDate !== "" || undefined}>
            <summary>
              <span><Search aria-hidden="true" size={18} /><strong>ค้นหาและกรองนัดหมาย</strong></span>
              <small>{bookingQuery || bookingDate ? `กรองแล้ว ${filteredAppointments.length} รายการ` : null}</small>
              <ChevronDown className="trainer-disclosure__chevron" aria-hidden="true" size={18} />
            </summary>
            <div className="trainer-list-filters__fields">
              <label className="field">ค้นหานัดหมาย<input type="search" placeholder="ชื่อสมาชิกหรือรหัสการจอง" value={bookingQuery} onChange={(event) => { setBookingQuery(event.target.value); setAppointmentLimit(APPOINTMENTS_PER_PAGE); }} /></label>
              <label className="field">วันที่ฝึก<input type="date" lang="th-TH" value={bookingDate} onChange={(event) => { setBookingDate(event.target.value); setAppointmentLimit(APPOINTMENTS_PER_PAGE); }} /></label>
              {bookingDate && <small className="availability-day-slots">วันที่เลือก {formatShortDay(bookingDate)}</small>}
              {(bookingQuery || bookingDate) && <Button type="button" variant="outline" onClick={() => { setBookingQuery(""); setBookingDate(""); setAppointmentLimit(APPOINTMENTS_PER_PAGE); }}>ล้างตัวกรอง</Button>}
            </div>
          </details>

          {appointments.length === 0 && <div className="empty-state"><strong>ยังไม่มีนัดที่ยืนยันแล้ว</strong><p>เมื่อนัดได้รับการยืนยัน รายละเอียดสมาชิกจะมาอยู่ตรงนี้</p></div>}
          {appointments.length > 0 && filteredAppointments.length === 0 && <div className="empty-state"><strong>ไม่พบนัดหมายที่ตรงกับตัวกรอง</strong><p>ลองเปลี่ยนชื่อหรือวันที่ค้นหา</p></div>}
          {visibleAppointments.map(renderBookingRow)}
          {hiddenAppointmentCount > 0 && (
            <Button className="trainer-booking-toggle" type="button" variant="outline" onClick={() => setAppointmentLimit(appointmentLimitApplied + APPOINTMENTS_PER_PAGE)}>
              แสดงอีก {Math.min(APPOINTMENTS_PER_PAGE, hiddenAppointmentCount)} รายการ · เหลือ {hiddenAppointmentCount}
            </Button>
          )}
          {appointmentLimitApplied > APPOINTMENTS_PER_PAGE && (
            <Button className="trainer-booking-toggle" type="button" variant="outline" onClick={() => setAppointmentLimit(APPOINTMENTS_PER_PAGE)}>ย่อนัดหมาย</Button>
          )}
        </section>
      ) : (
        <section className="trainer-booking-list" aria-label="นัดของสมาชิก">
          <div className="workbench-error" role="alert"><span>{bookingError || "โหลดนัดหมายไม่สำเร็จ"}</span><button type="button" onClick={() => void loadBookings()}><RefreshCw aria-hidden="true" size={15} /> ลองใหม่</button></div>
        </section>
      )}

      <details
        className="trainer-disclosure trainer-week"
        id="schedule"
        open={scheduleOpen || nextAction?.href === "/trainer#schedule" || nextAction?.href === "/trainer#availability"}
        onToggle={(event) => setScheduleOpen(event.currentTarget.open)}
      >
        <summary>
          <span><CalendarDays aria-hidden="true" size={20} /><strong>ตารางรายสัปดาห์และช่วงเวลาว่าง</strong></span>
          <small>{weekBookingCount} นัด · {slots.length} ช่วงเวลา</small>
          <ChevronDown className="trainer-disclosure__chevron" aria-hidden="true" size={18} />
        </summary>
        <div className="trainer-week-toolbar">
          <p className="trainer-week-strip__range" aria-live="polite">
            {weekDateFormatter.format(weekStart)} – {weekDateFormatter.format(addDays(weekEnd, -1))}
          </p>
          <div className="trainer-week-strip__controls" aria-label="เปลี่ยนสัปดาห์">
            <button type="button" aria-label="สัปดาห์ก่อนหน้า" onClick={() => setWeekOffset((current) => current - 1)}><ChevronLeft aria-hidden="true" size={18} /></button>
            <button type="button" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>สัปดาห์นี้</button>
            <button type="button" aria-label="สัปดาห์ถัดไป" onClick={() => setWeekOffset((current) => current + 1)}><ChevronRight aria-hidden="true" size={18} /></button>
          </div>
        </div>
        <div className="trainer-week__grid">
          {weekDays.map((day) => {
            const dayItems = weeklySchedule.filter((item) => localDateKey(new Date(item.startsAt)) === localDateKey(day));
            const dayLabel = `${dayNameFormatter.format(day)} ${dayDateFormatter.format(day)}`;
            return (
              <section className={`trainer-week__day${localDateKey(day) === localDateKey(now) ? " is-today" : ""}`} role="group" aria-label={dayLabel} key={localDateKey(day)}>
                <header>
                  <span>{dayNameFormatter.format(day)}</span>
                  <strong>{dayDateFormatter.format(day)}</strong>
                  {localDateKey(day) === localDateKey(now) && <span aria-current="date">วันนี้</span>}
                </header>
                <div className="trainer-week__events">
                  {dayItems.map((item) => {
                    const booking = item.booking;
                    const validBookingPeriod = !booking || hasValidBookingPeriod(booking);
                    return (
                      <article className={`trainer-week-event trainer-week-event--${item.kind} trainer-week-event--${item.state}`} key={item.key}>
                        <time dateTime={item.startsAt}>{formatTimeRange(item.startsAt, item.endsAt)}</time>
                        <strong>{item.title}</strong>
                        {validBookingPeriod
                          ? <span>{item.detail}</span>
                          : <span className="trainer-week-event__warning">ข้อมูลเวลาไม่ถูกต้อง</span>}
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
          <span><i className="is-available" aria-hidden="true" /> พร้อมจอง</span>
          <span><i className="is-held" aria-hidden="true" /> ล็อกชั่วคราว · สมาชิกกำลังส่งสลิป 10 นาที</span>
          <span><i className="is-confirmed" aria-hidden="true" /> นัดยืนยันแล้ว</span>
          <span><i className="is-blocked" aria-hidden="true" /> ปิดช่วงเวลา</span>
        </footer>

        {/* The slot tools live with the grid they change: the trainer who opens
            the week to see what is booked is the same trainer who opens it to add
            or remove a slot. The id keeps /trainer#availability working. */}
        <section className="trainer-availability" id="availability" aria-labelledby="trainer-availability-title">
          <header className="section-line-heading">
            <h3 id="trainer-availability-title">ช่วงเวลาที่เปิดรับจอง</h3>
            <span>{slots.length} ช่วงเวลา</span>
          </header>
          <div className="availability-launch">
            <p id="availability-add-hint">{approved ? "เลือกวันที่สะดวกและเวลาเริ่มต้น ระบบกำหนดเวลาฝึกครั้งละ 1 ชั่วโมง" : "รอผู้ดูแลระบบตรวจใบสมัครก่อนจึงจะเพิ่มช่วงเวลาได้"}</p>
            <Button type="button" disabled={!approved} aria-describedby="availability-add-hint" onClick={(event) => { dialogTriggerRef.current = event.currentTarget; openSlotDialog(); }}><CalendarPlus aria-hidden="true" size={18} /> เพิ่มช่วงเวลาว่าง</Button>
            <label className="field">กรองวันที่ว่าง<input type="date" lang="th-TH" value={slotFilterDate} onChange={(event) => { setSlotFilterDate(event.target.value); setSlotPage(0); }} /></label>
            {/* A native date field shows the browser's own format, so the chosen
                day is repeated in Buddhist-era Thai where the reader can check it. */}
            {slotFilterDate && <small className="availability-day-slots">วันที่เลือก {formatShortDay(slotFilterDate)}</small>}
            {slotFilterDate && <Button type="button" variant="outline" onClick={() => { setSlotFilterDate(""); setSlotPage(0); }}>ล้างวันที่</Button>}
          </div>
          {availabilityError && !slotDialogOpen && <p className="row-error" role="alert">{availabilityError}</p>}
          <div className="trainer-slot-list">
            {filteredSlots.slice(activeSlotPage * 6, (activeSlotPage + 1) * 6).map((slot) => {
              const canDelete = slot.state === "available" && new Date(slot.startsAt).getTime() > now.getTime();
              return (
                <div className="trainer-slot-row" key={slot.id} aria-busy={busy === `slot-${slot.id}`}>
                  <span><strong>{formatDateTime(slot.startsAt)}</strong><small>{slotStateCopy[slot.state]}</small></span>
                  {canDelete && <button type="button" disabled={busy === `slot-${slot.id}`} onClick={(event) => { dialogTriggerRef.current = event.currentTarget; setSlotToDelete(slot); }} aria-label={`ลบช่วงเวลา ${formatDateTime(slot.startsAt)}`}><Trash2 aria-hidden="true" size={16} /> ลบ</button>}
                </div>
              );
            })}
            {slots.length === 0 && <div className="empty-state"><strong>ยังไม่มีช่วงเวลาว่าง</strong><p>เพิ่มช่วงเวลาแรกเมื่อผู้ดูแลระบบตรวจใบสมัครแล้ว</p></div>}
            {slots.length > 0 && filteredSlots.length === 0 && <div className="empty-state"><strong>ไม่พบช่วงเวลาในวันที่เลือก</strong><p>ล้างวันที่เพื่อดูช่วงเวลาทั้งหมด</p></div>}
          </div>
          {slotPages > 1 && <nav className="trainer-list-pagination" aria-label="หน้ารายการเวลาว่าง"><Button type="button" variant="outline" disabled={activeSlotPage === 0} onClick={() => setSlotPage(activeSlotPage - 1)}>ก่อนหน้า</Button><span aria-live="polite">หน้า {activeSlotPage + 1} / {slotPages}</span><Button type="button" variant="outline" disabled={activeSlotPage + 1 === slotPages} onClick={() => setSlotPage(activeSlotPage + 1)}>ถัดไป</Button></nav>}
        </section>
      </details>

      <Dialog open={slotDialogOpen} onOpenChange={(open) => {
        if (busy === "slot-create") return;
        setSlotDialogOpen(open);
        if (!open) {
          setAvailabilityError("");
          setFieldErrors({});
        }
      }}>
        <DialogContent
          className="slot-calendar-dialog availability-calendar-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); dialogTriggerRef.current?.focus(); }}
        >
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
                  <p className="availability-day-slots">วันนี้มีอยู่แล้ว {slotsOnSelectedDay.map((slot) => `${formatTime(slot.startsAt)} น. · ${slotStateCopy[slot.state]}`).join(" · ")}</p>
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

      {/* The trainer's own slip queue sits at the end of the workspace as a
          disclosure, and only exists when a slip is actually waiting: freelance
          trainers are the reviewers of their own slips, and an empty desk is
          noise the next-action card already accounts for. */}
      {(pendingSlips !== null && pendingSlips > 0) || nextAction?.href === "/trainer#payment-review" ? (
        <TrainerPaymentReview
          pendingSlips={pendingSlips}
          open={nextAction?.href === "/trainer#payment-review"}
          onQueueLoaded={(queue) => setPendingSlips(queue.payments.length)}
        />
      ) : null}

      </div>

      {approved && (
        <div id="trainer-finance-panel" role="tabpanel" aria-labelledby="trainer-finance-tab" hidden={activeTab !== "finance"}>
          <section className="trainer-finance" aria-labelledby="trainer-finance-title">
            <header className="section-line-heading">
              <div>
                <h2 id="trainer-finance-title">สรุปการเงิน</h2>
              </div>
              <span className="queue-count">{bookingsReady ? `รับแล้ว ${formatMoney(approvedEarned)}` : "—"}</span>
            </header>
            <dl className="profile-ledger">
              <div><dt>ยอดที่ตรวจหลักฐานแล้ว</dt><dd>{bookingsReady ? `${formatMoney(approvedEarned)} · ${approvedCompletedCount} การจอง` : "—"}</dd></div>
              <div><dt>ยอดที่รอตรวจหลักฐาน</dt><dd>{bookingsReady ? formatMoney(reviewEarned) : "—"}</dd></div>
              <div><dt>มูลค่านัดที่ยืนยันแล้วแต่ยังไม่บันทึกผล</dt><dd>{bookingsReady ? `${formatMoney(upcomingEarned)} · ${confirmedBookings.length} การจอง` : "—"}</dd></div>
              <div><dt>ช่วงเวลาที่เปิดรับจอง</dt><dd>{slots.filter((slot) => slot.state === "available").length} จาก {slots.length} ช่วงเวลา</dd></div>
            </dl>
            <p className="profile-group__hint">ตัวเลขคิดจากค่าฝึกที่บันทึกไว้ในแต่ละการจอง และนับเป็นรายได้เฉพาะการจองที่หลักฐานการชำระเงินผ่านการตรวจแล้ว</p>
          </section>
        </div>
      )}

      <Dialog open={selectedBooking !== null} onOpenChange={(open) => { if (!open) setSelectedBooking(null); }}>
        <DialogContent
          className="trainer-appointment-dialog"
          onCloseAutoFocus={(event) => { event.preventDefault(); dialogTriggerRef.current?.focus(); }}
        >
          <DialogHeader><DialogTitle>รายละเอียดนัดหมาย</DialogTitle><DialogDescription>ข้อมูลสมาชิกและการฝึกในรายการจองนี้</DialogDescription></DialogHeader>
          {selectedBooking && renderConfirmedBooking(bookings.find((booking) => booking.id === selectedBooking.id) ?? selectedBooking)}
        </DialogContent>
      </Dialog>

      <Dialog open={slotToDelete !== null} onOpenChange={(open) => {
        if (busy?.startsWith("slot-")) return;
        if (!open) setSlotToDelete(null);
      }}>
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); dialogTriggerRef.current?.focus(); }}>
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
        <DialogContent onCloseAutoFocus={(event) => { event.preventDefault(); dialogTriggerRef.current?.focus(); }}>
          <DialogHeader>
            <DialogTitle>บันทึกผลการฝึก?</DialogTitle>
            <DialogDescription className="grid gap-1">
              <span>{bookingToComplete?.member?.displayName ?? "สมาชิก FitConnect"}</span>
              <span>{bookingToComplete ? `${formatDateTime(bookingToComplete.startsAt)} – ${formatDateTime(bookingToComplete.endsAt)}` : ""}</span>
              <span>คำสั่งนี้ปิดการจอง {bookingToComplete?.id} และให้สมาชิกเขียนรีวิวได้</span>
              {bookingToComplete?.bookingType === "monthly" && <span>เป็นการปิดทั้งแพ็กเกจรายเดือน ไม่ใช่เฉพาะการฝึกครั้งนี้</span>}
              <span>ห้องแชตจะอ่านประวัติได้อย่างเดียว สมาชิกและเทรนเนอร์จะส่งข้อความหรือไฟล์เพิ่มไม่ได้</span>
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
              {busy === `booking-${bookingToComplete?.id}` ? "กำลังบันทึก…" : "บันทึกผลการฝึก"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
