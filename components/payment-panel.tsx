"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, Copy, Landmark, RefreshCw, ShieldCheck } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { apiAssetUrl, authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";
import { DisclosureSection } from "@/components/disclosure-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskPromptPayId, promptPayPayload } from "@/lib/promptpay";
import { readSlipQr } from "@/lib/slip-qr";
import { formatAmount, formatBankAccountNumber, paymentStatusCopy } from "@/lib/payment-copy";

const MAX_SLIP_SIZE = 5 * 1024 * 1024;
const ACCEPTED_SLIP_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type PaymentPanelProps = {
  booking: Booking;
  onUpdated: () => Promise<void> | void;
};

function isPendingTrainer(booking: { status: string }) {
  return booking.status === "pending_trainer";
}

export function PaymentPanel({ booking, onUpdated }: PaymentPanelProps) {
  const amountId = useId();
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // The raw text of the slip's QR, read in the browser. The server decides
  // whether it counts; "unreadable" still uploads.
  const [slipQr, setSlipQr] = useState<string | null>(null);
  const [slipQrState, setSlipQrState] = useState<"idle" | "reading" | "read" | "unreadable">("idle");
  const readTokenRef = useRef(0);
  // Sending waits for an unfinished read instead of blocking the button.
  const readPromiseRef = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl && typeof URL?.revokeObjectURL === "function") {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

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
    if (previewUrl && typeof URL?.revokeObjectURL === "function") {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    setSlipQr(null);
    setSlipQrState("idle");
    readPromiseRef.current = null;
    const readToken = ++readTokenRef.current;
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
    if (file.type.startsWith("image/") && typeof URL?.createObjectURL === "function") {
      setPreviewUrl(URL.createObjectURL(file));
    }
    setFieldErrors((current) => ({ ...current, slip: undefined }));
    if (file.type.startsWith("image/")) {
      setSlipQrState("reading");
      const reading = readSlipQr(file).catch(() => null);
      readPromiseRef.current = reading;
      void reading.then((payload) => {
        // A newer pick wins over a slower read of an older one.
        if (readToken !== readTokenRef.current) return;
        setSlipQr(payload);
        setSlipQrState(payload ? "read" : "unreadable");
      });
    }
    // A PDF slip is not scanned; the trainer checks it as before.
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || uploaded || !booking.actions.canPay || !validate() || !slip) return;

    busyRef.current = true;
    setBusy(true);
    setNotice("");
    setRequestError(null);
    setRequestMessage("");

    const body = new FormData();
    body.set("bookingId", booking.id);
    body.set("slip", slip);
    const qrPayload = slipQr ?? (readPromiseRef.current ? await readPromiseRef.current : null);
    if (qrPayload) body.set("slipQr", qrPayload);

    try {
      await authenticatedRequest("/v1/payments", { method: "POST", body });
      setUploaded(true);
      setNotice("ส่งสลิปให้เทรนเนอร์ตรวจแล้ว การจองจะยืนยันเมื่อเทรนเนอร์พบยอดเงินในบัญชี");
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
  // The exact amount to transfer: the price plus this booking's own satang,
  // so the trainer can match the credit to this booking. Older bookings fall
  // back to the price.
  const payAmount = booking.transferAmount ?? booking.quotedPrice;
  const hasSatang = booking.transferAmount != null && Math.round(booking.transferAmount * 100) % 100 !== 0;
  const canUpload = booking.actions.canPay && !uploaded && booking.paymentRecipient !== null && booking.paymentRecipient !== undefined && payAmount !== null;
  const visiblePaymentStatus = uploaded ? paymentStatusCopy.reviewing : paymentStatusCopy[booking.paymentStatus];
  const qrPayload = canUpload ? promptPayPayload(booking.paymentRecipient!.promptPayId, payAmount!) : null;
  const recipientQrUrl = canUpload ? booking.paymentRecipient!.paymentQrUrl ?? null : null;

  // While the request still waits for the trainer's answer there is nothing to
  // pay yet: no QR, no upload form, no clock. The whole panel steps aside.
  if (isPendingTrainer(booking)) return null;

  return (
    <section className="payment-panel guided-transaction-panel" aria-labelledby={`${amountId}-title`}>
      <div className="transaction-status-summary">
        <span>สถานะหลักฐาน</span>
        <strong id={`${amountId}-title`}>{visiblePaymentStatus}</strong>
        {booking.payment?.reviewNote && (
          <p><span>หมายเหตุจากเทรนเนอร์</span>{booking.payment.reviewNote}</p>
        )}
      </div>

      {canUpload && (
        <form className="booking-fields payment-panel__form transaction-primary-action" onSubmit={submit} aria-busy={busy} noValidate>
          <div className="transaction-primary-action__heading">
            <strong>{booking.paymentStatus === "rejected" ? "สลิปไม่ผ่าน ส่งใหม่ได้อีกหนึ่งครั้งภายในเวลาที่เหลือ" : "อัปโหลดสลิปภายในเวลาที่เหลือ"}</strong>
            <span>{booking.paymentServiceMode === "freelance" ? "เทรนเนอร์ตรวจหลักฐานด้วยตนเอง" : booking.paymentServiceMode === "gym" ? "ยอดเงินเข้าบัญชียิม และเทรนเนอร์ที่คุณจองเป็นผู้ตรวจสลิป" : "เทรนเนอร์ที่คุณจองเป็นผู้ตรวจสลิป"}</span>
          </div>
          <div className="payment-qr-card">
            <div className="payment-qr-card__code">
              {/* The trainer's own uploaded QR leads, because that is the account
                  they chose to present. The generated QR (amount included) stays
                  one disclosure away for a member who would rather not type it. */}
              {recipientQrUrl ? (
                <Image
                  src={apiAssetUrl(recipientQrUrl) as string}
                  alt={`QR รับเงินของ ${booking.paymentRecipient!.accountName}`}
                  width={184}
                  height={184}
                  unoptimized
                />
              ) : (
                <QRCodeSVG value={qrPayload!} size={184} level="M" title={`QR พร้อมเพย์สำหรับ ${booking.paymentRecipient!.accountName}`} />
              )}
            </div>
            <div className="payment-qr-card__details">
              <span>สแกนด้วยแอปธนาคาร</span>
              <strong>{booking.paymentRecipient!.accountName}</strong>
              <p>พร้อมเพย์ {maskPromptPayId(booking.paymentRecipient!.promptPayId)}</p>
              <p className="payment-qr-card__amount">{formatAmount(payAmount)}</p>
              {hasSatang && (
                <small className="payment-qr-card__exact">โอนให้ตรงถึงสตางค์ เศษสตางค์นี้ใช้ระบุว่าเป็นการจองของคุณ</small>
              )}
              {recipientQrUrl && (
                <small className="payment-qr-card__note">
                  QR นี้เป็นภาพที่เทรนเนอร์อัปโหลด ตรวจชื่อผู้รับในแอปให้ตรงก่อนโอน แล้วกรอกยอด {formatAmount(payAmount)} ให้ตรงถึงสตางค์
                </small>
              )}
              <Button className="button" type="button" disabled={busy} onClick={() => {
                void navigator.clipboard.writeText(booking.paymentRecipient!.promptPayId).then(() => setNotice("คัดลอกหมายเลขพร้อมเพย์แล้ว"));
              }}>
                <Copy aria-hidden="true" size={16} /> คัดลอกพร้อมเพย์
              </Button>
            </div>
          </div>
          {booking.paymentRecipient!.bankAccount && (
            <div className="payment-bank-card" aria-label="โอนเข้าบัญชีธนาคาร">
              <div className="payment-bank-card__icon" aria-hidden="true"><Landmark size={20} /></div>
              <div className="payment-bank-card__details">
                <span>หรือโอนเข้าบัญชีธนาคาร</span>
                <strong>{booking.paymentRecipient!.bankAccount.bankName}</strong>
                <p>{booking.paymentRecipient!.bankAccount.accountName}</p>
                <p className="payment-bank-card__number">{formatBankAccountNumber(booking.paymentRecipient!.bankAccount.accountNumber)}</p>
              </div>
              <Button className="button" type="button" disabled={busy} onClick={() => {
                void navigator.clipboard.writeText(booking.paymentRecipient!.bankAccount!.accountNumber).then(() => setNotice("คัดลอกเลขบัญชีแล้ว"));
              }}>
                <Copy aria-hidden="true" size={16} /> คัดลอกเลขบัญชี
              </Button>
            </div>
          )}
          {recipientQrUrl && (
            <details className="trainer-disclosure payment-qr-generated">
              <summary>
                <span><strong>หรือใช้ QR พร้อมยอดเงิน</strong></span>
                <small>{formatAmount(payAmount)}</small>
                <ChevronDown className="trainer-disclosure__chevron" aria-hidden="true" size={18} />
              </summary>
              <div className="payment-qr-card__code">
                <QRCodeSVG value={qrPayload!} size={184} level="M" title={`QR พร้อมเพย์สำหรับ ${booking.paymentRecipient!.accountName}`} />
              </div>
              <p className="profile-group__hint">QR นี้สร้างจากพร้อมเพย์ของเทรนเนอร์และมียอดเงินในตัว ไม่ต้องกรอกยอดเอง</p>
            </details>
          )}
          <div className="form-grid">
            <div className="field field--full">
              <Label htmlFor={slipId}>หลักฐานการโอน</Label>
              <Input
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
              {slipQrState !== "idle" && (
                <small className={`payment-slip-qr is-${slipQrState}`} role="status">
                  {slipQrState === "reading" && "กำลังอ่าน QR ในสลิป…"}
                  {slipQrState === "read" && "อ่าน QR ในสลิปได้ ระบบจะตรวจว่าสลิปนี้ไม่เคยใช้มาก่อน"}
                  {slipQrState === "unreadable" && "อ่าน QR ในสลิปไม่ได้ ส่งได้ตามปกติ แต่ควรใช้ภาพสลิปจากแอปธนาคารโดยตรงที่เห็น QR ชัด"}
                </small>
              )}
              {previewUrl && (
                <div className="payment-slip-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={previewUrl} alt="ตัวอย่างสลิปที่เลือก" />
                </div>
              )}
              {fieldErrors.slip && <small className="field-error" id={slipErrorId}>{fieldErrors.slip}</small>}
            </div>
          </div>
          <p className="payment-bank-check-note"><ShieldCheck aria-hidden="true" size={18} /> เทรนเนอร์จะยืนยันหลังพบยอดนี้ในรายการเงินจริงของแอปธนาคาร</p>
          <Button className="button button--accent" type="submit" disabled={busy}>
            {busy ? "กำลังส่งสลิป…" : requestError === "upload" ? "ลองส่งอีกครั้ง" : "ส่งสลิปให้ตรวจ"}
          </Button>
        </form>
      )}

      {booking.actions.canPay && !uploaded && !canUpload && (
        <div className="workbench-error" role="alert">เทรนเนอร์ยังไม่ได้ตั้งค่าพร้อมเพย์ กรุณาติดต่อเทรนเนอร์ก่อนชำระเงิน</div>
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
      <DisclosureSection title="รายละเอียดหลักฐานเดิม" summary={booking.payment ? "มีหลักฐานที่เคยส่ง" : "ยังไม่มีหลักฐานเดิม"}>
        <div className="ledger-row"><span>รหัสคำขอ</span><strong>{booking.id}</strong></div>
        <div className="ledger-row"><span>เทรนเนอร์</span><strong>{booking.trainer.displayName}</strong></div>
        <div className="ledger-row"><span>{booking.bookingType === "monthly" ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง"}</span><strong>{formatAmount(booking.quotedPrice)}</strong></div>
        {booking.transferAmount != null && <div className="ledger-row"><span>ยอดที่ต้องโอน</span><strong>{formatAmount(booking.transferAmount)}</strong></div>}
        <div className="ledger-row"><span>ยอดที่เคยส่ง</span><strong>{formatAmount(booking.payment?.amount ?? null)}</strong></div>
      </DisclosureSection>
    </section>
  );
}
