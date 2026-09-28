import { CheckCircle2, Clock3, CircleX, Wallet, type LucideIcon } from "lucide-react";
import { bookingStatusCopy, bookingStatusLabel, paymentStatusLabel } from "@/lib/payment-copy";
import type { Booking, BookingStatus, VerificationStatus } from "@/lib/types";

/**
 * One Thai label per status: `lib/payment-copy.ts` owns the booking and payment
 * words and this badge only decides which of those tables applies. A
 * verification status (a trainer profile, an application, a certificate) keeps
 * its own wording, which is why `verified`/`pending` are not routed through the
 * booking table.
 *
 * `rejected` and `approved` are single literals carrying two meanings: a slip
 * that must be sent again versus a profile that must be corrected, and a slip
 * that was checked versus an application that was approved. A caller rendering
 * a payment status says so with `source="payment"`; otherwise the status is
 * read as verification wording.
 */
export type StatusSource = "booking" | "payment" | "verification" | "approval";

type Status = VerificationStatus | BookingStatus | Booking["paymentStatus"];

const verificationLabels: Record<VerificationStatus, string> = {
  verified: "โปรไฟล์ผ่านการตรวจ",
  pending: "รอตรวจโปรไฟล์",
  rejected: "ต้องแก้ไข",
};

/** A trainer application is approved; only a slip is "ตรวจสลิปแล้ว". */
const applicationLabels = { approved: "อนุมัติแล้ว" } as const;

/**
 * A trainer's approval status, worded exactly as the administrator scope names
 * it. A rejected application is shown as suspended: the profile stays off the
 * marketplace until it is resubmitted and approved.
 */
const approvalLabels: Record<string, string> = {
  pending: "รออนุมัติ",
  approved: "อนุมัติแล้ว",
  rejected: "ถูกระงับ",
};

const bookingStatuses: ReadonlySet<string> = new Set(Object.keys(bookingStatusCopy));

function isBookingStatus(status: Status): status is BookingStatus {
  return bookingStatuses.has(status);
}

function labelFor(status: Status, source?: StatusSource): string {
  if (source === "payment") return paymentStatusLabel(status);
  if (source === "approval" && approvalLabels[status]) return approvalLabels[status];
  if (isBookingStatus(status)) return bookingStatusLabel(status);
  if (status === "approved") return applicationLabels.approved;
  if (status === "verified" || status === "pending" || status === "rejected") return verificationLabels[status];
  // `not_submitted` and `reviewing` carry no verification meaning.
  return paymentStatusLabel(status);
}

const iconByStatus: Record<Status, LucideIcon> = {
  verified: CheckCircle2,
  approved: CheckCircle2,
  confirmed: CheckCircle2,
  completed: CheckCircle2,
  pending: Clock3,
  pending_trainer: Clock3,
  awaiting_payment: Wallet,
  payment_review: Clock3,
  reviewing: Clock3,
  not_submitted: Clock3,
  rejected: CircleX,
  cancelled: CircleX,
  expired: CircleX,
};

export function StatusBadge({ status, source }: { status: Status; source?: StatusSource }) {
  const Icon = iconByStatus[status] ?? Clock3;
  // Owing money is the one state the member must act on now, so it does not
  // share the passive-waiting tone.
  const tone = status === "awaiting_payment"
    ? "action"
    : ["verified", "approved", "confirmed", "completed"].includes(status)
    ? "success"
    : ["rejected", "cancelled", "expired"].includes(status)
      ? "error"
      : "warning";

  return (
    <span className={`status-badge status-badge--${tone}`}>
      <Icon aria-hidden="true" size={15} strokeWidth={2} />
      {labelFor(status, source)}
    </span>
  );
}
