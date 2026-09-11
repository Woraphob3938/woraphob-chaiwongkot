import { describe, expect, it } from "vitest";

import { demoBookings } from "@/lib/demo-data";
import {
  getAdminNextAction,
  getMemberNextAction,
  getTrainerNextAction,
} from "@/lib/dashboard-actions";
import type { AdminQueue, Booking, TrainerWorkspace } from "@/lib/types";

const booking = demoBookings[0];
const expiredBooking: Booking = { ...booking, id: "BK-EXPIRED", status: "expired" };
const trainerQueueItem: AdminQueue["trainers"][number] = {
  id: 7,
  slug: "trainer-test",
  displayName: "เทรนเนอร์ทดสอบ",
  submittedAt: "2026-08-09T09:00:00+07:00",
  certificates: [],
};
const paymentQueueItem: AdminQueue["payments"][number] = {
  id: 8,
  bookingId: "BK-PAYMENT",
  memberName: "สมาชิกทดสอบ",
  trainerName: "เทรนเนอร์ทดสอบ",
  startsAt: "2026-08-10T09:00:00+07:00",
  endsAt: "2026-08-10T10:00:00+07:00",
  quotedPrice: 850,
  amount: 850,
  difference: 0,
  submittedAt: "2026-08-09T09:00:00+07:00",
  fileUrl: "/v1/admin/files/payment/8",
};
const workspace: TrainerWorkspace = {
  profile: { id: 1, slug: "trainer-test", displayName: "เทรนเนอร์ทดสอบ", approvalStatus: "approved", approvalNote: null },
  certificates: [],
  slots: [{ id: 1, startsAt: "2026-08-10T09:00:00+07:00", endsAt: "2026-08-10T10:00:00+07:00", state: "available" }],
};

describe("getMemberNextAction", () => {
  it("prioritizes an actionable payment over every other member state", () => {
    expect(getMemberNextAction([
      { ...booking, id: "BK-PAY", actions: { ...booking.actions, canPay: true } },
      { ...booking, id: "BK-REVIEW", actions: { ...booking.actions, canReview: true } },
      expiredBooking,
      { ...booking, id: "BK-PAYMENT", status: "payment_review" },
      { ...booking, id: "BK-CONFIRMED", status: "confirmed" },
    ])).toMatchObject({
      href: "/member#booking-BK-PAY",
      cta: "อัปโหลดสลิป",
      description: expect.stringMatching(`${booking.trainer.displayName}.*คำขอ BK-PAY`),
      state: "action",
    });
  });

  it("prioritizes an actionable review over all lower member states", () => {
    expect(getMemberNextAction([
      { ...booking, id: "BK-REVIEW", actions: { ...booking.actions, canReview: true } },
      expiredBooking,
      { ...booking, id: "BK-PAYMENT", status: "payment_review" },
      { ...booking, id: "BK-CONFIRMED", status: "confirmed" },
    ])).toMatchObject({ href: "/member#booking-BK-REVIEW", cta: "เขียนรีวิว", state: "action" });
  });

  it("ignores an expired booking and shows payment review", () => {
    expect(getMemberNextAction([
      { ...booking, id: "BK-PAYMENT", status: "payment_review" },
      { ...booking, id: "BK-CONFIRMED", status: "confirmed" },
      expiredBooking,
    ])).toMatchObject({ href: "/member#booking-BK-PAYMENT", cta: "ดูสถานะ", state: "waiting" });
  });

  it("shows payment review before a confirmed appointment", () => {
    expect(getMemberNextAction([
      { ...booking, id: "BK-CONFIRMED", status: "confirmed" },
      { ...booking, id: "BK-PAYMENT", status: "payment_review" },
    ])).toMatchObject({ href: "/member#booking-BK-PAYMENT", cta: "ดูสถานะ", state: "waiting" });
  });

  it("falls back to trainer search", () => {
    expect(getMemberNextAction([])).toMatchObject({ href: "/trainers", cta: "ค้นหาเทรนเนอร์", state: "complete" });
  });
});

