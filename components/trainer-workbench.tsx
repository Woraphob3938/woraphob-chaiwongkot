"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CSSProperties, FormEvent, KeyboardEvent, MouseEvent as ReactMouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CalendarCheck2, CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, ClipboardList, ExternalLink, Inbox, MessageSquareText, ReceiptText, RefreshCw, Star, Trash2, UsersRound, Wallet } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import { TrainerMembersPanel, TrainerReviewsPanel } from "@/components/trainer-members-panel";
import { StripePayoutsCard } from "@/components/stripe-payouts-card";
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
import { acceptanceTooLate, formatDateTime, formatMoney, formatTime, initials } from "@/lib/format";
import { leaveExpiredSession } from "@/lib/session";
import type { Booking, SlotState, TrainerAvailabilitySlot, TrainerStats, TrainerWorkspace } from "@/lib/types";

const slotStateCopy: Record<SlotState, string> = {
  available: "พร้อมจอง",
  held: "มีคำขอจอง",
  booked: "ยืนยันแล้ว",
  blocked: "ปิดช่วงเวลา",
};

/** reject: an unanswered request · cancel: a booking past the request. */
type DecisionKind = "reject" | "cancel";

const decisionCopy: Record<DecisionKind, { title: string; verb: string; confirm: string; done: string }> = {
  reject: { title: "ปฏิเสธคำขอจอง", verb: "ปฏิเสธ", confirm: "ยืนยันปฏิเสธ", done: "ปฏิเสธคำขอ" },
  cancel: { title: "ยกเลิกการจอง", verb: "ยกเลิก", confirm: "ยืนยันยกเลิกการจอง", done: "ยกเลิกการจอง" },
};

function isPendingTrainer(booking: { status: string }) {
  return booking.status === "pending_trainer";
}

/** Whether the trainer is the one who has to act next on this booking. */
function needsTrainer(booking: Booking) {
  return isPendingTrainer(booking) || booking.status === "payment_review";
}

/** A trainer may cancel any booking that is not closed yet, per the workflow. */
const TRAINER_CANCELLABLE_STATUSES = ["pending_trainer", "awaiting_payment", "payment_review", "confirmed"];

function canTrainerCancel(booking: Booking) {
  return booking.actions.canCancelBooking ?? TRAINER_CANCELLABLE_STATUSES.includes(booking.status);
}

/** One line telling the trainer what this request is waiting on. */
function requestHint(booking: Booking): string {
  if (booking.status === "pending_trainer") return "ตอบรับแล้วสมาชิกชำระเงินได้ทันทีภายใน 10 นาที เวลาฝึกยังเป็นเวลาที่สมาชิกขอ";
  if (booking.status === "awaiting_payment") return "รอสมาชิกชำระเงินออนไลน์ภายใน 10 นาทีหลังคุณตอบรับ";
  if (booking.status === "payment_review") return "รายการชำระเงินเดิมรอตรวจสอบ";
  return "";
}

function requestedStart(booking: Booking) {
  return booking.requestedStartsAt ?? booking.startsAt;
}

/** "ช่วงเวลาที่ยืนยัน" as one readable range, or null before the trainer answered. */
function confirmedPeriodLabel(booking: Booking): string | null {
  const start = booking.confirmedStartsAt;
  return start ? `${formatDateTime(start)} – ${formatTime(booking.confirmedEndsAt ?? start)} น.` : null;
}

const thaiMonthLabels = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

type TrainerTab = "work" | "members" | "reviews" | "finance";
const TRAINER_TABS: TrainerTab[] = ["work", "members", "reviews", "finance"];
const tabCopy = {
  work: { label: "งานและตาราง", Icon: ClipboardList },
  members: { label: "สมาชิก", Icon: UsersRound },
  reviews: { label: "รีวิว", Icon: Star },
  finance: { label: "การเงิน", Icon: Wallet },
};

function requestedPeriodLabel(booking: Booking): string {
  return `${formatDateTime(requestedStart(booking))} – ${formatTime(booking.endsAt)} น.`;
}

/** The API sends "YYYY-MM"; a bare month number reads the same way. */
function monthLabel(month: string | number) {
  const index = typeof month === "number" ? month : Number(String(month).slice(-2));
  return thaiMonthLabels[index - 1] ?? String(month);
}

// Every visible date and time is pinned to Bangkok so a trainer's schedule reads
// the same whatever timezone the machine that rendered it sits in.
const BANGKOK = "Asia/Bangkok";
/** How many appointments the trainer sees before asking for the next page. */
const APPOINTMENTS_PER_PAGE = 4;
const REQUESTS_PER_PAGE = 2;
const dayNameFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "short", timeZone: BANGKOK });
const dayDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: BANGKOK });
const weekDateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: BANGKOK });

/** Midnight at the start of the given day. The calendar runs seven days from
 *  today rather than Monday to Sunday: on a Sunday a calendar week was six days
 *  of past and hid tomorrow's session. */
