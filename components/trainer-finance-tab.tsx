"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { StripePayoutsCard } from "@/components/stripe-payouts-card";
import { authenticatedRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import { leaveExpiredSession } from "@/lib/session";
import type { Booking, TrainerAvailabilitySlot, TrainerStats } from "@/lib/types";

const thaiMonthLabels = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** The API sends "YYYY-MM"; a bare month number reads the same way. */
function monthLabel(month: string | number) {
  const index = typeof month === "number" ? month : Number(String(month).slice(-2));
  return thaiMonthLabels[index - 1] ?? String(month);
}

/** The finance tab: the payout account, what the bookings earned, and the year's statistics. */
export function TrainerFinanceTab({ active, bookings, bookingsReady, slots }: {
  /** Whether the tab is on screen; statistics load only then. */
  active: boolean;
  bookings: Booking[];
  bookingsReady: boolean;
  slots: TrainerAvailabilitySlot[];
}) {
  const navigate = useRouter().push;
  const thisYear = new Date().getFullYear();
  const [stats, setStats] = useState<TrainerStats | null>(null);
  const [statsYear, setStatsYear] = useState(() => new Date().getFullYear());
  const [statsMode, setStatsMode] = useState<"monthly" | "yearly">("monthly");
  const [statsError, setStatsError] = useState("");
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsReload, setStatsReload] = useState(0);

  // Statistics load only when the finance tab asks for them, so opening the
  // workspace never waits on a second request.
  useEffect(() => {
    if (!active) return;
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
  }, [active, navigate, statsReload, statsYear]);

  const confirmedBookings = bookingsReady ? bookings.filter((booking) => booking.status === "confirmed") : [];
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
  const statsMonths = thaiMonthLabels.map((label) => ({
    label,
    bookings: stats?.bookingsByMonth.find((row) => monthLabel(row.month) === label)?.total ?? 0,
    income: stats?.incomeByMonth.find((row) => monthLabel(row.month) === label)?.amount ?? 0,
  })).filter((line) => line.bookings !== 0 || line.income !== 0);
  const statsYearTotal = stats?.totals ?? { bookings: 0, income: 0 };
  const statsSalary = stats?.salarySummary ?? [];

  return (
    <>
      {active && <StripePayoutsCard />}
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
            <button type="button" onClick={() => setStatsYear(thisYear)} disabled={statsYear === thisYear}>ปีนี้</button>
            <button type="button" aria-label="ปีถัดไป" disabled={statsYear >= thisYear} onClick={() => setStatsYear((year) => year + 1)}><ChevronRight aria-hidden="true" size={18} /></button>
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
    </>
  );
}
