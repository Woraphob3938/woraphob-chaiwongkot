"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CreditCard, LockKeyhole, QrCode } from "lucide-react";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";
import { DisclosureSection } from "@/components/disclosure-section";
import { Button } from "@/components/ui/button";
import { formatAmount, paymentStatusCopy } from "@/lib/payment-copy";

type PaymentPanelProps = {
  booking: Booking;
  onUpdated: () => Promise<void> | void;
  /** Sends the browser to Stripe Checkout; replaced in tests. */
  redirect?: (url: string) => void;
};

type CheckoutResponse = { bookingId: string; checkoutUrl: string };

function isPendingTrainer(booking: { status: string }) {
  return booking.status === "pending_trainer";
}

const steps = [
  { title: "กดปุ่ม “ชำระเงิน”", detail: "ระบบพาไปหน้าชำระเงินที่ปลอดภัยของ Stripe" },
  { title: "เลือกวิธีชำระ", detail: "บัตรเครดิต/เดบิต หรือพร้อมเพย์ (สแกน QR ด้วยแอปธนาคาร)" },
  { title: "กลับมาที่หน้านี้", detail: "ระบบยืนยันการจองให้ทันที ไม่ต้องส่งหลักฐานการโอน" },
];

export function PaymentPanel({ booking, onUpdated, redirect = (url) => window.location.assign(url) }: PaymentPanelProps) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [requestMessage, setRequestMessage] = useState("");
  const busyRef = useRef(false);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (requestMessage) feedbackRef.current?.focus();
  }, [requestMessage]);

  async function startCheckout() {
    if (busyRef.current || !booking.actions.canPay) return;
    busyRef.current = true;
    setBusy(true);
    setRequestMessage("");
    try {
      const result = await authenticatedRequest<CheckoutResponse>("/v1/payments", {
        method: "POST",
        body: JSON.stringify({ bookingId: booking.id }),
      });
      // The page is left for Stripe; the button stays busy until it unloads.
      redirect(result.checkoutUrl);
    } catch (error) {
      setRequestMessage(error instanceof Error ? error.message : "เปิดหน้าชำระเงินไม่สำเร็จ กรุณาลองอีกครั้ง");
      busyRef.current = false;
      setBusy(false);
      try {
        // A booking paid in another tab answers "already paid"; reloading shows it confirmed.
        await onUpdated();
      } catch {
        // The message above already tells the member what to do next.
      }
    }
  }

  // While the request still waits for the trainer's answer there is nothing to
  // pay yet. The whole panel steps aside.
  if (isPendingTrainer(booking)) return null;

  const recipient = booking.paymentServiceMode === "gym"
    ? "ชำระให้ยิมผ่านระบบ FitConnect"
    : `ชำระให้ ${booking.trainer.displayName} ผ่านระบบ FitConnect`;

  return (
    <section className="payment-panel guided-transaction-panel pay-card" aria-labelledby={titleId}>
      <header className="pay-card__head">
        <div>
          <span className="pay-card__label">ยอดที่ต้องชำระ</span>
          <strong id={titleId} className="pay-card__amount">{formatAmount(booking.quotedPrice)}</strong>
          <span className="pay-card__for">
            {booking.bookingType === "monthly" ? `แพ็กเกจ ${booking.sessionCount} ครั้ง` : "ค่าฝึกรายครั้ง"} · {recipient}
          </span>
        </div>
        <span className={`pay-card__status pay-card__status--${booking.paymentStatus}`}>
          <span className="sr-only">สถานะการชำระเงิน </span>{paymentStatusCopy[booking.paymentStatus]}
        </span>
      </header>

      {booking.actions.canPay ? (
        <div className="pay-card__body">
          <ol className="pay-steps" aria-label="ขั้นตอนการชำระเงิน">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className="pay-steps__number" aria-hidden="true">{index + 1}</span>
                <span><strong>{step.title}</strong><small>{step.detail}</small></span>
              </li>
            ))}
          </ol>

          <ul className="pay-methods" aria-label="วิธีชำระที่รองรับ">
            <li><CreditCard aria-hidden="true" size={18} /> บัตร Visa / Mastercard</li>
            <li><QrCode aria-hidden="true" size={18} /> พร้อมเพย์</li>
          </ul>

          <Button className="button button--accent pay-card__cta" type="button" disabled={busy} onClick={() => void startCheckout()}>
            {busy ? "กำลังเปิดหน้าชำระเงิน…" : "ชำระเงิน"}
          </Button>
          <p className="pay-card__secure">
            <LockKeyhole aria-hidden="true" size={15} /> ข้อมูลบัตรกรอกบนหน้าของ Stripe โดยตรง FitConnect ไม่เห็นและไม่เก็บเลขบัตร
          </p>
        </div>
      ) : (
        <p className="pay-card__idle">ยังชำระเงินไม่ได้ตามสถานะการจองนี้</p>
      )}

      {requestMessage && (
        <div ref={feedbackRef} className="workbench-error" role="alert" tabIndex={-1}>
          <span>{requestMessage}</span>
        </div>
      )}
      <DisclosureSection title="รายละเอียดการชำระ" summary={booking.payment ? "มีรายการชำระเงิน" : "ยังไม่มีรายการชำระเงิน"}>
        <div className="ledger-row"><span>รหัสคำขอ</span><strong>{booking.id}</strong></div>
        <div className="ledger-row"><span>เทรนเนอร์</span><strong>{booking.trainer.displayName}</strong></div>
        <div className="ledger-row"><span>ยอดชำระ</span><strong>{formatAmount(booking.quotedPrice)}</strong></div>
      </DisclosureSection>
    </section>
  );
}