describe("getTrainerNextAction", () => {
  it("directs a trainer without a professional profile to finish setup", () => {
    expect(getTrainerNextAction(null, [])).toMatchObject({ href: "/trainer/apply", cta: "กรอกข้อมูลวิชาชีพ" });
  });

  it("does not ask trainers to act on expired bookings", () => {
    expect(getTrainerNextAction({ ...workspace, slots: [] }, [expiredBooking])).toMatchObject({ href: "/trainer#availability", state: "action" });
  });

  it("keeps a pending application in a reachable waiting state", () => {
    expect(getTrainerNextAction({
      ...workspace,
      profile: { ...workspace.profile!, approvalStatus: "pending" },
      slots: [],
    }, [])).toMatchObject({
      title: "รอผู้ดูแลระบบตรวจใบสมัคร",
      href: "/trainer#approval-status",
      cta: "ดูสถานะการสมัคร",
      state: "waiting",
    });
  });

  it("returns rejected applications to correction instead of a disabled slot form", () => {
    expect(getTrainerNextAction({
      ...workspace,
      profile: { ...workspace.profile!, approvalStatus: "rejected", approvalNote: "กรุณาส่งเอกสารใหม่" },
      slots: [],
    }, [])).toMatchObject({
      title: "แก้ไขใบสมัครเทรนเนอร์",
      href: "/trainer/apply",
      cta: "แก้ไขใบสมัคร",
      state: "action",
    });
  });

  it("prompts trainers with no slots to add availability", () => {
    expect(getTrainerNextAction({ ...workspace, slots: [] }, [])).toMatchObject({ href: "/trainer#availability", state: "action" });
  });

  it("otherwise leads to the current schedule", () => {
    expect(getTrainerNextAction(workspace, [])).toMatchObject({ href: "/trainer#schedule" });
  });

  it("points to the next confirmed session when nothing is due to complete", () => {
    expect(getTrainerNextAction(workspace, [{
      ...booking,
      id: "BK-NEXT",
      status: "confirmed",
      startsAt: "2026-08-14T02:00:00.000Z",
      member: { displayName: "สมาชิกทดสอบ" },
      actions: { ...booking.actions, canReadChat: false },
    }])).toMatchObject({
      title: "นัดถัดไป · สมาชิกทดสอบ",
      href: "/trainer#booking-BK-NEXT",
      cta: "ดูนัดหมาย",
      state: "waiting",
    });
  });

  it("prioritizes completing a due session over adding more availability", () => {
    expect(getTrainerNextAction(workspace, [{
      ...booking,
      id: "BK-DONE",
      status: "confirmed",
      member: { displayName: "สมาชิกทดสอบ" },
      actions: { ...booking.actions, canComplete: true },
    }])).toMatchObject({
      href: "/trainer#booking-BK-DONE",
      cta: "บันทึกว่าฝึกเสร็จ",
      state: "action",
    });
  });

  it("does not offer completion for an invalid appointment time range", () => {
    expect(getTrainerNextAction(workspace, [{
      ...booking,
      id: "BK-BAD-TIME",
      status: "confirmed",
      startsAt: "2026-09-12T04:00:00.000Z",
      endsAt: "2026-09-12T03:00:00.000Z",
      actions: { ...booking.actions, canComplete: true, canReadChat: false },
    }])).toMatchObject({ state: "waiting", cta: "ดูนัดหมาย" });
  });
});

describe("getAdminNextAction", () => {
  it("directs a non-empty review queue to its action", () => {
    expect(getAdminNextAction({ trainers: [trainerQueueItem], payments: [] })).toMatchObject({ href: "/admin#review-queue", state: "action" });
  });

  it("directs a payments-only review queue to its action", () => {
    expect(getAdminNextAction({ trainers: [], payments: [paymentQueueItem] })).toMatchObject({ href: "/admin#review-queue", state: "action" });
  });

  it("shows the current queue when no review is pending", () => {
    expect(getAdminNextAction({ trainers: [], payments: [] })).toMatchObject({ href: "/admin#review-queue", cta: "ดูคิวตรวจสอบ", state: "complete" });
  });
});
