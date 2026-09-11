"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  MessageSquareText,
  RefreshCw,
  Search,
} from "lucide-react";
import { AdminOperations } from "@/components/admin-operations";
import { TrainerPaymentReview } from "@/components/admin-review-queue";
import { DashboardSection, NextActionCard } from "@/components/dashboard-primitives";
import { DisclosureSection } from "@/components/disclosure-section";
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
import { formatDateTime } from "@/lib/format";
import { formatAmount, paymentStatusCopy } from "@/lib/payment-copy";
import type { Booking, UserRole } from "@/lib/types";

const roleCopy = {
  member: { index: "สมาชิก", title: "การฝึกของฉัน", lead: "ติดตามคำขอ นัดหมาย การชำระ และการสนทนาได้จากสถานะเดียวกัน" },
  trainer: { index: "เทรนเนอร์", title: "โต๊ะทำงานเทรนเนอร์", lead: "จัดการคุณสมบัติ ตารางว่าง และคำขอจองโดยไม่หลุดจากบริบท" },
  admin: { index: "ผู้ดูแลระบบ", title: "พื้นที่ผู้ดูแลระบบ", lead: "จัดการบัญชี ตรวจเทรนเนอร์ ติดตามการจอง การชำระเงิน และสิทธิ์ของผู้ดูแลระบบ" },
};

const paymentCopy = paymentStatusCopy;

function nextStepCopy(booking: Booking): string {
  if (booking.review) return "รีวิวนี้เผยแพร่แล้ว";
  if (booking.actions.canPay) return "ส่งหลักฐานให้ผู้รับผิดชอบตรวจภายในเวลาที่เหลือ";
  if (booking.actions.canReview) return "เขียนรีวิวหลังการฝึก";
  if (booking.status === "payment_review") return "รอผู้รับผิดชอบตรวจหลักฐานด้วยตนเอง";
  if (booking.status === "confirmed") return "เตรียมตัวตามวันและเวลานัด";
  if (booking.status === "cancelled") return "คำขอนี้สิ้นสุดแล้ว";
  if (booking.status === "expired") return "การจองหมดเวลา ช่วงเวลานี้ถูกคืนแล้ว";
  return "ยังไม่มีขั้นตอนที่ต้องทำในขณะนี้";
}

type BookingFilter = "all" | "awaiting_payment" | "payment_review" | "confirmed" | "completed" | "closed";
const bookingsPerPage = 10;

const bookingFilters: { id: BookingFilter; label: string; match: (booking: Booking) => boolean }[] = [
  { id: "all", label: "ทั้งหมด", match: () => true },
  { id: "awaiting_payment", label: "รอชำระ", match: (booking) => booking.status === "awaiting_payment" },
  { id: "payment_review", label: "รอตรวจการชำระ", match: (booking) => booking.status === "payment_review" },
  { id: "confirmed", label: "ยืนยันนัดแล้ว", match: (booking) => booking.status === "confirmed" },
  { id: "completed", label: "ฝึกเสร็จ", match: (booking) => booking.status === "completed" },
  { id: "closed", label: "จบแล้ว", match: (booking) => booking.status === "cancelled" || booking.status === "expired" },
];

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

  async function cancelBooking() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(booking.id)}/cancel`, { method: "POST" });
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
      if (nextOpen) setError("");
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
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");
  const [bookingQuery, setBookingQuery] = useState("");
  const [bookingPage, setBookingPage] = useState(0);
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);

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
    void authenticatedRequest<Booking[]>("/v1/bookings")
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
    if (role !== "member") return;
    const refreshWhenMemberReturns = () => void loadMemberBookings();
    window.addEventListener("focus", refreshWhenMemberReturns);
    return () => window.removeEventListener("focus", refreshWhenMemberReturns);
  }, [loadMemberBookings, role]);

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

    return (
      <>
        <p className="booking-next-step">{nextStepCopy(booking)}</p>
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
        {!showSessions && (
          <div className="ledger-row"><span>นัดหมาย</span><strong>{formatDateTime(booking.startsAt)}</strong></div>
        )}
        <div className="ledger-row"><span>{booking.bookingType === "monthly" ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง"}</span><strong>{formatAmount(booking.quotedPrice)}</strong></div>
        <div className="ledger-row"><span>การชำระ</span><strong>{paymentCopy[booking.paymentStatus]}</strong></div>
        {booking.payment && (
          <div className="ledger-row"><span>ยอดที่โอน</span><strong>{formatAmount(booking.payment.amount)}</strong></div>
        )}
        {booking.payment?.status === "rejected" && booking.payment.reviewNote && (
          <div className="ledger-row"><span>หมายเหตุจากผู้ดูแลระบบ</span><strong>{booking.payment.reviewNote}</strong></div>
        )}
        {booking.actions.canPay && booking.paymentDeadlineAt && (
          <div className="payment-deadline-row">
            <span>{booking.paymentStatus === "rejected" ? "ส่งสลิปใหม่ภายใน" : "เวลาที่เหลือสำหรับส่งสลิป"}</span>
            <PaymentDeadline deadlineAt={booking.paymentDeadlineAt} onExpired={() => void loadMemberBookings()} />
          </div>
        )}
        {booking.actions.canPay && <PaymentPanel booking={booking} onUpdated={loadMemberBookings} />}
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
        <span>คำขอ {booking.id}</span>
      </span>
      <span className="member-booking-summary__meta">
        <span className="member-booking-summary__appointment">{formatDateTime(booking.startsAt)}</span>
        <StatusBadge status={booking.status} />
      </span>
      <span className="member-booking-summary__action">ดูรายละเอียด <ChevronRight aria-hidden="true" size={16} /></span>
    </button>
  );

  const memberNextAction = getMemberNextAction(bookings);
  const actionBookingId = bookingIdFromActionHref(memberNextAction.href);
  const actionBooking = bookings.find((booking) => booking.id === actionBookingId);
  const availableFilters = bookingFilters.filter((filter) => filter.id === "all" || bookings.some(filter.match));
  const selectedFilter = availableFilters.some((filter) => filter.id === bookingFilter) ? bookingFilter : "all";
  const normalizedQuery = bookingQuery.trim().toLocaleLowerCase("th");
  const filteredBookings = bookings.filter((booking) => {
    const selected = bookingFilters.find((filter) => filter.id === selectedFilter) ?? bookingFilters[0];
    const searchText = `${booking.trainer.displayName} ${booking.id}`.toLocaleLowerCase("th");
    return selected.match(booking) && (!normalizedQuery || searchText.includes(normalizedQuery));
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
      {role === "member" || role === "trainer"
        ? <h1 className="sr-only">{copy.title}</h1>
        : <section className="dashboard-heading"><div><h1>{copy.title}</h1></div><p>{copy.lead}</p></section>}
      {role === "member" && (
        <div className="member-dashboard-content">
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
            <NextActionCard action={memberNextAction} />
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
                <p className="booking-next-step">{normalizedQuery ? "ไม่พบการจองที่ตรงกับคำค้น" : "ไม่มีการจองในสถานะนี้"}</p>
              ) : (
                <div className="member-booking-list">
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
                      คำขอ {selectedBooking.id} · {formatDateTime(selectedBooking.startsAt)}
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

      {role === "trainer" && <><TrainerPaymentReview /><TrainerWorkbench onIncompleteProfile={() => goTo("/trainer/apply")} /></>}

      {role === "admin" && <AdminOperations />}
    </main>
  );
}
