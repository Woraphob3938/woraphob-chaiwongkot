"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  MessageSquareText,
  RefreshCw,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { DashboardSection, NextActionCard } from "@/components/dashboard-primitives";
import { DemoNotice } from "@/components/demo-notice";
import { PaymentPanel } from "@/components/payment-panel";
import { ReviewForm } from "@/components/review-form";
import { StatusBadge } from "@/components/status-badge";
import { TrainerWorkbench } from "@/components/trainer-workbench";
import { authenticatedRequest } from "@/lib/api";
import { getMemberNextAction } from "@/lib/dashboard-actions";
import { formatDateTime } from "@/lib/format";
import type { Booking, UserRole } from "@/lib/types";

const roleCopy = {
  member: { index: "สมาชิก", title: "การฝึกของฉัน", lead: "ติดตามคำขอ นัดหมาย การชำระ และการสนทนาได้จากสถานะเดียวกัน" },
  trainer: { index: "เทรนเนอร์", title: "โต๊ะทำงานเทรนเนอร์", lead: "จัดการคุณสมบัติ ตารางว่าง และคำขอจองโดยไม่หลุดจากบริบท" },
  admin: { index: "ผู้ดูแลระบบ", title: "ศูนย์ตรวจสอบ", lead: "ตรวจใบรับรอง สลิป และสถานะสำคัญก่อนข้อมูลถูกเผยแพร่หรือยืนยัน" },
};

const paymentCopy: Record<Booking["paymentStatus"], string> = {
  not_submitted: "ยังไม่ส่งหลักฐาน",
  reviewing: "รอผู้ดูแลตรวจสลิป",
  approved: "ผู้ดูแลตรวจสลิปแล้ว",
  rejected: "ผู้ดูแลขอหลักฐานใหม่",
};

function formatAmount(amount: number | null): string {
  return amount === null
    ? "ไม่มียอดที่บันทึก"
    : `${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} บาท`;
}

function nextStepCopy(booking: Booking): string {
  if (booking.review) return "รีวิวนี้เผยแพร่แล้ว";
  if (booking.actions.canPay) return "ส่งหลักฐานการโอนให้ผู้ดูแลตรวจ";
  if (booking.actions.canReview) return "เขียนรีวิวหลังการฝึก";
  if (booking.status === "pending_trainer") return "รอเทรนเนอร์ตอบรับคำขอ";
  if (booking.status === "payment_review") return "รอผู้ดูแลตรวจหลักฐานด้วยตนเอง";
  if (booking.status === "confirmed") return "เตรียมตัวตามวันและเวลานัด";
  if (booking.status === "cancelled") return "คำขอนี้สิ้นสุดแล้ว";
  return "ยังไม่มีขั้นตอนที่ต้องทำในขณะนี้";
}

function bookingIdFromActionHref(href: string): string | null {
  const marker = "#booking-";
  const markerIndex = href.indexOf(marker);
  return markerIndex === -1 ? null : href.slice(markerIndex + marker.length);
}

