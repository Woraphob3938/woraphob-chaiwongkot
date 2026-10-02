"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  MessageSquareText,
  RefreshCw,
  Search,
} from "lucide-react";
import { AdminOperations } from "@/components/admin-operations";
import { DashboardSection, NextActionCard } from "@/components/dashboard-primitives";
import { DisclosureSection } from "@/components/disclosure-section";
import { BookingProgress, bookingStepIndex } from "@/components/booking-progress";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentPanel } from "@/components/payment-panel";
import { MonthlySessionScheduler } from "@/components/monthly-session-scheduler";
import { PaymentDeadline } from "@/components/payment-deadline";
import { ReviewForm } from "@/components/review-form";
import { StatusBadge } from "@/components/status-badge";
import { TrainerWorkbench } from "@/components/trainer-workbench";
import { authenticatedRequest } from "@/lib/api";
import { getMemberNextAction } from "@/lib/dashboard-actions";
import { formatDateTime, formatTime } from "@/lib/format";
import { formatAmount, paymentStatusCopy } from "@/lib/payment-copy";
import type { Booking, UserRole } from "@/lib/types";

const roleCopy = {
  member: { index: "สมาชิก", title: "การจองของฉัน", lead: "ติดตามคำขอ นัดหมาย การชำระ และการสนทนาได้จากสถานะเดียวกัน" },
  trainer: { index: "เทรนเนอร์", title: "โต๊ะทำงานเทรนเนอร์", lead: "จัดการคุณสมบัติ ตารางว่าง และคำขอจองโดยไม่หลุดจากบริบท" },
  admin: { index: "ผู้ดูแลระบบ", title: "พื้นที่ผู้ดูแลระบบ", lead: "จัดการบัญชี ตรวจเทรนเนอร์ ติดตามการจอง การชำระเงิน และสิทธิ์ของผู้ดูแลระบบ" },
};

const paymentCopy = paymentStatusCopy;

// The trainer-decision fields arrive in lib/types.ts in parallel with this
// surface, so they are read through one narrow view that works before and
// after that change instead of editing the shared file here.
type BookingDecisionView = {
  status: string;
  confirmedStartsAt?: string | null;
  confirmedEndsAt?: string | null;
  cancellationReason?: string | null;
};

function decisionView(booking: Booking): BookingDecisionView {
  return booking as unknown as BookingDecisionView;
}

function isPendingTrainer(booking: { status: string }) {
  return booking.status === "pending_trainer";
}

/** "ช่วงเวลาที่ยืนยัน" as one readable range, or null before the trainer answered. */
function confirmedPeriodLabel(booking: Booking): string | null {
  const view = decisionView(booking);
  if (!view.confirmedStartsAt) return null;
  return `${formatDateTime(view.confirmedStartsAt)} – ${formatTime(view.confirmedEndsAt ?? view.confirmedStartsAt)} น.`;
}

function nextStepCopy(booking: Booking): string {
  if (booking.review) return "รีวิวนี้เผยแพร่แล้ว";
  if (isPendingTrainer(booking)) return "รอเทรนเนอร์ตอบรับ ระบบแจ้งคุณทันทีที่ตอบรับ แล้วจึงชำระเงินได้ เวลาฝึกยังเป็นเวลาที่คุณขอ";
  if (booking.actions.canPay) return "เทรนเนอร์ยืนยันเวลาแล้ว ชำระเงินออนไลน์ภายในเวลาที่เหลือ ระบบยืนยันการจองให้ทันทีเมื่อชำระสำเร็จ ถ้าหมดเวลา การจองจะหมดอายุ";
  if (booking.actions.canReview) return "เขียนรีวิวหลังการฝึก";
  if (booking.status === "payment_review") return "รายการชำระเงินเดิมรอตรวจสอบ";
  if (booking.status === "confirmed") return "เตรียมตัวตามวันและเวลานัด";
  if (booking.status === "cancelled") return "คำขอนี้สิ้นสุดแล้ว";
  if (booking.status === "expired") return "การจองหมดเวลา ช่วงเวลานี้ถูกคืนแล้ว";
  return "ยังไม่มีขั้นตอนที่ต้องทำในขณะนี้";
}

