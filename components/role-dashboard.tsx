"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  MessageSquareText,
  ShieldCheck,
  Upload,
  UsersRound,
} from "lucide-react";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { DemoNotice } from "@/components/demo-notice";
import { StatusBadge } from "@/components/status-badge";
import { TrainerWorkbench } from "@/components/trainer-workbench";
import { apiRequest } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Booking, UserRole } from "@/lib/types";

const roleCopy = {
  member: { index: "สมาชิก", title: "การฝึกของฉัน", lead: "ติดตามคำขอ นัดหมาย การชำระ และการสนทนาได้จากสถานะเดียวกัน" },
  trainer: { index: "เทรนเนอร์", title: "โต๊ะทำงานเทรนเนอร์", lead: "จัดการคุณสมบัติ ตารางว่าง และคำขอจองโดยไม่หลุดจากบริบท" },
  admin: { index: "ผู้ดูแลระบบ", title: "ศูนย์ตรวจสอบ", lead: "ตรวจใบรับรอง สลิป และสถานะสำคัญก่อนข้อมูลถูกเผยแพร่หรือยืนยัน" },
};

const paymentCopy: Record<Booking["paymentStatus"], string> = {
  not_submitted: "ยังไม่ส่งหลักฐาน",
  reviewing: "รอแอดมินตรวจสลิป",
  approved: "ตรวจสลิปแล้ว",
  rejected: "ต้องอัปโหลดหลักฐานใหม่",
};

function PaymentUpload({ booking }: { booking: Booking }) {
  const [status, setStatus] = useState("");
  const ready = booking.status === "awaiting_payment";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("");
    const data = new FormData(event.currentTarget);
    data.set("bookingId", booking.id);
    const token = localStorage.getItem("fitconnect_token");
    try {
      await apiRequest("/v1/payments", { method: "POST", body: data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
      setStatus("อัปโหลดแล้ว และส่งให้แอดมินตรวจด้วยตนเอง");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ");
    }
  }

  return (
    <form className="payment-upload" onSubmit={submit}>
      <div><h3>หลักฐานการชำระ</h3><p>อัปโหลดสลิปหลังเทรนเนอร์ตอบรับ · ไฟล์ JPG, PNG หรือ WebP ไม่เกิน 5 MB · แอดมินเป็นผู้ตรวจ</p></div>
      <label className="file-control" htmlFor="payment-slip"><Upload aria-hidden="true" size={19} /><span>{ready ? "เลือกสลิป" : "ยังไม่พร้อมอัปโหลด"}</span><input id="payment-slip" name="slip" type="file" accept="image/jpeg,image/png,image/webp" required disabled={!ready} /></label>
      <button className="button button--dark" type="submit" disabled={!ready}>{ready ? "ส่งให้ตรวจ" : "รอตามสถานะ"}</button>
      <p className="upload-status" role="status">{status && <><CircleAlert aria-hidden="true" size={16} /> {status}</>}</p>
    </form>
  );
}

export function RoleDashboard({ role }: { role: UserRole }) {
  const copy = roleCopy[role];
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingError, setBookingError] = useState("");
  const [isDemoData, setIsDemoData] = useState(false);

  const loadMemberBookings = useCallback(async () => {
    if (role !== "member") return;
    const token = localStorage.getItem("fitconnect_token");
    if (!token) return;
    try {
      const items = await apiRequest<Booking[]>("/v1/bookings", { headers: { Authorization: `Bearer ${token}` } });
      setBookings(items);
      setIsDemoData(items.some((item) => item.demo));
      setBookingError("");
    } catch (error) {
      setBookingError(error instanceof Error ? error.message : "โหลดรายการจองไม่สำเร็จ");
    }
  }, [role]);

  useEffect(() => {
    if (role !== "member") return;
    const token = localStorage.getItem("fitconnect_token");
    if (!token) return;
    void apiRequest<Booking[]>("/v1/bookings", { headers: { Authorization: `Bearer ${token}` } })
      .then((items) => {
        setBookings(items);
        setIsDemoData(items.some((item) => item.demo));
        setBookingError("");
      })
      .catch((error: unknown) => setBookingError(error instanceof Error ? error.message : "โหลดรายการจองไม่สำเร็จ"));
  }, [role]);

  const booking = bookings[0] ?? null;

  return (
    <main className="page-shell dashboard-shell">
      <section className="dashboard-heading">
        <div><h1>{copy.title}</h1></div>
        <p>{copy.lead}</p>
      </section>
      {role !== "admin" && isDemoData && <DemoNotice />}

      {role === "member" && (
        <>
          {bookingError && <div className="workbench-error" role="alert"><span>{bookingError}</span><button type="button" onClick={() => void loadMemberBookings()}>ลองใหม่</button></div>}
          {booking ? <>
          <section className="dashboard-ledger" aria-label="สถานะการจอง">
            <div className="ledger-heading"><div><h2>คำขอ {booking.id}</h2></div><StatusBadge status={booking.status} /></div>
            <div className="ledger-row"><span><CalendarDays aria-hidden="true" size={17} /> วันและเวลา</span><strong>{formatDateTime(booking.startsAt)}</strong></div>
            <div className="ledger-row"><span><UsersRound aria-hidden="true" size={17} /> เทรนเนอร์</span><strong>{booking.trainer.displayName}</strong></div>
            <div className="ledger-row"><span><ShieldCheck aria-hidden="true" size={17} /> การชำระ</span><strong>{paymentCopy[booking.paymentStatus]}</strong></div>
            <div className="ledger-actions"><Link href="/chat"><MessageSquareText aria-hidden="true" size={17} /> เปิดการสนทนา</Link><Link href={`/trainers/${booking.trainer.slug}`}>ดูโปรไฟล์ <ArrowRight aria-hidden="true" size={16} /></Link></div>
          </section>
          <PaymentUpload booking={booking} />
          </> : !bookingError && <div className="selection-missing"><CalendarDays aria-hidden="true" size={28} /><h2>ยังไม่มีคำขอจอง</h2><p>เลือกเทรนเนอร์และช่วงเวลาว่างเพื่อสร้างคำขอแรกของคุณ</p><Link className="button button--dark" href="/trainers">ค้นหาเทรนเนอร์</Link></div>}
        </>
      )}

      {role === "trainer" && <TrainerWorkbench />}

      {role === "admin" && <AdminReviewQueue />}
    </main>
  );
}
