import type { Booking, BookingStatus } from "@/lib/types";

/**
 * One Thai label per status, shared by every surface that reports it. Three
 * copies of this table had drifted apart, so every surface reads it from here.
 */
export const paymentStatusCopy: Record<Booking["paymentStatus"], string> = {
  not_submitted: "ยังไม่ชำระ",
  reviewing: "รอตรวจสอบการชำระ",
  approved: "ชำระสำเร็จ",
  rejected: "ชำระไม่สำเร็จ",
};

export const bookingStatusCopy: Record<BookingStatus, string> = {
  pending_trainer: "รอเทรนเนอร์ตอบรับ",
  awaiting_payment: "รอชำระเงิน",
  payment_review: "รอตรวจสอบการชำระ",
  confirmed: "ชำระแล้ว",
  completed: "เสร็จสิ้น",
  cancelled: "ยกเลิก",
  expired: "หมดเวลา",
};

function labelFrom<T extends string>(table: Record<string, string>, value: T | string): string {
  return table[value] ?? value;
}

export function paymentStatusLabel(value: Booking["paymentStatus"] | string): string {
  return labelFrom(paymentStatusCopy, value);
}

export function bookingStatusLabel(value: BookingStatus | string): string {
  return labelFrom(bookingStatusCopy, value);
}

/** Baht amounts carry satang on every surface that shows what was paid. */
export function formatAmount(amount: number | null): string {
  if (amount === null) return "ไม่มียอดที่บันทึก";
  return `${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} บาท`;
}
