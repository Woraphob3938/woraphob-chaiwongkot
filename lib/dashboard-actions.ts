import type { AdminQueue, Booking, TrainerWorkspace } from "@/lib/types";
import { formatDateTime } from "@/lib/format";

export type DashboardAction = {
  title: string;
  description: string;
  href: string;
  cta: string;
  state: "action" | "waiting" | "complete";
};

function memberBookingDescription(booking: Booking): string {
  return `${booking.trainer.displayName} · ${formatDateTime(booking.confirmedStartsAt ?? booking.startsAt)} · คำขอ ${booking.id}`;
}

export function hasValidBookingPeriod(booking: Pick<Booking, "startsAt" | "endsAt">): boolean {
  return new Date(booking.endsAt).getTime() > new Date(booking.startsAt).getTime();
}

export function getMemberNextAction(bookings: Booking[]): DashboardAction {
  // A request the trainer has not answered yet can still carry `canPay`, but the
  // payment panel renders nothing for that status, so the CTA would open a
  // booking whose upload form is empty. Waiting for the trainer comes after the
  // two actions the member can actually take, and before the later waiting states.
  const payment = bookings.find((booking) => booking.actions.canPay && booking.status !== "pending_trainer");
  if (payment) return { title: "ส่งหลักฐานการชำระเงิน", description: memberBookingDescription(payment), href: `/member#booking-${payment.id}`, cta: "อัปโหลดสลิป", state: "action" };

  const review = bookings.find((booking) => booking.actions.canReview);
  if (review) return { title: "แบ่งปันผลการฝึก", description: memberBookingDescription(review), href: `/member#booking-${review.id}`, cta: "เขียนรีวิว", state: "action" };

  const pendingTrainer = bookings.find((booking) => booking.status === "pending_trainer");
  if (pendingTrainer) return { title: "รอเทรนเนอร์ตอบรับคำขอ", description: memberBookingDescription(pendingTrainer), href: `/member#booking-${pendingTrainer.id}`, cta: "ดูสถานะ", state: "waiting" };

  const paymentReview = bookings.find((booking) => booking.status === "payment_review");
  if (paymentReview) return { title: "รอเทรนเนอร์ตรวจสลิป", description: memberBookingDescription(paymentReview), href: `/member#booking-${paymentReview.id}`, cta: "ดูสถานะ", state: "waiting" };

  const confirmed = bookings.find((booking) => booking.status === "confirmed");
  if (confirmed) return { title: "เตรียมตัวสำหรับการฝึก", description: memberBookingDescription(confirmed), href: `/member#booking-${confirmed.id}`, cta: "ดูนัดหมาย", state: "waiting" };

  return { title: "เริ่มค้นหาเทรนเนอร์", description: "เปรียบเทียบคุณสมบัติและตารางว่าง", href: "/trainers", cta: "ค้นหาเทรนเนอร์", state: "complete" };
}

