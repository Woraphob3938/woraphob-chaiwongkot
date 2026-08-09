"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, RefreshCw, Trash2 } from "lucide-react";
import { NextActionCard } from "@/components/dashboard-primitives";
import { StatusBadge } from "@/components/status-badge";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { getTrainerNextAction } from "@/lib/dashboard-actions";
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
  const [completionError, setCompletionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ startsAt: "", endsAt: "" });
  const [quotedPrices, setQuotedPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllPending, setShowAllPending] = useState(false);
  const actionNoticeRef = useRef<HTMLParagraphElement>(null);
  const completionErrorRef = useRef<HTMLDivElement>(null);

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

  const refreshBookings = useCallback(async () => {
    const data = await authenticatedRequest<Booking[]>("/v1/bookings");
    setBookings(data);
  }, []);

  const loadBookings = useCallback(async () => {
    try {
      await refreshBookings();
      setBookingError("");
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setBookingError(error instanceof Error ? error.message : "โหลดคำขอจองไม่สำเร็จ");
    }
  }, [refreshBookings]);

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
  const pendingBookings = bookings.filter((booking) => booking.status === "pending_trainer");
  const confirmedBookings = bookings.filter((booking) => booking.status === "confirmed");
  const nextAction = getTrainerNextAction(workspace, bookings);
  const actionBookingId = nextAction.href.match(/#booking-(.+)$/)?.[1];
  const prioritizedPendingBookings = actionBookingId
    ? [
        ...pendingBookings.filter((booking) => booking.id === actionBookingId),
        ...pendingBookings.filter((booking) => booking.id !== actionBookingId),
      ]
    : pendingBookings;
  const visiblePendingBookings = showAllPending ? prioritizedPendingBookings : prioritizedPendingBookings.slice(0, 3);
  const slots = workspace?.slots ?? [];
  const todaySlotCount = slots.filter((slot) => {
    const startsAt = new Date(slot.startsAt);
    return startsAt.getFullYear() === now.getFullYear()
      && startsAt.getMonth() === now.getMonth()
      && startsAt.getDate() === now.getDate();
  }).length;
  const upcomingSlots = slots
    .filter((slot) => new Date(slot.startsAt).getTime() >= now.getTime())
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime());

  async function createSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAvailabilityError("");
    setActionNotice("");
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
      setActionNotice("เพิ่มช่วงเวลาว่างแล้ว");
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
    setActionNotice("");
    setBusy(`slot-${slotId}`);
    try {
      await authenticatedRequest(`/v1/availability-slots/${slotId}`, { method: "DELETE" });
      await loadWorkspace();
      setActionNotice("ลบช่วงเวลาว่างแล้ว");
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
    setActionNotice("");
    try {
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/status`, {
        method: "PATCH",
        body: JSON.stringify(decision === "accept"
          ? { status: target, quotedPrice: quotedPrices[bookingId] ?? "" }
          : { status: target }),
      });
      await Promise.all([loadWorkspace(), loadBookings()]);
      setActionNotice(`${decision === "accept" ? "ตอบรับ" : "ปฏิเสธ"}คำขอ ${bookingId} แล้ว`);
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setBookingError(error instanceof Error ? error.message : "บันทึกผลคำขอไม่สำเร็จ");
      if (error instanceof ApiError && error.status === 409) {
        setActionNotice("คำขอนี้ถูกเปลี่ยนสถานะแล้ว ระบบได้โหลดข้อมูลล่าสุดให้คุณ");
        await Promise.all([loadWorkspace(), loadBookings()]);
      }
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
      try {
        await refreshBookings();
        setBookingError("");
      } catch (error) {
        if (leaveExpiredSession(error)) return;
        setCompletionError("บันทึกว่าฝึกเสร็จแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setActionNotice(`บันทึกว่าคำขอ ${bookingId} ฝึกเสร็จแล้ว`);
    } catch (error) {
      if (leaveExpiredSession(error)) return;
      setCompletionError(error instanceof Error ? error.message : "บันทึกการฝึกเสร็จแล้วไม่สำเร็จ");
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
      if (leaveExpiredSession(error)) return;
      setCompletionError("ยังโหลดรายการนัดหมายล่าสุดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setBusy(null);
    }
  }

  function renderPendingBooking(booking: Booking) {
    const isBusy = busy === `booking-${booking.id}`;
    const rawQuote = quotedPrices[booking.id] ?? "";
    const quoteAmount = Number(rawQuote);
    const hasValidQuote = rawQuote.trim() !== "" && Number.isFinite(quoteAmount) && quoteAmount > 0;

    return (
      <details
        className="trainer-booking-summary"
        data-testid="trainer-booking-summary"
        open={booking.id === actionBookingId || undefined}
        id={`booking-${booking.id}`}
        key={booking.id}
      >
        <summary>
          <span><strong>{booking.member?.displayName ?? "สมาชิก FitConnect"}</strong><small>{booking.id}</small></span>
          <span>{formatDateTime(booking.startsAt)}</span>
          <span className="trainer-disclosure-label">ดูรายละเอียด</span>
        </summary>
        <article className="trainer-booking-card" aria-busy={isBusy}>
          <dl>
            <div><dt>วันและเวลา</dt><dd>{formatDateTime(booking.startsAt)}</dd></div>
            <div><dt>สถานที่</dt><dd>{booking.location}</dd></div>
            <div><dt>หมายเหตุ</dt><dd>{booking.note || "ไม่มีหมายเหตุ"}</dd></div>
          </dl>
          <div>
            <div className="field">
              <label htmlFor={`quote-${booking.id}`}>ค่าฝึกสำหรับคำขอ {booking.id}</label>
              <input
                id={`quote-${booking.id}`}
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={rawQuote}
                disabled={isBusy}
                onChange={(event) => setQuotedPrices((current) => ({ ...current, [booking.id]: event.target.value }))}
              />
            </div>
            <div className="queue-actions">
              <button type="button" disabled={isBusy || !hasValidQuote} aria-label={`ตอบรับคำขอ ${booking.id}`} onClick={() => void decideBooking(booking.id, "accept")}>{isBusy ? "กำลังบันทึก…" : "ตอบรับ"}</button>
              <button type="button" disabled={isBusy} aria-label={`ปฏิเสธคำขอ ${booking.id}`} onClick={() => void decideBooking(booking.id, "reject")}>ปฏิเสธ</button>
            </div>
          </div>
        </article>
      </details>
    );
  }

  function renderConfirmedBooking(booking: Booking) {
    const isBusy = busy === `booking-${booking.id}`;
    return (
      <article className="trainer-booking-card" key={booking.id} aria-busy={isBusy}>
        <div className="trainer-booking-card__identity"><span>{booking.id}</span><h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3></div>
        <dl>
          <div><dt>เริ่มฝึก</dt><dd>{formatDateTime(booking.startsAt)}</dd></div>
          <div><dt>สิ้นสุด</dt><dd>{formatDateTime(booking.endsAt)}</dd></div>
          <div><dt>สถานที่</dt><dd>{booking.location}</dd></div>
        </dl>
        <div className="queue-actions">
          {!booking.actions.canComplete && <span>ฝึกเสร็จได้หลัง {formatDateTime(booking.endsAt)}</span>}
          <button type="button" disabled={!booking.actions.canComplete || isBusy} aria-label={`ฝึกเสร็จแล้ว ${booking.id}`} onClick={() => void completeBooking(booking.id)}>
            {isBusy ? "กำลังบันทึก…" : "ฝึกเสร็จแล้ว"}
          </button>
        </div>
      </article>
    );
  }

  if (loading && !workspace) {
    return <section className="queue-loading" aria-live="polite">กำลังเตรียมโต๊ะทำงานเทรนเนอร์…</section>;
  }

  if (workspace?.profile === null) {
    return (
      <div className="trainer-workbench">
        <section className="approval-panel approval-panel--empty">
          <div><h2>ยังไม่มีโปรไฟล์เทรนเนอร์</h2><p>ส่งข้อมูลและใบรับรองก่อนเปิดตารางให้สมาชิกจอง</p></div>
          {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
        </section>
        <NextActionCard action={nextAction} />
      </div>
    );
  }

  return (
    <div className="trainer-workbench">
      <section className="approval-panel" id="approval-status">
        <div>
          <h2>{approved ? "โปรไฟล์พร้อมเปิดตาราง" : "โปรไฟล์ยังเปิดตารางไม่ได้"}</h2>
          <p>{workspace?.profile?.approvalNote ?? (approved ? "สร้างช่วงเวลาว่างล่วงหน้าได้ไม่เกิน 2 เดือน" : "รอผู้ดูแลตรวจใบรับรองก่อนสร้างช่วงเวลาว่าง")}</p>
        </div>
        {workspace?.profile && <StatusBadge status={workspace.profile.approvalStatus} />}
        {workspaceError && <div className="workbench-error" role="alert"><span>{workspaceError}</span><button type="button" onClick={() => void loadWorkspace()}>ลองใหม่</button></div>}
      </section>

      <NextActionCard action={nextAction} />
      {actionNotice && <p ref={actionNoticeRef} className="queue-notice workbench-success" role="status" tabIndex={-1}>{actionNotice}</p>}

      <section className="trainer-overview" id="schedule" aria-labelledby="trainer-overview-title">
        <div><h2 id="trainer-overview-title">ภาพรวมตารางว่าง</h2><p>ข้อมูลจากตารางและนัดหมายปัจจุบัน</p></div>
        <dl>
          <div><dt>ช่วงเวลาวันนี้</dt><dd>{todaySlotCount}</dd></div>
          <div><dt>ช่วงเวลาข้างหน้า</dt><dd>{upcomingSlots.length}</dd></div>
          <div><dt>นัดยืนยันแล้ว</dt><dd>{confirmedBookings.length}</dd></div>
        </dl>
        <p>{upcomingSlots[0] ? `ช่วงเวลาถัดไป ${formatDateTime(upcomingSlots[0].startsAt)}` : "ยังไม่มีช่วงเวลาข้างหน้า"}</p>
      </section>

      <section className="trainer-booking-list" aria-labelledby="trainer-requests-title">
        <div className="section-line-heading"><div><h2 id="trainer-requests-title">คำขอที่รอคำตอบ</h2><p>เปิดรายละเอียดเฉพาะรายการที่ต้องตัดสินใจ</p></div><span className="queue-count">{String(pendingBookings.length).padStart(2, "0")}</span></div>
        {bookingError && <div className="workbench-error" role="alert"><span>{bookingError}</span><button type="button" onClick={() => void loadBookings()}><RefreshCw aria-hidden="true" size={15} /> ลองใหม่</button></div>}
        {visiblePendingBookings.slice(0, 3).map(renderPendingBooking)}
        {pendingBookings.length > 3 && (
          <details className="trainer-list-disclosure" onToggle={(event) => setShowAllPending(event.currentTarget.open)}>
            <summary>ดูคำขอทั้งหมด</summary>
            {showAllPending && visiblePendingBookings.slice(3).map(renderPendingBooking)}
          </details>
        )}
        {pendingBookings.length === 0 && <div className="empty-state"><strong>ไม่มีคำขอที่รอคำตอบ</strong><p>เมื่อสมาชิกส่งคำขอ รายละเอียดจะปรากฏที่นี่</p></div>}
      </section>

      <details
        className="trainer-disclosure trainer-availability"
        id="availability"
        key={nextAction.href === "/trainer#availability" ? "availability-action" : "availability-idle"}
        open={nextAction.href === "/trainer#availability" || undefined}
      >
        <summary><span><CalendarPlus aria-hidden="true" size={20} /><strong>จัดการช่วงเวลาว่าง</strong></span><small>{slots.length} ช่วงเวลา</small></summary>
        <form className="availability-form" onSubmit={createSlot}>
          <label>
            <span>เริ่มต้น</span>
            <input type="datetime-local" required min={localInputValue(now)} max={localInputValue(maxDate)} value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} disabled={!approved || busy === "slot-create"} aria-invalid={Boolean(fieldErrors.startsAt)} aria-describedby={fieldErrors.startsAt ? "availability-start-error" : undefined} />
            {fieldErrors.startsAt && <small id="availability-start-error" className="field-error">{fieldErrors.startsAt}</small>}
          </label>
          <label>
            <span>สิ้นสุด</span>
            <input type="datetime-local" required min={form.startsAt || localInputValue(now)} max={localInputValue(maxDate)} value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} disabled={!approved || busy === "slot-create"} aria-invalid={Boolean(fieldErrors.endsAt)} aria-describedby={fieldErrors.endsAt ? "availability-end-error" : undefined} />
            {fieldErrors.endsAt && <small id="availability-end-error" className="field-error">{fieldErrors.endsAt}</small>}
          </label>
          <button className="button button--accent" type="submit" disabled={!approved || busy === "slot-create"}>{busy === "slot-create" ? "กำลังเพิ่ม…" : "เพิ่มช่วงเวลาว่าง"}</button>
        </form>
        {availabilityError && <p className="row-error" role="alert">{availabilityError}</p>}
        <div className="trainer-slot-list">
          {slots.map((slot) => {
            const canDelete = slot.state === "available" && new Date(slot.startsAt).getTime() > now.getTime();
            return (
              <div className="trainer-slot-row" key={slot.id} aria-busy={busy === `slot-${slot.id}`}>
                <span><strong>{formatDateTime(slot.startsAt)}</strong><small>{slot.state === "available" ? "สมาชิกจองได้" : "มีคำขอใช้ช่วงเวลานี้"}</small></span>
                {canDelete && <button type="button" disabled={busy === `slot-${slot.id}`} onClick={() => void deleteSlot(slot.id)} aria-label={`ลบช่วงเวลา ${formatDateTime(slot.startsAt)}`}><Trash2 aria-hidden="true" size={16} /> ลบ</button>}
              </div>
            );
          })}
          {slots.length === 0 && <div className="empty-state"><strong>ยังไม่มีช่วงเวลาว่าง</strong><p>เพิ่มช่วงเวลาแรกเมื่อโปรไฟล์ได้รับการอนุมัติ</p></div>}
        </div>
      </details>

      <section className="trainer-booking-list" aria-labelledby="trainer-confirmed-title">
        <details className="trainer-disclosure">
          <summary><span><strong id="trainer-confirmed-title">นัดหมายที่ยืนยันแล้ว</strong><small>เปิดเพื่อจัดการและบันทึกผลหลังเวลานัด</small></span><span className="queue-count">{String(confirmedBookings.length).padStart(2, "0")}</span></summary>
          {completionError && (
            <div ref={completionErrorRef} className="workbench-error" role="alert" tabIndex={-1}>
              <span>{completionError}</span>
              <button type="button" disabled={busy === "bookings-refresh"} onClick={() => void retryBookingRefresh()}>
                <RefreshCw aria-hidden="true" size={15} /> {busy === "bookings-refresh" ? "กำลังโหลด…" : "ลองโหลดใหม่"}
              </button>
            </div>
          )}
          {confirmedBookings.map(renderConfirmedBooking)}
          {confirmedBookings.length === 0 && <div className="empty-state"><strong>ยังไม่มีนัดที่ยืนยันแล้ว</strong><p>นัดหมายจะย้ายมาที่นี่หลังผู้ดูแลอนุมัติการชำระเงิน</p></div>}
        </details>
      </section>
    </div>
  );
}
