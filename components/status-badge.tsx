import { CheckCircle2, Clock3, CircleX, type LucideIcon } from "lucide-react";
import type { BookingStatus, VerificationStatus } from "@/lib/types";

type Status = VerificationStatus | BookingStatus | "reviewing" | "approved" | "rejected";

const labels: Record<Status, string> = {
  verified: "ตรวจคุณสมบัติแล้ว",
  pending: "รอตรวจคุณสมบัติ",
  rejected: "ต้องแก้ไข",
  awaiting_payment: "รอชำระเงิน",
  payment_review: "รอตรวจสลิป",
  confirmed: "ยืนยันการชำระแล้ว",
  completed: "ฝึกเสร็จแล้ว",
  cancelled: "ยกเลิกแล้ว",
  expired: "หมดเวลาแล้ว",
  reviewing: "กำลังตรวจสอบ",
  approved: "อนุมัติแล้ว",
};

const iconByStatus: Record<Status, LucideIcon> = {
  verified: CheckCircle2,
  approved: CheckCircle2,
  confirmed: CheckCircle2,
  completed: CheckCircle2,
  pending: Clock3,
  awaiting_payment: Clock3,
  payment_review: Clock3,
  reviewing: Clock3,
  rejected: CircleX,
  cancelled: CircleX,
  expired: CircleX,
};

export function StatusBadge({ status }: { status: Status }) {
  const Icon = iconByStatus[status];
  const tone = ["verified", "approved", "confirmed", "completed"].includes(status)
    ? "success"
    : ["rejected", "cancelled", "expired"].includes(status)
      ? "error"
      : "warning";

  return (
    <span className={`status-badge status-badge--${tone}`}>
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
      {labels[status]}
    </span>
  );
}
