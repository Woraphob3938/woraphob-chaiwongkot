"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CalendarCheck2, CalendarDays, ClipboardList, ExternalLink, Inbox, ReceiptText, RefreshCw, Star, Trash2, UsersRound, Wallet } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import {
  AppointmentRow, BookingDetail, RequestCard, decisionCopy, isPendingTrainer, needsTrainer, requestedPeriodLabel,
  requestedStart, type DecisionKind, type Trigger,
} from "@/components/trainer-booking-cards";
import { TrainerFinanceTab } from "@/components/trainer-finance-tab";
import { TrainerMembersPanel, TrainerReviewsPanel } from "@/components/trainer-members-panel";
import { heroDateFormatter, localDateKey } from "@/components/trainer-schedule";
import { AddSlotDialog } from "@/components/trainer-slot-dialog";
import { TrainerWeekCalendar } from "@/components/trainer-week-calendar";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { authenticatedRequest } from "@/lib/api";
import { getTrainerNextAction, hasValidBookingPeriod } from "@/lib/dashboard-actions";
import { acceptanceTooLate, formatDateTime, formatTime } from "@/lib/format";
import { leaveExpiredSession } from "@/lib/session";
import type { Booking, TrainerAvailabilitySlot, TrainerWorkspace } from "@/lib/types";

type TrainerTab = "work" | "members" | "reviews" | "finance";
const TRAINER_TABS: TrainerTab[] = ["work", "members", "reviews", "finance"];
const tabCopy = {
  work: { label: "งานและตาราง", Icon: ClipboardList },
  members: { label: "สมาชิก", Icon: UsersRound },
  reviews: { label: "รีวิว", Icon: Star },
  finance: { label: "การเงิน", Icon: Wallet },
};
/** How many appointments the trainer sees before asking for the next page. */
const APPOINTMENTS_PER_PAGE = 4;
const REQUESTS_PER_PAGE = 2;
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
  // Each opening of the add-slot dialog gets a new id, so it starts from the day it was opened with.
  const [slotDialog, setSlotDialog] = useState<{ id: number; open: boolean; day?: Date; hour?: number }>({ id: 0, open: false });
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

  function openSlotDialog(trigger: HTMLElement, day?: Date, hour?: number) {
    setDialogTrigger(trigger);
    setAvailabilityError("");
    setSlotDialog({ id: slotDialog.id + 1, open: true, day, hour });
  }

  function openBookingDetails(booking: Booking, event: Trigger) {
    rememberDialogTrigger(event);
    setSelectedBooking(booking);
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

  // The dialog shows the freshest copy of the booking it was opened for.
  const detailBooking = selectedBooking && (bookings.find((booking) => booking.id === selectedBooking.id) ?? selectedBooking);

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
          {visibleRequests.map((booking) => (
            <RequestCard
              key={`request-${booking.id}`}
              booking={booking}
              isBusy={busy === `booking-${booking.id}`}
              onAccept={(event) => { rememberDialogTrigger(event); setBookingToAccept(booking); }}
              onDecide={(kind, event) => openDecisionDialog(booking, kind, event)}
              onDetails={(event) => openBookingDetails(booking, event)}
            />
          ))}
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
        <TrainerWeekCalendar
          active={activeTab === "work"}
          slots={slots}
          confirmedBookings={confirmedBookings}
          decisionBookings={decisionBookings}
          busy={busy}
          error={slotToDelete ? "" : availabilityError}
          now={now}
          maxDate={maxDate}
          onAddSlot={openSlotDialog}
          onEditSlot={(slot, event) => { rememberDialogTrigger(event); openSlotEdit(slot); }}
          onOpenBooking={openBookingDetails}
        />
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
          {visibleAppointments.map((booking) => (
            <AppointmentRow
              key={booking.id}
              booking={booking}
              session={nextSession(booking)}
              isBusy={busy === `booking-${booking.id}`}
              onComplete={(event) => { rememberDialogTrigger(event); setBookingToComplete(booking); }}
              onDetails={(event) => openBookingDetails(booking, event)}
            />
          ))}
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

      <AddSlotDialog
        key={slotDialog.id}
        open={slotDialog.open}
        day={slotDialog.day}
        hour={slotDialog.hour}
        slots={slots}
        now={now}
        maxDate={maxDate}
        reload={loadWorkspace}
        onClose={() => setSlotDialog({ ...slotDialog, open: false })}
        onNotice={setActionNotice}
        onCloseAutoFocus={restoreFocus}
      />

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
          <TrainerFinanceTab active={activeTab === "finance"} bookings={bookings} bookingsReady={bookingsReady} slots={slots} />
        </div>
      )}

      <Dialog open={selectedBooking !== null} onOpenChange={(open) => { if (!open) setSelectedBooking(null); }}>
        <DialogContent
          className="trainer-appointment-dialog"
          onCloseAutoFocus={restoreFocus}
        >
          <DialogHeader><DialogTitle>รายละเอียดนัดหมาย</DialogTitle><DialogDescription>ข้อมูลสมาชิกและการฝึกในรายการจองนี้</DialogDescription></DialogHeader>
          {detailBooking && (
            <BookingDetail
              booking={detailBooking}
              isBusy={busy === `booking-${detailBooking.id}`}
              onCancel={(event) => openDecisionDialog(detailBooking, "cancel", event)}
              onComplete={() => setBookingToComplete(detailBooking)}
            />
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
