import type { AdminQueue, Booking, TrainerWorkspace } from "@/lib/types";

export type DashboardAction = {
  title: string;
  description: string;
  href: string;
  cta: string;
  state: "action" | "waiting" | "complete";
};

export function getMemberNextAction(bookings: Booking[]): DashboardAction {
  const payment = bookings.find((booking) => booking.actions.canPay);
  if (payment) return { title: "ส่งหลักฐานการชำระเงิน", description: `ส่งสลิปก่อนหมดเวลา · คำขอ ${payment.id}`, href: `/member#booking-${payment.id}`, cta: "อัปโหลดสลิป", state: "action" };

  const review = bookings.find((booking) => booking.actions.canReview);
  if (review) return { title: "แบ่งปันผลการฝึก", description: `คำขอ ${review.id}`, href: `/member#booking-${review.id}`, cta: "เขียนรีวิว", state: "action" };

  const paymentReview = bookings.find((booking) => booking.status === "payment_review");
  if (paymentReview) return { title: "รอผู้ดูแลระบบตรวจหลักฐาน", description: `คำขอ ${paymentReview.id}`, href: `/member#booking-${paymentReview.id}`, cta: "ดูสถานะ", state: "waiting" };

  const confirmed = bookings.find((booking) => booking.status === "confirmed");
  if (confirmed) return { title: "เตรียมตัวสำหรับการฝึก", description: `คำขอ ${confirmed.id}`, href: `/member#booking-${confirmed.id}`, cta: "ดูนัดหมาย", state: "waiting" };

  return { title: "เริ่มค้นหาเทรนเนอร์", description: "เปรียบเทียบคุณสมบัติและตารางว่าง", href: "/trainers", cta: "ค้นหาเทรนเนอร์", state: "complete" };
}

export function getTrainerNextAction(workspace: TrainerWorkspace | null, bookings: Booking[]): DashboardAction {
  void bookings;
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

  if (workspace.slots.length === 0) {
    return { title: "เพิ่มช่วงเวลาว่าง", description: "กำหนดตารางเพื่อให้สมาชิกจองได้", href: "/trainer#availability", cta: "เพิ่มช่วงเวลาว่าง", state: "action" };
  }

  return { title: "ตารางงานพร้อมแล้ว", description: "ดูนัดหมายและช่วงเวลาว่างปัจจุบัน", href: "/trainer#schedule", cta: "ดูตารางงาน", state: "complete" };
}

export function getAdminNextAction(queue: AdminQueue): DashboardAction {
  if (queue.trainers.length > 0 || queue.payments.length > 0) {
    return { title: "มีรายการรอตรวจ", description: "เปิดคิวเพื่อตัดสินใจรายการที่รออยู่", href: "/admin#review-queue", cta: "เปิดคิวตรวจสอบ", state: "action" };
  }

  return { title: "คิวตรวจสอบเป็นปัจจุบันแล้ว", description: "ไม่มีรายการรอตรวจ", href: "/admin#review-queue", cta: "ดูคิวตรวจสอบ", state: "complete" };
}