export function RoleDashboard({ role }: { role: UserRole }) {
  const copy = roleCopy[role];
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingError, setBookingError] = useState("");
  const [isDemoData, setIsDemoData] = useState(false);
  const [loadingBookings, setLoadingBookings] = useState(role === "member");
  const [showAllBookings, setShowAllBookings] = useState(false);

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
      setIsDemoData(items.some((item) => item.demo));
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
        setIsDemoData(items.some((item) => item.demo));
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

  const renderBookingFactsAndActions = (booking: Booking) => (
    <>
      <div className="ledger-heading">
        <div><h3>คำขอ {booking.id}</h3></div>
        <StatusBadge status={booking.status} />
      </div>
      <div className="ledger-row"><span><CalendarDays aria-hidden="true" size={17} /> เริ่มฝึก</span><strong>{formatDateTime(booking.startsAt)}</strong></div>
      <div className="ledger-row"><span><CalendarDays aria-hidden="true" size={17} /> สิ้นสุด</span><strong>{formatDateTime(booking.endsAt)}</strong></div>
      <div className="ledger-row"><span>สถานที่</span><strong>{booking.location}</strong></div>
      <div className="ledger-row"><span><UsersRound aria-hidden="true" size={17} /> เทรนเนอร์</span><strong>{booking.trainer.displayName}</strong></div>
      <div className="ledger-row"><span>ค่าฝึกที่แจ้ง</span><strong>{formatAmount(booking.quotedPrice)}</strong></div>
      <div className="ledger-row"><span><ShieldCheck aria-hidden="true" size={17} /> การชำระ</span><strong>{paymentCopy[booking.paymentStatus]}</strong></div>
      <div className="ledger-row"><span>ยอดที่โอน</span><strong>{formatAmount(booking.payment?.amount ?? null)}</strong></div>
      {booking.payment?.status === "rejected" && booking.payment.reviewNote && (
        <div className="ledger-row"><span>หมายเหตุจากผู้ดูแล</span><strong>{booking.payment.reviewNote}</strong></div>
      )}
      <div className="ledger-row"><span>ขั้นตอนถัดไป</span><strong>{nextStepCopy(booking)}</strong></div>
      {booking.actions.canPay && <PaymentPanel booking={booking} onUpdated={loadMemberBookings} />}
      {booking.actions.canReview && <ReviewForm booking={booking} onUpdated={loadMemberBookings} />}
      {booking.review && (
        <div className="ledger-row">
          <span>รีวิวที่เผยแพร่</span>
          <strong>{booking.review.rating} จาก 5 ดาว: {booking.review.comment}</strong>
        </div>
      )}
      <div className="ledger-actions">
        {booking.actions.canReadChat && (
          <Link href={`/chat?booking=${encodeURIComponent(booking.id)}`}><MessageSquareText aria-hidden="true" size={17} /> เปิดการสนทนา</Link>
        )}
        <Link href={`/trainers/${booking.trainer.slug}`}>ดูโปรไฟล์ <ArrowRight aria-hidden="true" size={16} /></Link>
      </div>
    </>
  );

  const renderBookingSummary = (booking: Booking) => (
    <details className="member-booking-summary" data-testid="booking-summary" id={`booking-${booking.id}`} key={booking.id}>
      <summary>
        <span className="member-booking-summary__identity">
          <span>คำขอ {booking.id}</span>
          <strong>{booking.trainer.displayName}</strong>
        </span>
        <span className="member-booking-summary__appointment">{formatDateTime(booking.startsAt)}</span>
        <span className="member-booking-summary__action">ดูรายละเอียด</span>
      </summary>
      <div className="booking-detail-content">{renderBookingFactsAndActions(booking)}</div>
    </details>
  );

  const memberNextAction = getMemberNextAction(bookings);
  const actionBookingId = bookingIdFromActionHref(memberNextAction.href);
  const actionBooking = bookings.find((booking) => booking.id === actionBookingId);
  const visibleBookings = actionBooking
    ? [actionBooking, ...bookings.filter((booking) => booking.id !== actionBooking.id)].slice(0, 3)
    : bookings.slice(0, 3);
  const visibleBookingIds = new Set(visibleBookings.map((booking) => booking.id));
  const archiveBookings = bookings.filter((booking) => !visibleBookingIds.has(booking.id));

  return (
    <main className="page-shell dashboard-shell">
      <section className="dashboard-heading">
        <div><h1>{copy.title}</h1></div>
        <p>{copy.lead}</p>
      </section>
      {role !== "admin" && isDemoData && <DemoNotice />}

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
            <DashboardSection
              title="การจองล่าสุด"
              description="เปิดเฉพาะคำขอที่ต้องการเมื่อต้องชำระ รีวิว หรือสนทนา"
            >
              <div className="member-booking-list">
                {visibleBookings.map(renderBookingSummary)}
              </div>
              {archiveBookings.length > 0 && (
                <details
                  className="all-bookings-disclosure"
                  id="all-bookings"
                  onToggle={(event) => setShowAllBookings(event.currentTarget.open)}
                >
                  <summary>
                    <strong>ดูการจองทั้งหมด</strong>
                    <span>แสดงอีก {archiveBookings.length} รายการ จากทั้งหมด {bookings.length}</span>
                  </summary>
                  {showAllBookings && (
                    <div className="member-booking-list member-booking-list--archive">
                      {archiveBookings.map(renderBookingSummary)}
                    </div>
                  )}
                </details>
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
        </div>
      )}

      {role === "trainer" && <TrainerWorkbench />}

      {role === "admin" && <AdminReviewQueue />}
    </main>
  );
}
