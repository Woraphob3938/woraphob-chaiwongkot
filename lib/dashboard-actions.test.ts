import { describe, expect, it } from "vitest";

import { demoBookings } from "@/lib/demo-data";
import {
  getAdminNextAction,
  getMemberNextAction,
  getTrainerNextAction,
} from "@/lib/dashboard-actions";
import type { AdminQueue, Booking, TrainerWorkspace } from "@/lib/types";

const booking = demoBookings[0];
const pendingBooking: Booking = { ...booking, id: "BK-PENDING", status: "pending_trainer" };
const trainerQueueItem: AdminQueue["trainers"][number] = {
  id: 7,
  slug: "trainer-test",
  displayName: "เทรนเนอร์ทดสอบ",
  province: "สกลนคร",
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
  location: "สกลนคร",
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
      pendingBooking,
      { ...booking, id: "BK-PAYMENT", status: "payment_review" },
      { ...booking, id: "BK-CONFIRMED", status: "confirmed" },
    ])).toMatchObject({ href: "/member#booking-BK-PAY", cta: "อัปโหลดสลิป", state: "action" });
  });

  it("prioritizes an actionable review over all lower member states", () => {
    expect(getMemberNextAction([
      { ...booking, id: "BK-REVIEW", actions: { ...booking.actions, canReview: true } },
      pendingBooking,
      { ...booking, id: "BK-PAYMENT", status: "payment_review" },
      { ...booking, id: "BK-CONFIRMED", status: "confirmed" },
    ])).toMatchObject({ href: "/member#booking-BK-REVIEW", cta: "เขียนรีวิว", state: "action" });
  });

  it("shows pending trainer before payment review and confirmed appointments", () => {
    expect(getMemberNextAction([
      { ...booking, id: "BK-PAYMENT", status: "payment_review" },
      { ...booking, id: "BK-CONFIRMED", status: "confirmed" },
      pendingBooking,
    ])).toMatchObject({ href: "/member#booking-BK-PENDING", cta: "ดูคำขอ", state: "waiting" });
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
  it("directs people without a trainer workspace to apply", () => {
    expect(getTrainerNextAction(null, [])).toMatchObject({ href: "/trainer/apply", cta: "สมัครเป็นเทรนเนอร์" });
  });

  it("prioritizes a pending booking over missing availability", () => {
    expect(getTrainerNextAction({ ...workspace, slots: [] }, [pendingBooking])).toMatchObject({ href: "/trainer#booking-BK-PENDING", state: "action" });
  });

  it("prompts trainers with no slots to add availability", () => {
    expect(getTrainerNextAction({ ...workspace, slots: [] }, [])).toMatchObject({ href: "/trainer#availability", state: "action" });
  });

  it("otherwise leads to the current schedule", () => {
    expect(getTrainerNextAction(workspace, [])).toMatchObject({ href: "/trainer#schedule" });
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