function startOfDay(value: Date) {
  const date = new Date(value);
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
const heroDateFormatter = new Intl.DateTimeFormat("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: BANGKOK });
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

/** The hour grid always spans at least this working day. */
const DEFAULT_START_HOUR = 7;
const DEFAULT_END_HOUR = 21;

/**
 * Side-by-side lanes for a day's overlapping items: each item takes the first
 * lane free at its start, and every item in an overlapping cluster shares that
 * cluster's lane count so the columns line up.
 */
function layoutDay(items: Array<{ key: string; startsAt: string; endsAt: string }>) {
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
  const [requestLimit, setRequestLimit] = useState(REQUESTS_PER_PAGE);
  // Coming back from Stripe onboarding (?stripe=return|refresh) lands on the
  // finance tab, where the payout account card lives.
  const [activeTab, setActiveTab] = useState<TrainerTab>(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("stripe") ? "finance" : "work");
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const calendarScrollRef = useRef<HTMLDivElement>(null);
  // A minute clock for the calendar only: the red "now" line and which hours
  // may still take a new slot move with real time while the page stays open.
  const [clock, setClock] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [bookingsReady, setBookingsReady] = useState(false);
  // Trainer decisions on a booking: accept picks the confirmed time, reject and
  // cancel both require a reason the member can read.
  const [bookingToAccept, setBookingToAccept] = useState<Booking | null>(null);
  const [bookingToDecide, setBookingToDecide] = useState<Booking | null>(null);
  const [decisionKind, setDecisionKind] = useState<DecisionKind>("reject");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionReasonError, setDecisionReasonError] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [slotToEdit, setSlotToEdit] = useState<TrainerAvailabilitySlot | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editError, setEditError] = useState("");
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear());
  const [statsMode, setStatsMode] = useState<"monthly" | "yearly">("monthly");
  const [statsError, setStatsError] = useState("");
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsReload, setStatsReload] = useState(0);
  const actionNoticeRef = useRef<HTMLParagraphElement>(null);
  const completionErrorRef = useRef<HTMLDivElement>(null);
  // Every dialog here is opened from a plain button rather than a DialogTrigger,
  // so the element that opened it is remembered and focused again on close.
  // Without this, dismissing with Escape dropped focus onto <body> and a
  // keyboard user restarted from the top of the document. It is ordinary state
  // rather than a ref because react-hooks/refs forbids ref writes from the
  // render helpers below.
  const [dialogTrigger, setDialogTrigger] = useState<HTMLElement | null>(null);
  const rememberDialogTrigger = (event: { currentTarget: HTMLElement }) => {
    setDialogTrigger(event.currentTarget);
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    dialogTrigger?.focus();
  };
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
    // Started from a callback: the loaders set state, which an effect body may not do directly.
    void Promise.resolve().then(() => Promise.all([loadWorkspace(), loadBookings()])).then(() => setLoading(false));
  }, [loadWorkspace, loadBookings]);

  useEffect(() => {
    if (actionNotice) actionNoticeRef.current?.focus();
  }, [actionNotice]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (completionError) completionErrorRef.current?.focus();
  }, [completionError]);

  // Statistics load only when the finance tab asks for them, so opening the
  // workspace never waits on a second request.
  useEffect(() => {
    if (activeTab !== "finance" || workspace?.profile?.approvalStatus !== "approved") return;
    let cancelled = false;
    // เลื่อนการเปลี่ยน state ออกไปหนึ่ง tick — เอฟเฟกต์ต้องไม่ setState ตรง ๆ
    // ระหว่างเรนเดอร์ (react-hooks/set-state-in-effect)
    const kickoff = setTimeout(() => {
      setStatsLoading(true);
      setStatsError("");
      void (async () => {
        try {
          const data = await authenticatedRequest<TrainerStats | null>(`/v1/trainer/stats?year=${statsYear}`);
          if (!cancelled) setStats(data ?? null);
        } catch (error) {
          if (cancelled) return;
          if (leaveExpiredSession(error, navigate)) return;
          setStatsError(error instanceof Error ? error.message : "โหลดสถิติไม่สำเร็จ");
        } finally {
          if (!cancelled) setStatsLoading(false);
        }
      })();
    }, 0);
    return () => { cancelled = true; clearTimeout(kickoff); };
  }, [activeTab, navigate, statsReload, statsYear, workspace?.profile?.approvalStatus]);

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
  // Bookings that still carry a trainer decision: a new request to answer, or a
  // booking whose payment step is running and can still be called off.
  const decisionBookings = bookingsReady
    ? bookings
      .filter((booking) => isPendingTrainer(booking) || booking.status === "awaiting_payment" || booking.status === "payment_review")
      .sort((left, right) => Number(needsTrainer(right)) - Number(needsTrainer(left)))
    : [];
  const requestsForTrainer = decisionBookings.filter(needsTrainer).length;
  const requestsForMember = decisionBookings.length - requestsForTrainer;
  const awaitingPaymentCount = bookingsReady ? bookings.filter((booking) => booking.status === "awaiting_payment").length : 0;
  const visibleRequests = decisionBookings.slice(0, requestLimit);
  const completedBookings = bookingsReady ? bookings.filter((booking) => booking.status === "completed") : [];
  // Money is only claimed once the payment has settled, so the ledger keeps
  // paid amounts apart from anything still unsettled.
  const approvedEarned = completedBookings
    .filter((booking) => booking.paymentStatus === "approved")
    .reduce((sum, b) => sum + (b.quotedPrice ?? 0), 0);
  const approvedCompletedCount = completedBookings.filter((booking) => booking.paymentStatus === "approved").length;
  const reviewEarned = completedBookings
    .filter((booking) => booking.paymentStatus === "reviewing")
    .reduce((sum, b) => sum + (b.quotedPrice ?? 0), 0);
  const upcomingEarned = confirmedBookings.reduce((sum, b) => sum + (b.quotedPrice ?? 0), 0);
  const nextAction = workspaceReady && bookingsReady ? getTrainerNextAction(workspace, bookings) : null;
  const actionBookingId = nextAction?.href.match(/(?:booking-|booking=|request-)([^&#]+)/)?.[1];
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
  const pendingRequestCount = bookingsReady ? bookings.filter(isPendingTrainer).length : 0;
  const openSlotCount = (workspace?.slots ?? []).filter((slot) => slot.state === "available" && new Date(slot.startsAt).getTime() > now.getTime()).length;

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
  // After Next has pushed the hash, land the caret on the record's own button
  // so the next-action card's promise is kept in one click.
  function focusActionRecord() {
    if (!actionBookingId) return;
    window.setTimeout(() => {
      (document.getElementById(`booking-${actionBookingId}`) ?? document.getElementById(`request-${actionBookingId}`))
        ?.querySelector<HTMLElement>(".queue-actions button:not([disabled]), button:not([disabled])")
        ?.focus();
    }, 0);
  }
  // One list owns every appointment: the records still owing a result first (the
  // actionable one on top), then the upcoming ones in date order. Two sections
  // made the page pay twice — a header, a count, an empty state and an expansion
  // control — for one collection split by a rule the trainer cannot see.
  const appointments = [
    ...(urgentBooking ? [urgentBooking, ...pendingBookings.filter((booking) => booking.id !== urgentBooking.id)] : pendingBookings),
    ...upcomingBookings,
  ];
  // The tab badge counts what asks the trainer to act, not every record.
  const workAttention = requestsForTrainer
    + appointments.filter((booking) => booking.actions.canComplete && hasValidBookingPeriod(booking)).length;
  // "Show more" appends the next page; the row named by the next-action card is
  // always on screen, even when it sits deeper in the list.
  const actionIndex = appointments.findIndex((booking) => booking.id === actionBookingId);
  const appointmentLimitApplied = actionIndex >= appointmentLimit ? actionIndex + 1 : appointmentLimit;
  const visibleAppointments = appointments.slice(0, appointmentLimitApplied);
  const hiddenAppointmentCount = Math.max(0, appointments.length - visibleAppointments.length);
  const slots = workspace?.slots ?? [];
  const statsMonths = thaiMonthLabels.map((label) => ({
    label,
    bookings: stats?.bookingsByMonth.find((row) => monthLabel(row.month) === label)?.total ?? 0,
    income: stats?.incomeByMonth.find((row) => monthLabel(row.month) === label)?.amount ?? 0,
  })).filter((line) => line.bookings !== 0 || line.income !== 0);
  const statsYearTotal = stats?.totals ?? { bookings: 0, income: 0 };
  const statsSalary = stats?.salarySummary ?? [];
  const slotsOnSelectedDay = slotDate
    ? slots.filter((slot) => localDateKey(new Date(slot.startsAt)) === slotDate)
    : [];
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
  }, [weekOffset, approved, activeTab]);

  // Arrow keys move between the tabs, matching the profile page's tablist.
  function onTrainerTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    if (!approved) return; // a single-tab list has nowhere to move
    event.preventDefault();
    const index = TRAINER_TABS.indexOf(activeTab);
    const next = event.key === "Home"
      ? TRAINER_TABS[0]
      : event.key === "End"
        ? TRAINER_TABS[TRAINER_TABS.length - 1]
        : TRAINER_TABS[(index + (event.key === "ArrowRight" ? 1 : TRAINER_TABS.length - 1)) % TRAINER_TABS.length];
    setActiveTab(next);
    document.getElementById(`trainer-${next}-tab`)?.focus();
  }

  function openSlotDialog(day?: Date, hour?: number) {
    setAvailabilityError("");
    setFieldErrors({});
    setVisibleSlotMonth(monthKey(day ?? now));
    setSlotDate(day ? localDateKey(day) : "");
    setSlotTimes(day && hour !== undefined ? [hourLabel(hour)] : []);
    setCopyNextDay(false);
    setSlotDialogOpen(true);
  }

  /** A click on an empty stretch of a day column offers that hour as a new slot. */
  function onCalendarColumnClick(event: ReactMouseEvent<HTMLDivElement>, day: Date) {
    if (event.target !== event.currentTarget || !approved) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height <= 0) return;
    const hour = calendarStartHour + Math.floor(((event.clientY - rect.top) / rect.height) * calendarHours.length);
    const start = new Date(day);
    start.setHours(hour, 0, 0, 0);
    if (start <= clock || start > maxDate || !slotHours.includes(hour)) return;
    setDialogTrigger(event.currentTarget);
    openSlotDialog(day, hour);
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
        <button type="button" className={className} style={style} key={item.key} onClick={(event) => { rememberDialogTrigger(event); setSelectedBooking(booking); }}>
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
          onClick={(event) => { rememberDialogTrigger(event); openSlotEdit(slot); }}
        >
          {body}
        </button>
      );
    }
    return <article className={className} style={style} key={item.key}>{body}</article>;
  }

  function renderBookingRow(booking: Booking) {
    const session = nextSession(booking);
    const validPeriod = hasValidBookingPeriod(booking);
    const canComplete = validPeriod && booking.actions.canComplete;
    const isBusy = busy === `booking-${booking.id}`;
    return (
      <article className="trainer-appointment-row" id={`booking-${booking.id}`} key={booking.id} aria-busy={isBusy}>
        <div className="trainer-appointment-row__who"><span className="trainer-avatar" aria-hidden="true">{initials(booking.member?.displayName ?? "สมาชิก")}</span><span><strong>{booking.member?.displayName ?? "สมาชิก FitConnect"}</strong><small>{booking.id}</small></span></div>
        <div className="trainer-appointment-row__when"><span>{formatDateTime(session?.startsAt ?? booking.startsAt)}</span><small className={canComplete ? "trainer-appointment-row__pending" : undefined}>{canComplete ? "รอบันทึกผลการฝึก" : session ? "นัดที่กำลังจะถึง" : "รอจัดเวลาที่เหลือ / ตรวจรายละเอียด"}</small></div>
        {/* The row carries the action it is asking for, so the next-action card
            does not hand the trainer a place where the action does not exist. */}
        <div className="queue-actions">
          {canComplete && (
            <button
              type="button"
              className="queue-actions__primary"
              disabled={isBusy}
              aria-label={`บันทึกผลการฝึก ${booking.id}`}
              onClick={(event) => { rememberDialogTrigger(event); setBookingToComplete(booking); }}
            >
              {isBusy ? "กำลังบันทึก…" : "บันทึกผลการฝึก"}
            </button>
          )}
          {!validPeriod && <span>ข้อมูลเวลาไม่ถูกต้อง</span>}
          <button type="button" className="queue-actions__quiet" onClick={(event) => { rememberDialogTrigger(event); setSelectedBooking(booking); }}>ดูรายละเอียด</button>
        </div>
      </article>
    );
  }

  /** A booking still waiting on the trainer's decision or its payment step. */
  function renderRequestCard(booking: Booking) {
    const isBusy = busy === `booking-${booking.id}`;
    const pending = isPendingTrainer(booking);
    const confirmedLabel = confirmedPeriodLabel(booking);
    return (
      <article className={`trainer-booking-card${needsTrainer(booking) ? "" : " is-waiting"}`} id={`request-${booking.id}`} key={`request-${booking.id}`} aria-busy={isBusy}>
        <div className="trainer-booking-card__identity">
          <span className="trainer-avatar" aria-hidden="true">{initials(booking.member?.displayName ?? "สมาชิก")}</span>
          <div>
            <h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3>
            <span className="trainer-booking-card__meta"><span>{booking.id}</span><span>{booking.bookingType === "monthly" ? `แพ็กเกจ ${booking.sessionCount} ครั้ง` : "รายครั้ง"}</span></span>
          </div>
          <StatusBadge status={booking.status} />
        </div>
        <p className="trainer-booking-card__hint">{requestHint(booking)}</p>
        <dl>
          {confirmedLabel ? (
            <div className="trainer-booking-card__confirmed"><dt>ช่วงเวลาที่ยืนยัน</dt><dd><strong>{confirmedLabel}</strong></dd></div>
          ) : (
            <div><dt>ช่วงเวลาที่ต้องการ</dt><dd>{formatDateTime(requestedStart(booking))} – {formatTime(booking.endsAt)} น.</dd></div>
          )}
          <div><dt>ค่าฝึก</dt><dd>{formatMoney(booking.quotedPrice ?? undefined)}</dd></div>
        </dl>
        {booking.note && (
          <div className="trainer-booking-card__note">
            <span>บันทึกเพิ่มเติมจากสมาชิก</span>
            <p>{booking.note}</p>
          </div>
        )}
        <div className="queue-actions">
          {pending && (booking.actions.canAccept ?? true) && (
            <button
              type="button"
              className="queue-actions__primary"
              disabled={isBusy}
              aria-label={`ตอบรับ ${booking.id}`}
              onClick={(event) => {
                rememberDialogTrigger(event);
                setBookingToAccept(booking);
              }}
            >
              ตอบรับ
            </button>
          )}
          {pending && (booking.actions.canReject ?? true) && (
            <button
              type="button"
              disabled={isBusy}
              aria-label={`ปฏิเสธ ${booking.id}`}
              onClick={(event) => { openDecisionDialog(booking, "reject", event); }}
            >
              ปฏิเสธ
            </button>
          )}
          {!pending && canTrainerCancel(booking) && (
            <button
              type="button"
              disabled={isBusy}
              aria-label={`ยกเลิกการจอง ${booking.id}`}
              onClick={(event) => { openDecisionDialog(booking, "cancel", event); }}
            >
              ยกเลิกการจอง
            </button>
          )}
          <button type="button" className="queue-actions__quiet" onClick={(event) => { rememberDialogTrigger(event); setSelectedBooking(booking); }}>ดูรายละเอียด</button>
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

  /** One PATCH carries every trainer decision: accept, reject, or cancel. */
  async function patchBookingDecision(booking: Booking, payload: Record<string, string>, successNotice: string) {
    if (busy) return;
    setBusy(`booking-${booking.id}`);
    setBookingError("");
    setDecisionError("");
    setCompletionError("");
    setActionNotice("");
    try {
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(booking.id)}/status`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setBookingToAccept(null);
      setBookingToDecide(null);
      setDecisionReason("");
      setDecisionReasonError("");
      setSelectedBooking(null);
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setDecisionError(error instanceof Error ? error.message : "บันทึกรายการนี้ไม่สำเร็จ");
      return;
    } finally {
      setBusy(null);
    }
    setBusy("bookings-refresh");
    try {
      await Promise.all([refreshBookings(), loadWorkspace()]);
      setBookingError("");
      setActionNotice(successNotice);
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setCompletionError("บันทึกการตัดสินใจแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(null);
    }
  }

  function acceptBooking() {
    const booking = bookingToAccept;
    if (!booking) return;
    void patchBookingDecision(
      booking,
      { status: "awaiting_payment" },
      `ตอบรับคำขอ ${booking.id} แล้ว สมาชิกได้รับแจ้งและชำระเงินได้ภายใน 10 นาที`,
    );
  }

  function submitReasonDecision() {
    const booking = bookingToDecide;
    if (!booking) return;
    const reason = decisionReason.trim();
    if (!reason) {
      setDecisionReasonError("กรุณาระบุเหตุผล");
      return;
    }
    setDecisionReasonError("");
    void patchBookingDecision(
      booking,
      { status: "cancelled", note: reason },
      `${decisionCopy[decisionKind].done} ${booking.id} แล้ว และคืนช่วงเวลาให้สมาชิกอื่น`,
    );
  }

  function openDecisionDialog(booking: Booking, kind: DecisionKind, event?: { currentTarget: HTMLElement }) {
    if (event) rememberDialogTrigger(event);
    setDecisionKind(kind);
    setDecisionReason("");
    setDecisionReasonError("");
    setDecisionError("");
    setBookingToDecide(booking);
  }

  function openSlotEdit(slot: TrainerAvailabilitySlot) {
    const start = new Date(slot.startsAt);
    setEditDate(localDateKey(start));
    setEditTime(`${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`);
    setEditError("");
    setSlotToEdit(slot);
  }

  async function saveSlotEdit() {
    const slot = slotToEdit;
    if (!slot || busy) return;
    const start = new Date(`${editDate}T${editTime}`);
    if (!editDate || !editTime || Number.isNaN(start.getTime())) {
      setEditError("เลือกวันและเวลาเริ่มต้นใหม่");
      return;
    }
    setBusy(`slot-${slot.id}`);
    setEditError("");
    try {
      await authenticatedRequest(`/v1/availability-slots/${slot.id}`, {
        method: "PATCH",
        body: JSON.stringify({ startsAt: start.toISOString() }),
      });
      await loadWorkspace();
      setSlotToEdit(null);
      setActionNotice("ย้ายช่วงเวลาว่างแล้ว");
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      setEditError(error instanceof Error ? error.message : "แก้ไขช่วงเวลาไม่สำเร็จ");
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
    const confirmedLabel = confirmedPeriodLabel(booking);
    const cancellationReason = booking.cancellationReason;
    return (
      <article className="trainer-booking-card" key={booking.id} aria-busy={isBusy}>
        <div className="trainer-booking-card__identity"><span>{booking.id}</span><h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3></div>
        <dl>
          {/* The period the trainer confirmed leads: when it differs from the
              request it is the time both sides now work from. */}
          {confirmedLabel && (
            <div className="trainer-booking-card__confirmed"><dt>ช่วงเวลาที่ยืนยัน</dt><dd><strong>{confirmedLabel}</strong></dd></div>
          )}
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
          <div className="trainer-booking-card__note">
            <span>บันทึกเพิ่มเติมจากสมาชิก</span>
            <p>{booking.note}</p>
          </div>
        )}
        {cancellationReason && (
          <div className="trainer-booking-card__note text-sm my-2 p-2 bg-accent/20 rounded">
            <span className="font-semibold text-xs text-muted-foreground">เหตุผลที่ยกเลิก:</span>
            <p>{cancellationReason}</p>
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
          {canTrainerCancel(booking) && (
            <button
              type="button"
              disabled={isBusy}
              aria-label={`ยกเลิกการจอง ${booking.id}`}
              onClick={(event) => { openDecisionDialog(booking, "cancel", event); }}
            >
              ยกเลิกการจอง
            </button>
          )}
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
          onFollow={focusActionRecord}
        />
      )}
      </div>
    );
  }

  return (
    <div className="trainer-workbench">
      {approved && workspace?.profile ? (
        <section className="trainer-hero" id="approval-status" aria-label="สถานะโปรไฟล์">
          <div className="trainer-hero__intro">
            <p className="trainer-hero__eyebrow">พื้นที่เทรนเนอร์ · {heroDateFormatter.format(now)}</p>
            <h2 className="trainer-hero__title">สวัสดี {workspace.profile.displayName}</h2>
            <div className="trainer-hero__meta">
              <span className="trainer-hero__verified"><BadgeCheck aria-hidden="true" size={16} /> โปรไฟล์ได้รับอนุมัติ เปิดรับจองอยู่</span>
              <Link className="trainer-hero__link" href={`/trainers/${encodeURIComponent(workspace.profile.slug)}`}>
                หน้าโปรไฟล์เทรนเนอร์ <ExternalLink aria-hidden="true" size={14} />
              </Link>
            </div>
          </div>
          <ul className="trainer-kpis" aria-label="ภาพรวมวันนี้">
            {[
              { href: pendingRequestCount > 0 ? "#trainer-requests" : "#appointments", Icon: Inbox, value: pendingRequestCount, label: "คำขอรอตอบรับ", always: false },
              { href: "#trainer-requests", Icon: ReceiptText, value: awaitingPaymentCount, label: "รอสมาชิกชำระเงิน", always: false },
              { href: "#appointments", Icon: CalendarCheck2, value: upcomingBookings.length, label: "นัดที่กำลังจะถึง", always: false },
              { href: "#schedule", Icon: CalendarDays, value: openSlotCount, label: "ช่วงเวลาเปิดรับจอง", always: true },
            ].map(({ href, Icon, value, label, always }, index) => (
              <li key={label} className={index === 0 && value > 0 ? "is-attention" : undefined}>
                <a href={href} onClick={() => setActiveTab("work")}>
                  <span className="trainer-kpis__icon" aria-hidden="true"><Icon size={16} /></span>
                  <strong>{always || bookingsReady ? value : "–"}</strong>
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
          {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
        </section>
      ) : (
      <section className="approval-panel" id="approval-status" aria-label="สถานะโปรไฟล์">
        {!approved && <div>
          <h2>โปรไฟล์ยังเปิดตารางไม่ได้</h2>
          <p>{workspace?.profile?.approvalNote ?? "รอผู้ดูแลระบบตรวจใบรับรองก่อนสร้างช่วงเวลาว่าง"}</p>
        </div>}
        {workspace?.profile && (
          <div className="approval-panel__actions">
            <Link className="button button--outline" href={`/trainers/${encodeURIComponent(workspace.profile.slug)}`}>
              หน้าโปรไฟล์เทรนเนอร์
            </Link>
            <StatusBadge status={workspace.profile.approvalStatus} source="approval" />
            {!approved && <Button type="button" disabled title="รอผู้ดูแลระบบตรวจโปรไฟล์ก่อน">เพิ่มช่วงเวลาว่าง</Button>}
          </div>
        )}
        {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
      </section>
      )}

      {/* The card speaks only when there is something to do or wait for. The
          "all set" state repeated what the calendar below already shows and
          pushed the work down a whole screen on a phone. */}
      {nextAction && nextAction.state !== "complete" && (
        <NextActionCard
          action={nextAction}
          onFollow={focusActionRecord}
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
      <div className="profile-tabs trainer-tabs" role="tablist" aria-label="มุมมองพื้นที่เทรนเนอร์">
        {TRAINER_TABS.filter((tab) => tab === "work" || approved).map((tab) => {
          const { label, Icon } = tabCopy[tab];
          return (
            <button
              type="button"
              role="tab"
              key={tab}
              id={`trainer-${tab}-tab`}
              aria-selected={activeTab === tab}
              aria-controls={`trainer-${tab}-panel`}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={onTrainerTabKeyDown}
            >
              <Icon aria-hidden="true" size={17} /> {label} {tab === "work" && workAttention > 0 && <span>{workAttention}</span>}
            </button>
          );
        })}
      </div>

      <div id="trainer-work-panel" role="tabpanel" aria-labelledby="trainer-work-tab" hidden={activeTab !== "work"}>

      {/* Requests needing a decision stay first in the work list. */}
      {decisionBookings.length > 0 && (
        <section className="trainer-booking-list" id="trainer-requests" aria-labelledby="trainer-requests-title">
          <header className="section-line-heading trainer-booking-list__heading">
            <div>
              <h2 id="trainer-requests-title">คำขอจอง</h2>
            </div>
            <span className="trainer-booking-list__counts">
              {requestsForTrainer > 0 && <span className="queue-count queue-count--attention">รอคุณ {requestsForTrainer}</span>}
              {requestsForMember > 0 && <span className="queue-count">รอสมาชิก {requestsForMember}</span>}
            </span>
          </header>
          {visibleRequests.map(renderRequestCard)}
          {decisionBookings.length > REQUESTS_PER_PAGE && (
            <Button className="trainer-booking-toggle" type="button" variant="outline" onClick={() => setRequestLimit(requestLimit >= decisionBookings.length ? REQUESTS_PER_PAGE : decisionBookings.length)}>
              {requestLimit >= decisionBookings.length ? "ย่อรายการ" : `ดูอีก ${decisionBookings.length - visibleRequests.length} รายการ`}
            </Button>
          )}
        </section>
      )}

      {/* The calendar is the page: one hour grid for the week, with the list of
          who is next beside it. Slots are managed by clicking them, and a click
          on an empty hour offers it as a new slot, so the separate slot list,
          its date filter and its pagination are gone. */}
      <div className={`trainer-planner${approved ? "" : " trainer-planner--single"}`}>
      {approved && (
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
              <Button type="button" onClick={(event) => { rememberDialogTrigger(event); openSlotDialog(); }}>
                <CalendarPlus aria-hidden="true" size={18} /> เพิ่มช่วงเวลาว่าง
              </Button>
            </span>
          </header>
          {availabilityError && !slotDialogOpen && !slotToDelete && <p className="row-error trainer-cal__error" role="alert">{availabilityError}</p>}


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
      )}

      {bookingsReady ? (
        <section className="trainer-booking-list trainer-agenda" id="appointments" aria-labelledby="trainer-appointments-title">
          <header className="section-line-heading trainer-booking-list__heading">
            <div>
              <h2 id="trainer-appointments-title">นัดของสมาชิก</h2>
            </div>
            <div className="trainer-booking-list__meta">
              <span className="queue-count">{appointments.length} รายการ</span>
            </div>
          </header>
          {appointments.length === 0 && <div className="empty-state"><strong>ยังไม่มีนัดที่ยืนยันแล้ว</strong><p>เมื่อนัดได้รับการยืนยัน รายละเอียดสมาชิกจะมาอยู่ตรงนี้</p></div>}
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
        <section className="trainer-booking-list trainer-agenda" aria-label="นัดของสมาชิก">
          <div className="workbench-error" role="alert"><span>{bookingError || "โหลดนัดหมายไม่สำเร็จ"}</span><button type="button" onClick={() => void loadBookings()}><RefreshCw aria-hidden="true" size={15} /> ลองใหม่</button></div>
        </section>
      )}
      </div>

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
          onCloseAutoFocus={restoreFocus}
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
                        setFieldErrors({});
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
                              setFieldErrors({});
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


      </div>

      {approved && activeTab === "members" && (
        <div id="trainer-members-panel" role="tabpanel" aria-labelledby="trainer-members-tab">
          <TrainerMembersPanel />
        </div>
      )}

      {approved && activeTab === "reviews" && (
        <div id="trainer-reviews-panel" role="tabpanel" aria-labelledby="trainer-reviews-tab">
          <TrainerReviewsPanel />
        </div>
      )}

      {approved && (
        <div id="trainer-finance-panel" role="tabpanel" aria-labelledby="trainer-finance-tab" hidden={activeTab !== "finance"}>
          {activeTab === "finance" && <StripePayoutsCard />}
          <section className="trainer-finance" aria-labelledby="trainer-finance-title">
            <header className="section-line-heading">
              <div>
                <h2 id="trainer-finance-title">สรุปการเงิน</h2>
              </div>
              <span className="queue-count">{bookingsReady ? `รับแล้ว ${formatMoney(approvedEarned)}` : "—"}</span>
            </header>
            <dl className="trainer-money-cards">
              <div className="is-primary"><dt>รับแล้ว (ชำระผ่านระบบ)</dt><dd><strong>{bookingsReady ? formatMoney(approvedEarned) : "—"}</strong><small>{approvedCompletedCount} การจอง</small></dd></div>
              <div><dt>รอตรวจสอบการชำระ (รายการเดิม)</dt><dd><strong>{bookingsReady ? formatMoney(reviewEarned) : "—"}</strong><small>ยังไม่นับเป็นรายได้</small></dd></div>
              <div><dt>นัดยืนยันแล้ว ยังไม่บันทึกผล</dt><dd><strong>{bookingsReady ? formatMoney(upcomingEarned) : "—"}</strong><small>{confirmedBookings.length} การจอง</small></dd></div>
              <div><dt>ช่วงเวลาที่เปิดรับจอง</dt><dd><strong>{slots.filter((slot) => slot.state === "available").length}</strong><small>จาก {slots.length} ช่วงเวลา</small></dd></div>
            </dl>
            <p className="profile-group__hint">ตัวเลขคิดจากค่าฝึกที่บันทึกไว้ในแต่ละการจอง และนับเป็นรายได้เฉพาะการจองที่สมาชิกชำระเงินสำเร็จแล้ว ยอดที่เข้าบัญชีจริงหักค่าธรรมเนียมแพลตฟอร์มและค่าธรรมเนียม Stripe แล้ว ดูได้ใน Stripe Dashboard</p>
          </section>

          {/* The statistics panel answers two questions — how busy the year is
              month by month, and what it earned — and adds the gym salary
              summary whenever the API reports one. */}
          <section className="trainer-finance profile-group" aria-labelledby="trainer-stats-title">
            <header className="section-line-heading">
              <div>
                <h2 id="trainer-stats-title">สถิติ</h2>
                <p>จำนวนการจองและรายได้ของคุณ</p>
              </div>
              <div className="trainer-week-strip__controls" aria-label="เลือกปีของสถิติ">
                <button type="button" aria-label="ปีก่อนหน้า" onClick={() => setStatsYear((year) => year - 1)}><ChevronLeft aria-hidden="true" size={18} /></button>
                <button type="button" onClick={() => setStatsYear(now.getFullYear())} disabled={statsYear === now.getFullYear()}>ปีนี้</button>
                <button type="button" aria-label="ปีถัดไป" disabled={statsYear >= now.getFullYear()} onClick={() => setStatsYear((year) => year + 1)}><ChevronRight aria-hidden="true" size={18} /></button>
              </div>
            </header>
            <div className="profile-tabs trainer-segment" role="group" aria-label="มุมมองสถิติ">
              <button type="button" aria-pressed={statsMode === "monthly"} onClick={() => setStatsMode("monthly")}>รายเดือน</button>
              <button type="button" aria-pressed={statsMode === "yearly"} onClick={() => setStatsMode("yearly")}>รายปี</button>
            </div>
            <p className="booking-next-step">ปี พ.ศ. {statsYear + 543}</p>
            {statsLoading && <p className="queue-loading" aria-live="polite">กำลังโหลดสถิติ…</p>}
            {statsError && (
              <div className="workbench-error" role="alert">
                <span>{statsError}</span>
                <button type="button" disabled={statsLoading} onClick={() => setStatsReload((key) => key + 1)}>
                  <RefreshCw aria-hidden="true" size={15} /> {statsLoading ? "กำลังโหลด…" : "ลองใหม่"}
                </button>
              </div>
            )}
            {!statsLoading && !statsError && !stats && (
              <div className="empty-state"><strong>ยังไม่มีข้อมูลสถิติสำหรับปีนี้</strong><p>ข้อมูลจะปรากฏหลังคุณรับงานในปีนี้</p></div>
            )}
            {!statsLoading && !statsError && stats && (
              <>
                <dl className="trainer-money-cards trainer-money-cards--two">
                  <div><dt>การจองทั้งหมดในปี</dt><dd><strong>{statsYearTotal.bookings}</strong><small>การจอง</small></dd></div>
                  <div><dt>รายได้รวมทั้งปี</dt><dd><strong>{formatMoney(statsYearTotal.income)}</strong><small>พ.ศ. {statsYear + 543}</small></dd></div>
                </dl>
                {statsMode === "monthly" ? (
                  statsMonths.length > 0 ? (
                    <table className="trainer-stats-table w-full text-sm">
                      <caption className="sr-only">จำนวนการจองและรายได้รายเดือน</caption>
                      <thead>
                        <tr><th scope="col">เดือน</th><th scope="col">จำนวนการจอง</th><th scope="col">รายได้</th></tr>
                      </thead>
                      <tbody>
                        {statsMonths.map((line) => (
                          <tr key={line.label}>
                            <th scope="row">{line.label}</th>
                            <td>{line.bookings} การจอง</td>
                            <td>{formatMoney(line.income)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="profile-group__hint">ยังไม่มีการจองในปีนี้</p>
                  )
                ) : (
                  <table className="trainer-stats-table w-full text-sm">
                    <caption className="sr-only">จำนวนการจองและรายได้รายปี</caption>
                    <thead>
                      <tr><th scope="col">ปี</th><th scope="col">จำนวนการจอง</th><th scope="col">รายได้</th></tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">พ.ศ. {statsYear + 543}</th>
                        <td>{statsYearTotal.bookings} การจอง</td>
                        <td>{formatMoney(statsYearTotal.income)}</td>
                      </tr>
                    </tbody>
                  </table>
                )}
                {statsSalary.length > 0 && (
                  <div className="profile-group">
                    <h3>สรุปเงินเดือนรายเดือน</h3>
                    <table className="trainer-stats-table w-full text-sm">
                      <caption className="sr-only">สรุปเงินเดือนรายเดือนของเทรนเนอร์ประจำยิม</caption>
                      <thead>
                        <tr><th scope="col">เดือน</th><th scope="col">จำนวนครั้ง</th><th scope="col">จำนวนเงิน</th></tr>
                      </thead>
                      <tbody>
                        {statsSalary.map((line) => (
                          <tr key={line.month}>
                            <th scope="row">{monthLabel(line.month)}</th>
                            <td>{line.sessions} ครั้ง</td>
                            <td>{formatMoney(line.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}

      <Dialog open={selectedBooking !== null} onOpenChange={(open) => { if (!open) setSelectedBooking(null); }}>
        <DialogContent
          className="trainer-appointment-dialog"
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader><DialogTitle>รายละเอียดนัดหมาย</DialogTitle><DialogDescription>ข้อมูลสมาชิกและการฝึกในรายการจองนี้</DialogDescription></DialogHeader>
          {selectedBooking && (
            [bookings.find((booking) => booking.id === selectedBooking.id) ?? selectedBooking].map(renderConfirmedBooking)
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={slotToDelete !== null} onOpenChange={(open) => {
        if (busy?.startsWith("slot-")) return;
        if (!open) setSlotToDelete(null);
      }}>
        <DialogContent onCloseAutoFocus={restoreFocus}>
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
        <DialogContent onCloseAutoFocus={restoreFocus}>
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

      {/* Accepting names one confirmed period, so the choice and its exact
          resulting time share one dialog before anything is sent. */}
      <Dialog open={bookingToAccept !== null} onOpenChange={(open) => {
        if (busy?.startsWith("booking-")) return;
        if (!open) setBookingToAccept(null);
      }}>
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>ตอบรับคำขอจอง</DialogTitle>
            <DialogDescription className="grid gap-1">
              <span>{bookingToAccept?.member?.displayName ?? "สมาชิก FitConnect"} · คำขอ {bookingToAccept?.id}</span>
              <span>เวลาฝึกเป็นเวลาที่สมาชิกขอ เมื่อยืนยัน ระบบแจ้งสมาชิกทันทีและสมาชิกมีเวลา 10 นาทีสำหรับชำระเงิน</span>
            </DialogDescription>
          </DialogHeader>
          {bookingToAccept && (
            <div className="confirm-time-picker">
              <p className="confirm-time-picker__requested">
                <span>เวลาฝึก (ไม่เปลี่ยน)</span>
                <strong>{requestedPeriodLabel(bookingToAccept)}</strong>
              </p>
              {acceptanceTooLate(requestedStart(bookingToAccept)) && (
                <p className="row-error" role="alert">ใกล้เวลาฝึกเกินไป สมาชิกจะชำระเงินไม่ทัน</p>
              )}
            </div>
          )}
          {decisionError && <p className="row-error" role="alert">{decisionError}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy?.startsWith("booking-"))}>กลับไป</Button></DialogClose>
            <Button
              className="button button--accent"
              type="button"
              disabled={!bookingToAccept || busy === `booking-${bookingToAccept.id}` || acceptanceTooLate(requestedStart(bookingToAccept))}
              onClick={() => acceptBooking()}
            >
              {busy === `booking-${bookingToAccept?.id}` ? "กำลังบันทึก…" : "ยืนยันตอบรับ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rejecting and cancelling share one dialog: both end the booking and
          both owe the other side a reason they can read. */}
      <Dialog open={bookingToDecide !== null} onOpenChange={(open) => {
        if (busy?.startsWith("booking-")) return;
        if (!open) {
          setBookingToDecide(null);
          setDecisionReasonError("");
        }
      }}>
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>{decisionCopy[decisionKind].title}</DialogTitle>
            <DialogDescription className="grid gap-1">
              <span>{bookingToDecide?.member?.displayName ?? "สมาชิก FitConnect"} · คำขอ {bookingToDecide?.id}</span>
              <span>ช่วงเวลาจะถูกคืนให้สมาชิกทันที</span>
              <span>สมาชิกจะเห็นเหตุผลที่คุณ{decisionCopy[decisionKind].verb}</span>
            </DialogDescription>
          </DialogHeader>
          <label className="field" htmlFor="decision-reason">
            เหตุผลที่{decisionCopy[decisionKind].verb} (จำเป็น)
            <textarea
              id="decision-reason"
              value={decisionReason}
              disabled={Boolean(busy?.startsWith("booking-"))}
              aria-invalid={Boolean(decisionReasonError)}
              onChange={(event) => {
                setDecisionReason(event.target.value);
                setDecisionReasonError("");
              }}
            />
          </label>
          {decisionReasonError && <p className="field-error" role="alert">{decisionReasonError}</p>}
          {decisionError && <p className="row-error" role="alert">{decisionError}</p>}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy?.startsWith("booking-"))}>กลับไป</Button></DialogClose>
            <Button
              className="button button--danger"
              type="button"
              disabled={!bookingToDecide || busy === `booking-${bookingToDecide.id}`}
              onClick={() => submitReasonDecision()}
            >
              {busy === `booking-${bookingToDecide?.id}`
                ? "กำลังบันทึก…"
                : decisionCopy[decisionKind].confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editing a slot's start time is confirmed in its own dialog: the old
          and the new time both stay on screen before the request is sent. */}
      <Dialog open={slotToEdit !== null} onOpenChange={(open) => {
        if (busy?.startsWith("slot-")) return;
        if (!open) setSlotToEdit(null);
      }}>
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>แก้ไขช่วงเวลาว่าง</DialogTitle>
            <DialogDescription className="grid gap-1">
              <span>เวลาเดิม {slotToEdit ? formatDateTime(slotToEdit.startsAt) : ""}</span>
              <span>เลือกเวลาเริ่มต้นใหม่ ระบบกำหนดเวลาสิ้นสุดให้อีก 1 ชั่วโมงเท่าเดิม</span>
            </DialogDescription>
          </DialogHeader>
          <div className="form-grid">
            <label className="field">วันที่<input type="date" lang="th-TH" value={editDate} disabled={busy === `slot-${slotToEdit?.id}`} onChange={(event) => setEditDate(event.target.value)} /></label>
            <label className="field">เวลาเริ่มต้นใหม่<input type="time" value={editTime} disabled={busy === `slot-${slotToEdit?.id}`} onChange={(event) => setEditTime(event.target.value)} /></label>
          </div>
          {editDate && editTime && !Number.isNaN(new Date(`${editDate}T${editTime}`).getTime()) && (
            <p className="booking-next-step">
              เวลาใหม่ {formatDateTime(new Date(`${editDate}T${editTime}`).toISOString())} – {formatTime(new Date(new Date(`${editDate}T${editTime}`).getTime() + 60 * 60 * 1000).toISOString())} น.
            </p>
          )}
          {editError && <p className="row-error" role="alert">{editError}</p>}
          <DialogFooter className="trainer-slot-edit__footer">
            <Button
              className="trainer-slot-edit__delete"
              type="button"
              variant="outline"
              disabled={!slotToEdit || Boolean(busy?.startsWith("slot-"))}
              onClick={() => {
                if (!slotToEdit) return;
                setAvailabilityError("");
                setSlotToDelete(slotToEdit);
                setSlotToEdit(null);
              }}
            >
              <Trash2 aria-hidden="true" size={16} /> ลบช่วงเวลานี้
            </Button>
            <DialogClose asChild><Button type="button" variant="outline" disabled={Boolean(busy?.startsWith("slot-"))}>กลับไป</Button></DialogClose>
            <Button
              className="button button--accent"
              type="button"
              disabled={!slotToEdit || !editDate || !editTime || busy === `slot-${slotToEdit.id}`}
              onClick={() => void saveSlotEdit()}
            >
              {busy === `slot-${slotToEdit?.id}` ? "กำลังบันทึก…" : "ยืนยันแก้ไขเวลา"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