export function getTrainerNextAction(workspace: TrainerWorkspace | null, bookings: Booking[], pendingSlips = 0): DashboardAction {
  if (!workspace?.profile) {
    return { title: "กรอกข้อมูลวิชาชีพให้ครบ", description: "บัญชีพร้อมแล้ว เหลือข้อมูลการให้บริการและใบรับรอง", href: "/trainer/apply", cta: "กรอกข้อมูลวิชาชีพ", state: "action" };
  }

  if (workspace.profile.approvalStatus === "pending") {
    return {
      title: "รอผู้ดูแลระบบตรวจใบสมัคร",
      description: "ยังไม่สามารถเปิดตารางได้จนกว่าจะได้รับอนุมัติ",
      href: "/trainer#approval-status",
      cta: "ดูสถานะการสมัคร",
      state: "waiting",
    };
  }

  if (workspace.profile.approvalStatus === "rejected") {
    return {
      title: "แก้ไขใบสมัครเทรนเนอร์",
      description: "ตรวจข้อมูลและส่งใบสมัครอีกครั้ง",
      href: "/trainer/apply",
      cta: "แก้ไขใบสมัคร",
      state: "action",
    };
  }

  // A freelance trainer is the reviewer of their own slips, and the member's
  // payment clock is running, so this outranks recording a session that is
  // already over.
  if (pendingSlips > 0) {
    return {
      title: "ตรวจสลิปที่รออยู่",
      description: `${pendingSlips} สลิปจากสมาชิกที่รอผลตรวจ`,
      href: "/trainer#payment-review",
      cta: "เปิดคิวตรวจสลิป",
      state: "action",
    };
  }

  // บทที่ 1: the trainer answers each request and picks the 12:00 or 18:00
  // round at which the member hears back;
  // the member cannot pay until then.
  const unanswered = (booking: Booking) => booking.status === "pending_trainer" && !booking.confirmationReleaseAt;
  const request = bookings.find(unanswered);
  if (request) {
    const memberName = request.member?.displayName ?? "สมาชิก FitConnect";
    const waiting = bookings.filter(unanswered).length;
    return {
      title: waiting > 1 ? `ตอบรับคำขอจอง ${waiting} รายการ` : "ตอบรับคำขอจอง",
      description: `${memberName} · ${formatDateTime(request.requestedStartsAt ?? request.startsAt)} · คำขอ ${request.id}`,
      href: `/trainer#request-${request.id}`,
      cta: "ตอบคำขอ",
      state: "action",
    };
  }

  const completable = bookings.find((booking) => booking.status === "confirmed" && booking.actions.canComplete && hasValidBookingPeriod(booking));
  if (completable) {
    const memberName = completable.member?.displayName ?? "สมาชิก FitConnect";
    return {
      title: "บันทึกผลการฝึก",
      description: `${memberName} · คำขอ ${completable.id}`,
      href: `/trainer#booking-${completable.id}`,
      cta: "บันทึกผลการฝึก",
      state: "action",
    };
  }

  // What matters is whether anything is still sellable, not how many rows the
  // availability table holds: a trainer whose slots are all booked has nothing
  // a member can choose.
  if (!workspace.slots.some((slot) => slot.state === "available")) {
    return { title: "เพิ่มช่วงเวลาว่าง", description: "กำหนดตารางเพื่อให้สมาชิกจองได้", href: "/trainer#availability", cta: "เพิ่มช่วงเวลาว่าง", state: "action" };
  }

  const upcoming = bookings
    .filter((booking) => booking.status === "confirmed")
    .slice()
    .sort((left, right) => new Date(left.confirmedStartsAt ?? left.startsAt).getTime() - new Date(right.confirmedStartsAt ?? right.startsAt).getTime())[0];
  if (upcoming) {
    const memberName = upcoming.member?.displayName ?? "สมาชิก FitConnect";
    return {
      title: `นัดถัดไป · ${memberName}`,
      description: formatDateTime(upcoming.confirmedStartsAt ?? upcoming.startsAt),
      href: upcoming.actions.canReadChat
        ? `/chat?booking=${encodeURIComponent(upcoming.id)}`
        : `/trainer#booking-${upcoming.id}`,
      cta: upcoming.actions.canReadChat ? "เปิดการสนทนา" : "ดูนัดหมาย",
      state: "waiting",
    };
  }

  return { title: "พร้อมดูแลสมาชิกแล้ว", description: "ตรวจนัดหมายและช่วงเวลาที่เปิดรับจอง", href: "/trainer#schedule", cta: "ดูตารางงาน", state: "complete" };
}

export function getAdminNextAction(queue: AdminQueue): DashboardAction {
  if (queue.trainers.length > 0 || queue.payments.length > 0) {
    return { title: "มีรายการรอตรวจ", description: "เปิดคิวเพื่อตัดสินใจรายการที่รออยู่", href: "/admin#review-queue", cta: "เปิดคิวตรวจสอบ", state: "action" };
  }

  return { title: "คิวตรวจสอบเป็นปัจจุบันแล้ว", description: "ไม่มีรายการรอตรวจ", href: "/admin#review-queue", cta: "ดูคิวตรวจสอบ", state: "complete" };
}
