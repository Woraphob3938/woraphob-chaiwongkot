import { Check } from "lucide-react";
import type { Booking } from "@/lib/types";

/**
 * The booking path the system actually runs (บทที่ 1 ขั้นตอนที่ 1–5):
 * the member sends a request, the trainer accepts it and the system confirms
 * it to the member right away,
 * the member pays within 10 minutes, the trainer confirms the slip, and the
 * session happens. Every booking surface shows the same four steps.
 */
export const bookingSteps = [
  { title: "ส่งคำขอ", detail: "เลือกเวลาที่ต้องการ" },
  { title: "เทรนเนอร์ตอบรับ", detail: "แจ้งผลทันที" },
  { title: "รอการชำระเงิน", detail: "ชำระออนไลน์ภายใน 10 นาที" },
  { title: "จองสำเร็จ", detail: "ระบบยืนยันเมื่อชำระสำเร็จ" },
] as const;

/** Index of the step the booking is waiting on; 4 means every step is done. */
export function bookingStepIndex(booking: Pick<Booking, "status">): number {
  switch (booking.status) {
    case "pending_trainer": return 1;
    case "awaiting_payment": return 2;
    case "payment_review": return 3;
    case "confirmed":
    case "completed": return 4;
    default: return -1;
  }
}

export function BookingProgress({ current, className = "" }: { current: number; className?: string }) {
  return (
    <ol className={`booking-progress ${className}`.trim()} aria-label="ขั้นตอนการจอง">
      {bookingSteps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "upcoming";
        return (
          <li key={step.title} className={`booking-progress__step is-${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="booking-progress__marker" aria-hidden="true">
              {state === "done" ? <Check size={14} strokeWidth={3} /> : index + 1}
            </span>
            <span className="booking-progress__text">
              <strong>{step.title}</strong>
              <small>{step.detail}</small>
            </span>
            <span className="sr-only">{state === "done" ? "เสร็จแล้ว" : state === "current" ? "ขั้นตอนปัจจุบัน" : "ยังไม่ถึง"}</span>
          </li>
        );
      })}
    </ol>
  );
}
