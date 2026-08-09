"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

const MAX_SLIP_SIZE = 5 * 1024 * 1024;
const ACCEPTED_SLIP_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const paymentStatusCopy: Record<Booking["paymentStatus"], string> = {
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

type PaymentPanelProps = {
  booking: Booking;
  onUpdated: () => Promise<void> | void;
};

export function PaymentPanel({ booking, onUpdated }: PaymentPanelProps) {
  const slipId = useId();
  const [slip, setSlip] = useState<File | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ slip?: string }>({});
  const [requestError, setRequestError] = useState<"upload" | "refresh" | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const busyRef = useRef(false);
  const feedbackRef = useRef<HTMLDivElement | HTMLParagraphElement>(null);

  useEffect(() => {
    if (requestMessage || notice) feedbackRef.current?.focus();
  }, [notice, requestMessage]);

  function validate(): boolean {
    const nextErrors: { slip?: string } = {};
    if (!slip) {
      nextErrors.slip = "กรุณาเลือกไฟล์หลักฐานการโอน";
    } else if (!ACCEPTED_SLIP_TYPES.has(slip.type)) {
      nextErrors.slip = "รองรับเฉพาะไฟล์ JPEG, PNG, WebP หรือ PDF";
    } else if (slip.size > MAX_SLIP_SIZE) {
      nextErrors.slip = "ไฟล์ต้องมีขนาดไม่เกิน 5 MB";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  function selectSlip(file: File | null) {
    setNotice("");
    setRequestError(null);
    setRequestMessage("");
    if (!file) {
      setSlip(null);
      setFieldErrors((current) => ({ ...current, slip: "กรุณาเลือกไฟล์หลักฐานการโอน" }));
      return;
    }
    if (!ACCEPTED_SLIP_TYPES.has(file.type)) {
      setSlip(null);
      setFieldErrors((current) => ({ ...current, slip: "รองรับเฉพาะไฟล์ JPEG, PNG, WebP หรือ PDF" }));
      return;
    }
    if (file.size > MAX_SLIP_SIZE) {
      setSlip(null);
      setFieldErrors((current) => ({ ...current, slip: "ไฟล์ต้องมีขนาดไม่เกิน 5 MB" }));
      return;
    }
    setSlip(file);
    setFieldErrors((current) => ({ ...current, slip: undefined }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || uploaded || !booking.actions.canPay || !validate() || !slip) return;

    busyRef.current = true;
    setBusy(true);
    setNotice("");
    setRequestError(null);
    setRequestMessage("");

    const paymentAmount = booking.quotedPrice ?? 500;
    const body = new FormData();
    body.set("bookingId", booking.id);
    body.set("amount", String(paymentAmount));
    body.set("slip", slip);

    try {
      await authenticatedRequest("/v1/payments", { method: "POST", body });
      setUploaded(true);
      setNotice("ส่งสลิปให้ผู้ดูแลตรวจแล้ว ผู้ดูแลจะตรวจหลักฐานด้วยตนเอง");
    } catch (error) {
      setRequestError("upload");
      setRequestMessage(error instanceof Error ? error.message : "อัปโหลดสลิปไม่สำเร็จ กรุณาลองอีกครั้ง");
      busyRef.current = false;
      setBusy(false);
      return;
    }

    try {
      await onUpdated();
    } catch {
      setNotice("");
      setRequestError("refresh");
      setRequestMessage("อัปโหลดสลิปแล้ว แต่โหลดสถานะล่าสุดไม่สำเร็จ");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function retryRefresh() {
    if (busyRef.current || !uploaded) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    setRequestMessage("");
    try {
      await onUpdated();
      setRequestError(null);
      setNotice("โหลดสถานะการชำระล่าสุดแล้ว");
    } catch {
      setRequestError("refresh");
      setRequestMessage("ยังโหลดสถานะล่าสุดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const slipErrorId = `${slipId}-error`;
  const slipGuideId = `${slipId}-guide`;
  const canUpload = booking.actions.canPay && !uploaded;

  return (
    <section className="payment-panel" aria-labelledby={`${slipId}-title`}>
      <div className="ledger-row">
        <span>หลักฐานการชำระ</span>
        <strong id={`${slipId}-title`}>ส่งสลิปให้ผู้ดูแลตรวจ</strong>
      </div>
      <div className="ledger-row"><span>รหัสคำขอ</span><strong>{booking.id}</strong></div>
      <div className="ledger-row"><span>เทรนเนอร์</span><strong>{booking.trainer.displayName}</strong></div>
      <div className="ledger-row"><span>ค่าฝึกที่แจ้ง</span><strong>{formatAmount(booking.quotedPrice)}</strong></div>
      <div className="ledger-row"><span>ยอดที่เคยส่ง</span><strong>{formatAmount(booking.payment?.amount ?? null)}</strong></div>
      <div className="ledger-row"><span>สถานะหลักฐาน</span><strong>{paymentStatusCopy[booking.paymentStatus]}</strong></div>
      {booking.payment?.status === "rejected" && booking.payment.reviewNote && (
        <div className="ledger-row"><span>หมายเหตุจากผู้ดูแล</span><strong>{booking.payment.reviewNote}</strong></div>
      )}

      {canUpload && (
        <form className="booking-fields payment-panel__form" onSubmit={submit} aria-busy={busy} noValidate>
          <div className="form-grid">
            <div className="field">
              <label htmlFor={slipId}>หลักฐานการโอน</label>
              <input
                className="payment-slip-input"
                id={slipId}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.slip)}
                aria-describedby={`${slipGuideId}${fieldErrors.slip ? ` ${slipErrorId}` : ""}`}
                onChange={(event) => selectSlip(event.target.files?.[0] ?? null)}
              />
              <small id={slipGuideId}>รองรับ JPEG, PNG, WebP หรือ PDF ขนาดไม่เกิน 5 MB</small>
              <output className="payment-selected-file" htmlFor={slipId}>
                {slip ? <>ไฟล์ที่เลือก: <strong>{slip.name}</strong></> : "ยังไม่ได้เลือกไฟล์"}
              </output>
              {fieldErrors.slip && <small className="field-error" id={slipErrorId}>{fieldErrors.slip}</small>}
            </div>
          </div>
          <button className="button button--accent" type="submit" disabled={busy}>
            {busy ? "กำลังส่งสลิป…" : requestError === "upload" ? "ลองส่งอีกครั้ง" : "ส่งสลิปให้ตรวจ"}
          </button>
        </form>
      )}

      {!booking.actions.canPay && !uploaded && (
        <div className="ledger-row"><span>การส่งหลักฐาน</span><strong>ยังส่งสลิปไม่ได้ตามสถานะการจองนี้</strong></div>
      )}
      {requestMessage && (
        <div ref={feedbackRef as React.RefObject<HTMLDivElement>} className="workbench-error" role="alert" tabIndex={-1}>
          <span>{requestMessage}</span>
          {requestError === "refresh" && (
            <button type="button" disabled={busy} onClick={() => void retryRefresh()}>
              <RefreshCw aria-hidden="true" size={15} /> {busy ? "กำลังโหลด…" : "ลองโหลดสถานะใหม่"}
            </button>
          )}
        </div>
      )}
      {notice && <p ref={feedbackRef as React.RefObject<HTMLParagraphElement>} className="queue-notice" role="status" tabIndex={-1}>{notice}</p>}
    </section>
  );
}