type CheckoutOutcome = "paid" | "pending" | "cancelled" | "error";
type CheckoutReturn = { bookingId: string; kind: "success" | "cancelled" };
type CheckoutNotice = { bookingId: string; outcome: CheckoutOutcome };

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

/**
 * Asks the API to settle the Checkout Session the member came back from.
 * A PromptPay payment can still be arriving when the member lands, so an
 * open session is asked again a few times before reporting "pending".
 */
async function settleCheckout(bookingId: string): Promise<CheckoutOutcome> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await authenticatedRequest<{ outcome: "paid" | "open" | "closed" }>("/v1/payments/confirm", {
        method: "POST",
        body: JSON.stringify({ bookingId }),
      });
      if (result?.outcome === "paid") return "paid";
      if (result?.outcome === "closed") return "cancelled";
    } catch {
      if (attempt === 4) return "error";
    }
    await wait(2_000);
  }
  return "pending";
}

type BookingFilter = "active" | "completed" | "closed" | "all";
const bookingsPerPage = 10;

/** Still moving: waiting on someone, paid and upcoming, or owed a review. */
function isActiveBooking(booking: Booking) {
  return ["pending_trainer", "awaiting_payment", "payment_review", "confirmed"].includes(booking.status)
    || (booking.status === "completed" && booking.actions.canReview);
}

// Four groups instead of seven statuses: what still needs attention, what was
// trained, what ended without training, and everything.
const bookingFilters: { id: BookingFilter; label: string; match: (booking: Booking) => boolean }[] = [
  { id: "active", label: "กำลังดำเนินการ", match: isActiveBooking },
  { id: "completed", label: "ฝึกเสร็จแล้ว", match: (booking) => booking.status === "completed" && !booking.actions.canReview },
  { id: "closed", label: "ยกเลิก/หมดเวลา", match: (booking) => booking.status === "cancelled" || booking.status === "expired" },
  { id: "all", label: "ทั้งหมด", match: () => true },
];

function appointmentTime(booking: Booking) {
  return new Date(booking.confirmedStartsAt ?? booking.startsAt).getTime();
}

/** One short line on the row: what happens next, without opening the booking. */
function rowHint(booking: Booking): string {
  if (isPendingTrainer(booking)) return "รอเทรนเนอร์ตอบรับ";
  if (booking.actions.canPay) return "ชำระเงินภายในเวลาที่เหลือ";
  if (booking.status === "payment_review") return "รอตรวจสอบการชำระ";
  if (booking.actions.canReview) return "เขียนรีวิวได้แล้ว";
  if (booking.status === "confirmed") return "นัดยืนยันแล้ว";
  return "";
}

/**
 * The card, the row and the dialog show the same clock; a single page-level
 * timeout reloads once when the window closes, so three countdowns reaching
 * zero together do not send three requests.
 */
function ignoreExpiry() {}

function bookingIdFromActionHref(href: string): string | null {
  const marker = "#booking-";
  const markerIndex = href.indexOf(marker);
  return markerIndex === -1 ? null : href.slice(markerIndex + marker.length);
}

function bookingIdFromHash(hash: string): string | null {
  return hash.startsWith("#booking-") ? hash.slice("#booking-".length) : null;
}

