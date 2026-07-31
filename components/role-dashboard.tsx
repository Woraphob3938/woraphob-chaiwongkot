"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  CircleAlert,
  FileCheck2,
  MessageSquareText,
  ShieldCheck,
  Upload,
  UsersRound,
} from "lucide-react";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { DemoNotice } from "@/components/demo-notice";
import { StatusBadge } from "@/components/status-badge";
import { apiRequest } from "@/lib/api";
import { demoBookings } from "@/lib/demo-data";
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
      <div><p className="label">หลักฐานการชำระ</p><h3>อัปโหลดสลิปหลังเทรนเนอร์ตอบรับ</h3><p>ไฟล์ JPG, PNG หรือ WebP ไม่เกิน 5 MB · แอดมินเป็นผู้ตรวจ</p></div>
      <label className="file-control" htmlFor="payment-slip"><Upload aria-hidden="true" size={19} /><span>{ready ? "เลือกสลิป" : "ยังไม่พร้อมอัปโหลด"}</span><input id="payment-slip" name="slip" type="file" accept="image/jpeg,image/png,image/webp" required disabled={!ready} /></label>
      <button className="button button--dark" type="submit" disabled={!ready}>{ready ? "ส่งให้ตรวจ" : "รอตามสถานะ"}</button>
      <p className="upload-status" role="status">{status && <><CircleAlert aria-hidden="true" size={16} /> {status}</>}</p>
    </form>
  );
}

export function RoleDashboard({ role }: { role: UserRole }) {
  const copy = roleCopy[role];
  const [bookings, setBookings] = useState<Booking[]>(demoBookings);
  const [isDemoData, setIsDemoData] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("fitconnect_token");
    if (!token) return;
    if (role === "admin") return;
    apiRequest<Booking[]>("/v1/bookings", { headers: { Authorization: `Bearer ${token}` } })
      .then((items) => { setBookings(items); setIsDemoData(items.some((item) => item.demo)); })
      .catch(() => setIsDemoData(true));
  }, [role]);

  const booking = bookings[0] ?? null;
  const pendingTrainerBookings = useMemo(() => bookings.filter((item) => item.status === "pending_trainer"), [bookings]);

  return (
    <main className="page-shell dashboard-shell">
      <section className="dashboard-heading">
        <div><h1>{copy.title}</h1></div>
        <p>{copy.lead}</p>
      </section>
      {role !== "admin" && isDemoData && <DemoNotice />}

      {role === "member" && (
        booking ? <>
          <section className="dashboard-ledger" aria-label="สถานะการจอง">
            <div className="ledger-heading"><div><p className="label">คำขอล่าสุด</p><h2>{booking.id}</h2></div><StatusBadge status={booking.status} /></div>
            <div className="ledger-row"><span><CalendarDays aria-hidden="true" size={17} /> วันและเวลา</span><strong>{formatDateTime(booking.startsAt)}</strong></div>
            <div className="ledger-row"><span><UsersRound aria-hidden="true" size={17} /> เทรนเนอร์</span><strong>{booking.trainer.displayName}</strong></div>
            <div className="ledger-row"><span><ShieldCheck aria-hidden="true" size={17} /> การชำระ</span><strong>{paymentCopy[booking.paymentStatus]}</strong></div>
            <div className="ledger-actions"><Link href="/chat"><MessageSquareText aria-hidden="true" size={17} /> เปิดการสนทนา</Link><Link href={`/trainers/${booking.trainer.slug}`}>ดูโปรไฟล์ <ArrowRight aria-hidden="true" size={16} /></Link></div>
          </section>
          <PaymentUpload booking={booking} />
        </> : <div className="selection-missing"><CalendarDays aria-hidden="true" size={28} /><h2>ยังไม่มีคำขอจอง</h2><p>เลือกเทรนเนอร์และช่วงเวลาว่างเพื่อสร้างคำขอแรกของคุณ</p><Link className="button button--dark" href="/trainers">ค้นหาเทรนเนอร์</Link></div>
      )}

      {role === "trainer" && (
        <div className="dashboard-columns">
          <section className="dashboard-ledger">
            <div className="ledger-heading"><div><p className="label">สถานะโปรไฟล์</p><h2>พร้อมรับคำขอ</h2></div><StatusBadge status="verified" /></div>
            <div className="ledger-row"><span><FileCheck2 aria-hidden="true" size={17} /> ใบรับรอง</span><strong>2 รายการผ่านการตรวจ</strong></div>
            <div className="ledger-row"><span><CalendarDays aria-hidden="true" size={17} /> ตารางที่เปิด</span><strong>4 ช่วงเวลา</strong></div>
            <div className="ledger-actions"><Link href="/trainer/apply">แก้ไขเอกสาร</Link><Link href="/trainers/demo-trainer-a">ดูหน้าสาธารณะ <ArrowRight aria-hidden="true" size={16} /></Link></div>
          </section>
          <section className="queue-panel">
            <div className="section-line-heading"><div><p className="label">คำขอเข้าใหม่</p><h2>รอตอบรับ {pendingTrainerBookings.length} รายการ</h2></div><span className="queue-count">{String(pendingTrainerBookings.length).padStart(2, "0")}</span></div>
            {pendingTrainerBookings.map((item) => <div className="queue-record" key={item.id}><div><strong>{item.demo ? "สมาชิกสาธิต" : `คำขอ ${item.id}`}</strong><span>{formatDateTime(item.startsAt)}</span></div><StatusBadge status={item.status} /></div>)}
            {pendingTrainerBookings.length === 0 && <p>ยังไม่มีคำขอที่รอตอบรับ</p>}
          </section>
        </div>
      )}

      {role === "admin" && <AdminReviewQueue />}
    </main>
  );
}
