import type { Booking, BookingStatus } from "@/lib/types";

/**
 * One Thai label per status, shared by every surface that reports it. Three
 * copies of this table had drifted apart: the administrator queue said a slip
 * was "อนุมัติแล้ว" while the member's own ledger said "ตรวจสลิปแล้ว".
 */
export const paymentStatusCopy: Record<Booking["paymentStatus"], string> = {
  not_submitted: "ยังไม่ส่งหลักฐาน",
  reviewing: "รอตรวจสลิป",
  approved: "ตรวจสลิปแล้ว",
  rejected: "ต้องส่งหลักฐานใหม่",
};

export const bookingStatusCopy: Record<BookingStatus, string> = {
  pending_trainer: "รอเทรนเนอร์ตอบรับ",
  awaiting_payment: "รอชำระเงิน",
  payment_review: "รอตรวจสลิป",
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

/** Baht amounts carry satang on every surface that shows what was transferred. */
export function formatAmount(amount: number | null): string {
  if (amount === null) return "ไม่มียอดที่บันทึก";
  return `${new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)} บาท`;
}

/** 1234567890 → 123-4-56789-0, the grouping Thai bank books print. */
export function formatBankAccountNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 10) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 4)}-${digits.slice(4, 9)}-${digits.slice(9)}`;
}