function BookingCancellationAction({
  booking,
  onUpdated,
}: {
  booking: Booking;
  onUpdated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const reasonId = `cancel-reason-${booking.id}`;

  async function cancelBooking() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const trimmed = reason.trim();
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(booking.id)}/cancel`, {
        method: "POST",
        body: JSON.stringify(trimmed ? { reason: trimmed } : {}),
      });
      setOpen(false);
      await onUpdated();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "ยกเลิกการจองไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (busy) return;
      setOpen(nextOpen);
      if (nextOpen) {
        setError("");
        setReason("");
      }
    }}>
      <DialogTrigger asChild>
        <button className="button button--danger" type="button">
          <CalendarX2 aria-hidden="true" /> ยกเลิกการจอง
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยกเลิกการจองนี้?</DialogTitle>
          <DialogDescription className="grid gap-1">
            <span>ช่วงเวลาจะถูกคืนให้สมาชิกคนอื่นทันที</span>
            <span>คำสั่งนี้ใช้ได้ก่อนส่งหลักฐานการชำระเงินเท่านั้น</span>
          </DialogDescription>
        </DialogHeader>
        <label className="field" htmlFor={reasonId}>
          <span>เหตุผลการยกเลิก <small>(ไม่บังคับ เทรนเนอร์จะเห็นข้อความนี้)</small></span>
          <textarea
            id={reasonId}
            value={reason}
            maxLength={500}
            rows={3}
            placeholder="เช่น ติดธุระในวันนัด"
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <button className="button" type="button" disabled={busy}>กลับไป</button>
          </DialogClose>
          <button className="button button--danger" type="button" disabled={busy} onClick={() => void cancelBooking()}>
            {busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิกการจอง"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RoleDashboard({
  role,
  navigate,
}: {
  role: UserRole;
  navigate?: (href: string) => void;
}) {
  const router = useRouter();
  const goTo = navigate ?? router.push;
  const copy = roleCopy[role];
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingError, setBookingError] = useState("");
  const [loadingBookings, setLoadingBookings] = useState(role === "member");
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("active");
  const [bookingQuery, setBookingQuery] = useState("");
  const [bookingPage, setBookingPage] = useState(0);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  // Read once: Strict Mode runs the load effect twice, and the first run
  // removes ?checkout from the address bar.
  const checkoutReturnRef = useRef<CheckoutReturn | null | undefined>(undefined);
  const [checkoutNotice, setCheckoutNotice] = useState<CheckoutNotice | null>(null);
  const [checkoutSettling, setCheckoutSettling] = useState(false);
  const checkoutNoticeRef = useRef<HTMLDivElement>(null);
  // Captured once so sorting stays pure across renders (react-hooks/purity).
  const [listNow] = useState(() => Date.now());

  const loadMemberBookings = useCallback(async () => {
    if (role !== "member") return;
    const token = localStorage.getItem("fitconnect_token");
    if (!token) {
      setLoadingBookings(false);
      return;
    }
    try {
      const items = await authenticatedRequest<Booking[]>("/v1/bookings");
      setBookings(items);
      setBookingError("");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "โหลดรายการจองไม่สำเร็จ");
    } finally {
      setLoadingBookings(false);
    }
  }, [role]);

  useEffect(() => {
    if (role !== "member") return;
    const token = localStorage.getItem("fitconnect_token");
    if (!token) {
      queueMicrotask(() => setLoadingBookings(false));
      return;
    }
    let cancelled = false;
    // Back from Stripe Checkout: settle the payment with the API before the
    // list loads, so a paid booking already shows as confirmed. The webhook
    // does the same on a deployed server; either one is enough.
    if (checkoutReturnRef.current === undefined) {
      const params = new URLSearchParams(window.location.search);
      const kind = params.get("checkout");
      const bookingId = params.get("booking");
      checkoutReturnRef.current = bookingId && (kind === "success" || kind === "cancelled") ? { bookingId, kind } : null;
      if (params.has("checkout")) {
        params.delete("checkout");
        const query = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      }
    }
    const checkoutReturn = checkoutReturnRef.current;
    if (checkoutReturn?.kind === "success") queueMicrotask(() => setCheckoutSettling(true));
    const settled: Promise<CheckoutOutcome | null> = checkoutReturn?.kind === "success"
      ? settleCheckout(checkoutReturn.bookingId)
      : Promise.resolve(checkoutReturn ? "cancelled" : null);
    void settled
      .then((outcome) => {
        if (cancelled || !checkoutReturn || !outcome) return;
        setCheckoutSettling(false);
        setCheckoutNotice({ bookingId: checkoutReturn.bookingId, outcome });
      })
      .then(() => authenticatedRequest<Booking[]>("/v1/bookings"))
      .then((items) => {
        if (cancelled) return;
        setBookings(items);
        setBookingError("");
      })
      .catch((error: unknown) => {
        if (!cancelled) setBookingError(error instanceof Error ? error.message : "โหลดรายการจองไม่สำเร็จ");
      })
      .finally(() => {
        if (!cancelled) setLoadingBookings(false);
      });
    return () => { cancelled = true; };
  }, [role]);

  useEffect(() => {
    if (checkoutNotice) checkoutNoticeRef.current?.focus();
  }, [checkoutNotice]);

  async function recheckCheckout(bookingId: string) {
    setCheckoutSettling(true);
    const outcome = await settleCheckout(bookingId);
    setCheckoutSettling(false);
    setCheckoutNotice({ bookingId, outcome });
    await loadMemberBookings();
  }

  useEffect(() => {
    if (role !== "member") return;
    const refreshWhenMemberReturns = () => void loadMemberBookings();
    window.addEventListener("focus", refreshWhenMemberReturns);
    return () => window.removeEventListener("focus", refreshWhenMemberReturns);
  }, [loadMemberBookings, role]);

  // One reload when the earliest open payment window closes, whatever is on
  // screen. The visible countdowns only display; they never fetch.
  const nextPaymentDeadline = bookings
    .filter((booking) => booking.actions.canPay && booking.status !== "pending_trainer" && booking.paymentDeadlineAt)
    .map((booking) => Date.parse(booking.paymentDeadlineAt as string))
    .filter((time) => Number.isFinite(time))
    .sort((left, right) => left - right)[0];
  useEffect(() => {
    if (role !== "member" || nextPaymentDeadline === undefined) return;
    const timer = window.setTimeout(() => void loadMemberBookings(), Math.max(0, nextPaymentDeadline - Date.now()) + 500);
    return () => window.clearTimeout(timer);
  }, [loadMemberBookings, nextPaymentDeadline, role]);

  useEffect(() => {
    if (role !== "member") return;
    const revealTargetedBooking = () => {
      const hashId = bookingIdFromHash(window.location.hash);
      const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
      const queryId = searchParams?.get("booking") ?? null;
      const targetId = hashId || queryId;
      if (targetId) {
        setBookingFilter("all");
        setSelectedBookingId(targetId);
      }
    };
    revealTargetedBooking();
    window.addEventListener("hashchange", revealTargetedBooking);
    return () => window.removeEventListener("hashchange", revealTargetedBooking);
  }, [role]);

  const renderBookingFactsAndActions = (booking: Booking) => {
    const sessions = booking.sessions ?? [];
    const showSessions = booking.bookingType === "monthly" && sessions.length > 0;
    const confirmedLabel = confirmedPeriodLabel(booking);
    const cancellationReason = decisionView(booking).cancellationReason;

    return (
      <>
        {/* The clock leads and stays pinned while the member scrolls to the
            payment button: it is the one fact that decides the booking. */}
        {booking.actions.canPay && !isPendingTrainer(booking) && booking.paymentDeadlineAt && (
          <div className="payment-deadline-row">
            <span>เวลาที่เหลือสำหรับชำระเงิน</span>
            <PaymentDeadline deadlineAt={booking.paymentDeadlineAt} onExpired={ignoreExpiry} />
          </div>
        )}
        {bookingStepIndex(booking) >= 0 && (
          <BookingProgress current={bookingStepIndex(booking)} className="booking-progress--compact" />
        )}
        <p className="booking-next-step">{nextStepCopy(booking)}</p>
        {/* Once the trainer has answered, the confirmed period is what both
            sides keep, so it leads the facts even when it moved. */}
        {confirmedLabel && (
          <div className="ledger-row booking-confirmed-time"><span>ช่วงเวลาที่ยืนยัน</span><strong>{confirmedLabel}</strong></div>
        )}
        {/* When money is owed the job leads: the QR and the slip upload come
            first, and the facts a member already knows move below them. */}
        {/* Nothing about money appears while the request still waits for the
            trainer: the payment clock does not run yet. */}
        {booking.actions.canPay && !isPendingTrainer(booking) && <PaymentPanel booking={booking} onUpdated={loadMemberBookings} />}
        {showSessions && (
          <div className="monthly-booking-sessions">
            <strong>แพ็กเกจ 30 วัน · {booking.sessionCount ?? sessions.length} ครั้ง</strong>
            <ol>
              {sessions.map((session) => (
                <li key={`${session.id}-${session.startsAt}`}>{formatDateTime(session.startsAt)}</li>
              ))}
            </ol>
          </div>
        )}
        {/* The requested time is only worth a second row when the confirmed
            one differs from it. */}
        {!showSessions && (!confirmedLabel || decisionView(booking).confirmedStartsAt !== booking.startsAt) && (
          <div className="ledger-row"><span>{isPendingTrainer(booking) ? "เวลาที่ขอ" : confirmedLabel ? "เวลาที่ขอไว้" : "เวลาฝึก"}</span><strong>{formatDateTime(booking.startsAt)}</strong></div>
        )}
        {cancellationReason && (
          <div className="ledger-row"><span>เหตุผลที่ยกเลิก</span><strong>{cancellationReason}</strong></div>
        )}
        <div className="ledger-row"><span>{booking.bookingType === "monthly" ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง"}</span><strong>{formatAmount(booking.quotedPrice)}</strong></div>
        <div className="ledger-row"><span>การชำระ</span><strong>{paymentCopy[booking.paymentStatus]}</strong></div>
        {booking.payment && (
          <div className="ledger-row"><span>ยอดที่โอน</span><strong>{formatAmount(booking.payment.amount)}</strong></div>
        )}
        {booking.payment?.status === "rejected" && booking.payment.reviewNote && (
          <div className="ledger-row"><span>หมายเหตุจากเทรนเนอร์</span><strong>{booking.payment.reviewNote}</strong></div>
        )}
        {booking.actions.canScheduleSession && <MonthlySessionScheduler booking={booking} onUpdated={loadMemberBookings} />}
        {booking.actions.canReview && (
          <DisclosureSection
            className="booking-review-disclosure"
            title="เขียนรีวิว"
            summary="ให้คะแนนและแสดงความคิดเห็นหลังการฝึก"
          >
            <ReviewForm booking={booking} onUpdated={loadMemberBookings} />
          </DisclosureSection>
        )}
        {booking.review && (
          <div className="ledger-row">
            <span>รีวิวที่เผยแพร่</span>
            <strong>{booking.review.rating} จาก 5 ดาว: {booking.review.comment}</strong>
          </div>
        )}
        <div className="ledger-actions">
          {booking.actions.canCancel && (
            <BookingCancellationAction booking={booking} onUpdated={loadMemberBookings} />
          )}
          {booking.actions.canReadChat && (
            <Link href={`/chat?booking=${encodeURIComponent(booking.id)}`}><MessageSquareText aria-hidden="true" size={17} /> เปิดการสนทนา</Link>
          )}
          <Link href={`/trainers/${booking.trainer.slug}`}>ดูโปรไฟล์ <ArrowRight aria-hidden="true" size={16} /></Link>
        </div>
      </>
    );
  };

  const renderBookingSummary = (booking: Booking, isNext: boolean) => (
    <button
      type="button"
      className={isNext ? "member-booking-summary is-next" : "member-booking-summary"}
      data-testid="booking-summary"
      id={`booking-${booking.id}`}
      key={booking.id}
      aria-haspopup="dialog"
      onClick={() => setSelectedBookingId(booking.id)}
    >
      <span className="member-booking-summary__identity">
        <strong>{booking.trainer.displayName}</strong>
        <span className="member-booking-summary__appointment">{formatDateTime(booking.confirmedStartsAt ?? booking.startsAt)}</span>
      </span>
      <span className="member-booking-summary__meta">
        <StatusBadge status={booking.status} />
        {booking.actions.canPay && !isPendingTrainer(booking) && booking.paymentDeadlineAt ? (
          <span className="member-booking-summary__hint is-urgent">
            <PaymentDeadline deadlineAt={booking.paymentDeadlineAt} onExpired={ignoreExpiry} />
          </span>
        ) : rowHint(booking) ? (
          <span className="member-booking-summary__hint">{rowHint(booking)}</span>
        ) : null}
      </span>
      <ChevronRight className="member-booking-summary__chevron" aria-hidden="true" size={18} />
      <span className="sr-only">ดูรายละเอียดคำขอ {booking.id}</span>
    </button>
  );

  const memberNextAction = getMemberNextAction(bookings);
  const actionBookingId = bookingIdFromActionHref(memberNextAction.href);
  const actionBooking = bookings.find((booking) => booking.id === actionBookingId);
  const availableFilters = bookingFilters.filter((filter) => filter.id === "all" || bookings.some(filter.match));
  const selectedFilter = availableFilters.some((filter) => filter.id === bookingFilter) ? bookingFilter : "all";
  const actionDeadline = actionBooking?.actions.canPay && !isPendingTrainer(actionBooking) ? actionBooking.paymentDeadlineAt : null;
  const normalizedQuery = bookingQuery.trim().toLocaleLowerCase("th");
  const filteredBookings = bookings.filter((booking) => {
    const selected = bookingFilters.find((filter) => filter.id === selectedFilter) ?? bookingFilters[0];
    const searchText = `${booking.trainer.displayName} ${booking.id}`.toLocaleLowerCase("th");
    return selected.match(booking) && (!normalizedQuery || searchText.includes(normalizedQuery));
  }).sort((left, right) => {
    if (selectedFilter !== "active") return appointmentTime(right) - appointmentTime(left);
    // Active work: upcoming sessions soonest first, then sessions already
    // past (owed a result or a review) most recent first.
    const leftUpcoming = appointmentTime(left) >= listNow;
    const rightUpcoming = appointmentTime(right) >= listNow;
    if (leftUpcoming !== rightUpcoming) return leftUpcoming ? -1 : 1;
    return leftUpcoming
      ? appointmentTime(left) - appointmentTime(right)
      : appointmentTime(right) - appointmentTime(left);
  });
  const rankedBookings = actionBooking && filteredBookings.some((booking) => booking.id === actionBooking.id)
    ? [actionBooking, ...filteredBookings.filter((booking) => booking.id !== actionBooking.id)]
    : filteredBookings;
  const pageCount = Math.max(1, Math.ceil(rankedBookings.length / bookingsPerPage));
  const currentPage = Math.min(bookingPage, pageCount - 1);
  const pageStart = currentPage * bookingsPerPage;
  const visibleBookings = rankedBookings.slice(pageStart, pageStart + bookingsPerPage);
  const selectedBooking = bookings.find((booking) => booking.id === selectedBookingId) ?? null;

  function selectBookingFilter(next: BookingFilter) {
    setBookingFilter(next);
    setBookingPage(0);
  }

  return (
    <main className={`page-shell dashboard-shell dashboard-shell--${role}`}>
      {role === "member"
        ? <h1 className="member-dashboard-title">{copy.title}</h1>
        : role === "trainer"
        ? <h1 className="sr-only">{copy.title}</h1>
        : <section className="dashboard-heading"><div><h1>{copy.title}</h1></div><p>{copy.lead}</p></section>}
      {role === "member" && (
        <div className="member-dashboard-content">
          {checkoutSettling && !checkoutNotice && (
            <div className="checkout-result checkout-result--pending" role="status">
              <Clock3 aria-hidden="true" size={22} />
              <div><strong>กำลังยืนยันการชำระเงิน…</strong><p>รอสักครู่ ระบบกำลังตรวจผลจาก Stripe</p></div>
            </div>
          )}
          {checkoutNotice && (
            <div
              ref={checkoutNoticeRef}
              className={`checkout-result checkout-result--${checkoutNotice.outcome}`}
              role={checkoutNotice.outcome === "error" ? "alert" : "status"}
              tabIndex={-1}
            >
              {checkoutNotice.outcome === "paid"
                ? <CircleCheck aria-hidden="true" size={22} />
                : checkoutNotice.outcome === "pending"
                  ? <Clock3 aria-hidden="true" size={22} />
                  : <CircleAlert aria-hidden="true" size={22} />}
              <div>
                <strong>{{
                  paid: "ชำระเงินสำเร็จ การจองยืนยันแล้ว",
                  pending: "ยังรอผลการชำระเงิน",
                  cancelled: "ยังไม่ได้ชำระเงิน",
                  error: "ยังยืนยันผลการชำระเงินไม่ได้",
                }[checkoutNotice.outcome]}</strong>
                <p>{{
                  paid: `การจอง ${checkoutNotice.bookingId} พร้อมแล้ว ดูวันเวลานัดและแชทกับเทรนเนอร์ได้ในรายการด้านล่าง`,
                  pending: `ถ้าชำระด้วยพร้อมเพย์ ยอดอาจใช้เวลาสักครู่ กดตรวจสอบอีกครั้งได้ การจอง ${checkoutNotice.bookingId} จะยืนยันเองเมื่อได้รับเงิน`,
                  cancelled: `คุณออกจากหน้าชำระเงินก่อนชำระเสร็จ ยังกดชำระการจอง ${checkoutNotice.bookingId} ได้ภายในเวลาที่เหลือ`,
                  error: `เชื่อมต่อระบบไม่สำเร็จ ถ้าชำระไปแล้ว ไม่ต้องจ่ายซ้ำ กดตรวจสอบอีกครั้งได้`,
                }[checkoutNotice.outcome]}</p>
                <div className="checkout-result__actions">
                  {(checkoutNotice.outcome === "pending" || checkoutNotice.outcome === "error") && (
                    <button className="button" type="button" disabled={checkoutSettling} onClick={() => void recheckCheckout(checkoutNotice.bookingId)}>
                      <RefreshCw aria-hidden="true" size={15} /> {checkoutSettling ? "กำลังตรวจสอบ…" : "ตรวจสอบอีกครั้ง"}
                    </button>
                  )}
                  <button className="button" type="button" onClick={() => setSelectedBookingId(checkoutNotice.bookingId)}>ดูการจองนี้</button>
                  <button className="button" type="button" onClick={() => setCheckoutNotice(null)}>ปิด</button>
                </div>
              </div>
            </div>
          )}
          {loadingBookings && bookings.length === 0 && (
            <section className="queue-loading" aria-live="polite">กำลังโหลดรายการจอง…</section>
          )}
          {bookingError && (
            <div className="workbench-error" role="alert">
              <span>{bookingError}</span>
              <button type="button" disabled={loadingBookings} onClick={() => {
                setLoadingBookings(true);
                void loadMemberBookings();
              }}>
                <RefreshCw aria-hidden="true" size={15} /> {loadingBookings ? "กำลังโหลด…" : "ลองใหม่"}
              </button>
            </div>
          )}
          {(!loadingBookings || bookings.length > 0) && (!bookingError || bookings.length > 0) && (
            <NextActionCard
              action={memberNextAction}
              // Next pushes the hash without a hashchange event, so the card
              // opens the booking it names itself.
              onFollow={actionBookingId ? () => {
                setBookingFilter("all");
                setSelectedBookingId(actionBookingId);
              } : undefined}
              detail={actionDeadline ? (
                <p className="next-action-card__deadline">
                  เหลือเวลา <PaymentDeadline deadlineAt={actionDeadline} onExpired={ignoreExpiry} />
                </p>
              ) : undefined}
            />
          )}
          {bookings.length > 0 && (
            <DashboardSection title="การจอง">
              <label className="member-booking-search">
                <span>ค้นหาการจอง</span>
                <span className="member-booking-search__field">
                  <Search aria-hidden="true" size={19} />
                  <Input
                    type="search"
                    value={bookingQuery}
                    placeholder="ชื่อเทรนเนอร์หรือรหัสคำขอ"
                    onChange={(event) => {
                      setBookingQuery(event.target.value);
                      setBookingPage(0);
                    }}
                  />
                </span>
              </label>
              <div className="profile-tabs" role="group" aria-label="กรองการจองตามสถานะ">
                {availableFilters.map((filter) => (
                  <button
                    key={filter.id}
                    id={`member-filter-${filter.id}`}
                    type="button"
                    aria-pressed={selectedFilter === filter.id}
                    onClick={() => selectBookingFilter(filter.id)}
                  >
                    {filter.label} <span>{bookings.filter(filter.match).length}</span>
                  </button>
                ))}
              </div>
              {filteredBookings.length === 0 ? (
                <p className="booking-next-step" role="status">{normalizedQuery ? "ไม่พบการจองที่ตรงกับคำค้น" : "ไม่มีการจองในสถานะนี้"}</p>
              ) : (
                <div className="member-booking-list">
                  <p className="sr-only" role="status">{filteredBookings.length} รายการ</p>
                  {visibleBookings.map((booking) => renderBookingSummary(booking, booking.id === actionBookingId))}
                </div>
              )}
              {rankedBookings.length > bookingsPerPage && (
                <nav className="member-booking-pager" aria-label="แบ่งหน้าการจอง">
                  <span>รายการ {pageStart + 1}–{Math.min(pageStart + bookingsPerPage, rankedBookings.length)} จาก {rankedBookings.length}</span>
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="หน้าก่อนหน้า"
                      disabled={currentPage === 0}
                      onClick={() => setBookingPage(currentPage - 1)}
                    >
                      <ChevronLeft aria-hidden="true" />
                    </Button>
                    <strong>หน้า {currentPage + 1} / {pageCount}</strong>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="หน้าถัดไป"
                      disabled={currentPage === pageCount - 1}
                      onClick={() => setBookingPage(currentPage + 1)}
                    >
                      <ChevronRight aria-hidden="true" />
                    </Button>
                  </div>
                </nav>
              )}
            </DashboardSection>
          )}
          {!loadingBookings && !bookingError && bookings.length === 0 && (
            <div className="selection-missing">
              <CalendarDays aria-hidden="true" size={28} />
              <h2>ยังไม่มีคำขอจอง</h2>
              <p>เลือกเทรนเนอร์และช่วงเวลาว่างเพื่อสร้างคำขอแรกของคุณ</p>
            </div>
          )}
          <Dialog open={selectedBooking !== null} onOpenChange={(open) => {
            if (!open) setSelectedBookingId(null);
          }}>
            <DialogContent className="member-booking-dialog">
              {selectedBooking && (
                <>
                  <DialogHeader>
                    <DialogTitle>{selectedBooking.trainer.displayName}</DialogTitle>
                    <DialogDescription>
                      คำขอ {selectedBooking.id} · {formatDateTime(selectedBooking.confirmedStartsAt ?? selectedBooking.startsAt)}
                    </DialogDescription>
                    <StatusBadge status={selectedBooking.status} />
                  </DialogHeader>
                  <div className="booking-detail-content">{renderBookingFactsAndActions(selectedBooking)}</div>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {role === "trainer" && <TrainerWorkbench onIncompleteProfile={() => goTo("/trainer/apply")} />}

      {role === "admin" && <AdminOperations />}
    </main>
  );
}
