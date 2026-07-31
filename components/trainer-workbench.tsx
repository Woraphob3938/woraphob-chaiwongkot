"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, RefreshCw, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Booking, TrainerAvailabilitySlot, TrainerWorkspace } from "@/lib/types";

function localInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function leaveExpiredSession(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  localStorage.removeItem("fitconnect_token");
  window.location.assign("/login");
  return true;
}

export function TrainerWorkbench() {
  const [workspace, setWorkspace] = useState<TrainerWorkspace | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [workspaceError, setWorkspaceError] = useState("");
  const [bookingError, setBookingError] = useState("");
  const [bookingNotice, setBookingNotice] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ startsAt: "", endsAt: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadWorkspace = useCallback(async () => {
    try {
      const data = await authenticatedRequest<TrainerWorkspace>("/v1/trainer/me");
      setWorkspace(data);
      setWorkspaceError("");
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setWorkspaceError(error instanceof Error ? error.message : "โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ");
    }
  }, []);

  const loadBookings = useCallback(async () => {
    try {
      const data = await authenticatedRequest<Booking[]>("/v1/bookings");
      setBookings(data);
      setBookingError("");
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setBookingError(error instanceof Error ? error.message : "โหลดคำขอจองไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    const initialLoad = Promise.allSettled([
      authenticatedRequest<TrainerWorkspace>("/v1/trainer/me"),
      authenticatedRequest<Booking[]>("/v1/bookings"),
    ]);
    void initialLoad.then(([workspaceResult, bookingResult]) => {
      if (workspaceResult.status === "fulfilled") {
        setWorkspace(workspaceResult.value);
        setWorkspaceError("");
      } else if (!leaveExpiredSession(workspaceResult.reason)) {
        setWorkspaceError(workspaceResult.reason instanceof Error ? workspaceResult.reason.message : "โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ");
      }

      if (bookingResult.status === "fulfilled") {
        setBookings(bookingResult.value);
        setBookingError("");
      } else if (!leaveExpiredSession(bookingResult.reason)) {
        setBookingError(bookingResult.reason instanceof Error ? bookingResult.reason.message : "โหลดคำขอจองไม่สำเร็จ");
      }
      setLoading(false);
    });
  }, []);

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
  const pendingBookings = bookings.filter((booking) => booking.status === "pending_trainer");

  async function createSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAvailabilityError("");
    setFieldErrors({});
    setBusy("slot-create");
    try {
      const startsAt = new Date(form.startsAt).toISOString();
      const endsAt = new Date(form.endsAt).toISOString();
      await authenticatedRequest<TrainerAvailabilitySlot>("/v1/availability-slots", {
        method: "POST",
        body: JSON.stringify({ startsAt, endsAt }),
      });
      setForm({ startsAt: "", endsAt: "" });
      await loadWorkspace();
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      if (error instanceof ApiError) setFieldErrors(error.fields ?? {});
      setAvailabilityError(error instanceof Error ? error.message : "เพิ่มช่วงเวลาไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function deleteSlot(slotId: number) {
    setAvailabilityError("");
    setBusy(`slot-${slotId}`);
    try {
      await authenticatedRequest(`/v1/availability-slots/${slotId}`, { method: "DELETE" });
      await loadWorkspace();
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setAvailabilityError(error instanceof Error ? error.message : "ลบช่วงเวลาไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function decideBooking(bookingId: string, decision: "accept" | "reject") {
    const target = decision === "accept" ? "awaiting_payment" : "cancelled";
    setBusy(`booking-${bookingId}`);
    setBookingError("");
    setBookingNotice("");
    try {
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: target }),
      });
      await Promise.all([loadWorkspace(), loadBookings()]);
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setBookingError(error instanceof Error ? error.message : "บันทึกผลคำขอไม่สำเร็จ");
      if (error instanceof ApiError && error.status === 409) {
        setBookingNotice("คำขอนี้ถูกเปลี่ยนสถานะแล้ว ระบบได้โหลดข้อมูลล่าสุดให้คุณ");
        await Promise.all([loadWorkspace(), loadBookings()]);
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading && !workspace) {
    return <section className="queue-loading" aria-live="polite">กำลังเตรียมโต๊ะทำงานเทรนเนอร์…</section>;
  }

  if (workspace?.profile === null) {
    return (
      <section className="approval-panel approval-panel--empty">
        <div><h2>ยังไม่มีโปรไฟล์เทรนเนอร์</h2><p>ส่งข้อมูลและใบรับรองก่อนเปิดตารางให้สมาชิกจอง</p></div>
        <Link className="button button--dark" href="/trainer/apply">เริ่มสมัครเป็นเทรนเนอร์</Link>
      </section>
    );
  }

  return (
    <div className="trainer-workbench">
      <section className="approval-panel">
        <div>
          <h2>{approved ? "โปรไฟล์พร้อมเปิดตาราง" : "โปรไฟล์ยังเปิดตารางไม่ได้"}</h2>
          <p>{workspace?.profile?.approvalNote ?? (approved ? "สร้างช่วงเวลาว่างล่วงหน้าได้ไม่เกิน 2 เดือน" : "รอผู้ดูแลตรวจใบรับรองก่อนสร้างช่วงเวลาว่าง")}</p>
        </div>
        {workspace?.profile && <StatusBadge status={workspace.profile.approvalStatus} />}
        {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
      </section>

      <section className="availability-panel trainer-availability" aria-labelledby="availability-title">
        <div className="section-line-heading"><div><h2 id="availability-title">ตารางว่างของฉัน</h2><p>ช่วงเวลาที่สมาชิกมองเห็นและส่งคำขอได้</p></div><CalendarPlus aria-hidden="true" size={22} /></div>
        <form className="availability-form" onSubmit={createSlot}>
          <label>
            <span>เริ่มต้น</span>
            <input type="datetime-local" required min={localInputValue(now)} max={localInputValue(maxDate)} value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} disabled={!approved || busy === "slot-create"} />
            {fieldErrors.startsAt && <small className="field-error">{fieldErrors.startsAt}</small>}
          </label>
          <label>
            <span>สิ้นสุด</span>
            <input type="datetime-local" required min={form.startsAt || localInputValue(now)} max={localInputValue(maxDate)} value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} disabled={!approved || busy === "slot-create"} />
            {fieldErrors.endsAt && <small className="field-error">{fieldErrors.endsAt}</small>}
          </label>
          <button className="button button--accent" type="submit" disabled={!approved || busy === "slot-create"}>{busy === "slot-create" ? "กำลังเพิ่ม…" : "เพิ่มช่วงเวลาว่าง"}</button>
        </form>
        {availabilityError && <p className="row-error" role="alert">{availabilityError}</p>}
        <div className="trainer-slot-list">
          {workspace?.slots.map((slot) => {
            const canDelete = slot.state === "available" && new Date(slot.startsAt).getTime() > now.getTime();
            return (
              <div className="trainer-slot-row" key={slot.id} aria-busy={busy === `slot-${slot.id}`}>
                <span><strong>{formatDateTime(slot.startsAt)}</strong><small>{slot.state === "available" ? "สมาชิกจองได้" : "มีคำขอใช้ช่วงเวลานี้"}</small></span>
                {canDelete && <button type="button" disabled={busy === `slot-${slot.id}`} onClick={() => void deleteSlot(slot.id)} aria-label={`ลบช่วงเวลา ${formatDateTime(slot.startsAt)}`}><Trash2 aria-hidden="true" size={16} /> ลบ</button>}
              </div>
            );
          })}
          {workspace?.slots.length === 0 && <div className="empty-state"><strong>ยังไม่มีช่วงเวลาว่าง</strong><p>เพิ่มช่วงเวลาแรกเมื่อโปรไฟล์ได้รับการอนุมัติ</p></div>}
        </div>
      </section>

      <section className="trainer-booking-list" aria-labelledby="trainer-requests-title">
        <div className="section-line-heading"><div><h2 id="trainer-requests-title">คำขอที่รอคำตอบ</h2><p>ตรวจวัน เวลา สถานที่ และข้อมูลจากสมาชิกก่อนตัดสินใจ</p></div><span className="queue-count">{String(pendingBookings.length).padStart(2, "0")}</span></div>
        {bookingNotice && <p className="queue-notice" role="status">{bookingNotice}</p>}
        {bookingError && <div className="workbench-error" role="alert"><span>{bookingError}</span><button type="button" onClick={() => void loadBookings()}><RefreshCw aria-hidden="true" size={15} /> ลองใหม่</button></div>}
        {pendingBookings.map((booking) => {
          const isBusy = busy === `booking-${booking.id}`;
          return (
            <article className="trainer-booking-card" key={booking.id} aria-busy={isBusy}>
              <div className="trainer-booking-card__identity"><span>{booking.id}</span><h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3></div>
              <dl>
                <div><dt>วันและเวลา</dt><dd>{formatDateTime(booking.startsAt)}</dd></div>
                <div><dt>สถานที่</dt><dd>{booking.location}</dd></div>
                <div><dt>หมายเหตุ</dt><dd>{booking.note || "ไม่มีหมายเหตุ"}</dd></div>
              </dl>
              <div className="queue-actions">
                <button type="button" disabled={isBusy} aria-label={`ตอบรับคำขอ ${booking.id}`} onClick={() => void decideBooking(booking.id, "accept")}>{isBusy ? "กำลังบันทึก…" : "ตอบรับ"}</button>
                <button type="button" disabled={isBusy} aria-label={`ปฏิเสธคำขอ ${booking.id}`} onClick={() => void decideBooking(booking.id, "reject")}>ปฏิเสธ</button>
              </div>
            </article>
          );
        })}
        {pendingBookings.length === 0 && <div className="empty-state"><strong>ไม่มีคำขอที่รอคำตอบ</strong><p>เมื่อสมาชิกส่งคำขอ รายละเอียดจะปรากฏที่นี่</p></div>}
      </section>
    </div>
  );
}
