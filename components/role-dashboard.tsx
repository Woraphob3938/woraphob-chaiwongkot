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
import { DemoNotice } from "@/components/demo-notice";
import { StatusBadge } from "@/components/status-badge";
import { API_URL, apiRequest } from "@/lib/api";
import { demoBookings } from "@/lib/demo-data";
import { formatDateTime } from "@/lib/format";
import type { Booking, UserRole } from "@/lib/types";

type AdminQueue = {
  trainers: Array<{ id: number; displayName: string; province: string; certificateCount: number; demo?: boolean }>;
  payments: Array<{ id: number; bookingId: string; memberName: string; fileUrl: string; demo?: boolean }>;
};

const demoAdminQueue: AdminQueue = {
  trainers: [{ id: 3, displayName: "เทรนเนอร์สาธิต ค.", province: "นครพนม", certificateCount: 1, demo: true }],
  payments: [{ id: 1, bookingId: "BK-DEMO-001", memberName: "สมาชิกสาธิต", fileUrl: "/v1/admin/files/payment/1", demo: true }],
};

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

function PaymentAction({ payment }: { payment: AdminQueue["payments"][number] }) {
  const [status, setStatus] = useState("");

  async function viewFile() {
    setStatus("");
    const token = localStorage.getItem("fitconnect_token");
    try {
      const response = await fetch(`${API_URL}${payment.fileUrl}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new Error("เปิดไฟล์ไม่สำเร็จ");
      const objectUrl = URL.createObjectURL(await response.blob());
      window.open(objectUrl, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "เปิดไฟล์ไม่สำเร็จ");
    }
  }

  async function decide(decision: "approve" | "reject") {
    setStatus("");
    const token = localStorage.getItem("fitconnect_token");
    try {
      await apiRequest(`/v1/admin/payments/${payment.id}/${decision}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ note: decision === "approve" ? "ยอดและคำขอตรงกัน" : "หลักฐานไม่ตรงกับคำขอ" }),
      });
      setStatus(decision === "approve" ? "อนุมัติสลิปแล้ว" : "ส่งกลับให้อัปโหลดใหม่แล้ว");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "บันทึกผลไม่สำเร็จ");
    }
  }

  return (
    <div className="queue-actions">
      <button type="button" onClick={viewFile}>เปิดสลิป</button>
      <button type="button" onClick={() => decide("approve")}>อนุมัติ</button>
      <button type="button" onClick={() => decide("reject")}>ไม่ผ่าน</button>
      {status && <span role="status">{status}</span>}
    </div>
  );
}

function AdminAction({ trainerId }: { trainerId: number }) {
  const [status, setStatus] = useState("");

  async function decide(decision: "approve" | "reject") {
    setStatus("");
    const token = localStorage.getItem("fitconnect_token");
    try {
      await apiRequest(`/v1/admin/trainers/${trainerId}/${decision}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ note: decision === "approve" ? "ผ่านการตรวจ" : "เอกสารไม่ครบ" }),
      });
      setStatus(decision === "approve" ? "อนุมัติแล้ว" : "ส่งกลับให้แก้ไขแล้ว");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "บันทึกผลไม่สำเร็จ");
    }
  }

  return (
    <div className="queue-actions">
      <button type="button" onClick={() => decide("approve")}>อนุมัติ</button>
      <button type="button" onClick={() => decide("reject")}>ขอเอกสารเพิ่ม</button>
      {status && <span role="status">{status}</span>}
    </div>
  );
}

export function RoleDashboard({ role }: { role: UserRole }) {
  const copy = roleCopy[role];
  const [bookings, setBookings] = useState<Booking[]>(demoBookings);
  const [adminQueue, setAdminQueue] = useState<AdminQueue>(demoAdminQueue);
  const [isDemoData, setIsDemoData] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem("fitconnect_token");
    if (!token) return;
    if (role === "admin") {
      apiRequest<AdminQueue>("/v1/admin/review-queue", { headers: { Authorization: `Bearer ${token}` } })
        .then((queue) => { setAdminQueue(queue); setIsDemoData([...queue.trainers, ...queue.payments].some((item) => item.demo)); })
        .catch(() => setIsDemoData(true));
      return;
    }
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
      {isDemoData && <DemoNotice />}

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

      {role === "admin" && (
        <div className="admin-board">
          <section className="admin-summary">
            <div><span>ใบสมัครรอตรวจ</span><strong>{String(adminQueue.trainers.length).padStart(2, "0")}</strong></div>
            <div><span>สลิปรอตรวจ</span><strong>{String(adminQueue.payments.length).padStart(2, "0")}</strong></div>
            <div><span>รายงานที่ต้องติดตาม</span><strong>00</strong></div>
          </section>
          <section className="verification-queue">
            <div className="section-line-heading"><div><p className="label">ลำดับการตรวจ</p><h2>รายการที่ต้องตัดสินใจ</h2></div><span>{isDemoData ? "ข้อมูลสาธิต" : "ข้อมูลจากระบบ"}</span></div>
            {adminQueue.trainers.map((trainer) => <div className="verification-row" key={`trainer-${trainer.id}`}><div><span>TR-{String(trainer.id).padStart(6, "0")}</span><strong>ใบสมัคร{trainer.displayName}</strong><small>ใบรับรอง {trainer.certificateCount} ไฟล์ · จังหวัด{trainer.province}</small></div><StatusBadge status="pending" /><AdminAction trainerId={trainer.id} /></div>)}
            {adminQueue.payments.map((payment) => <div className="verification-row" key={`payment-${payment.id}`}><div><span>PAY-{String(payment.id).padStart(6, "0")}</span><strong>สลิปคำขอ {payment.bookingId}</strong><small>{payment.memberName} · รอตรวจยอดกับคำขอ</small></div><StatusBadge status="reviewing" /><PaymentAction payment={payment} /></div>)}
            {adminQueue.trainers.length + adminQueue.payments.length === 0 && <div className="empty-state"><strong>ไม่มีรายการรอตรวจ</strong><p>คิวตรวจสอบเป็นปัจจุบันแล้ว</p></div>}
          </section>
        </div>
      )}
    </main>
  );
}
