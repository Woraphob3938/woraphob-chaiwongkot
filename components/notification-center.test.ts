import { describe, expect, it } from "vitest";
import { actionLabel, isSettledReview } from "@/components/notification-center";
import type { NotificationDetail } from "@/lib/types";

function detail(overrides: {
  type?: string;
  actionPath: string;
  status: NotificationDetail["booking"]["status"];
  paymentStatus?: NotificationDetail["booking"]["paymentStatus"];
}): NotificationDetail {  return {
    id: 1,
    type: overrides.type ?? "booking_expired",
    category: "booking",
    title: "หัวข้อ",
    message: "ข้อความ",
    bookingId: "BK-TEST-1",
    actionPath: overrides.actionPath,
    readAt: null,
    createdAt: "2026-09-12T00:00:00.000Z",
    booking: {
      id: "BK-TEST-1",
      memberName: "สมาชิก",
      trainerName: "เทรนเนอร์",
      startsAt: "2026-09-12T01:00:00.000Z",
      endsAt: "2026-09-12T02:00:00.000Z",
      status: overrides.status,
      paymentStatus: overrides.paymentStatus ?? "not_submitted",
      quotedPrice: 500,
      history: [],
    },
  };
}

describe("actionLabel", () => {
  it("offers the trainer list, not the schedule, when the booking is closed", () => {
    // `/trainers` also starts with `/trainer`; reading the prefix as the trainer
    // workspace labelled an expired booking "ดูตารางนัดหมาย".
    expect(actionLabel(detail({ actionPath: "/trainers", status: "expired" })))
      .toBe("ค้นหาเทรนเนอร์");
    expect(actionLabel(detail({ actionPath: "/trainers", status: "cancelled" })))
      .toBe("ค้นหาเทรนเนอร์");
  });

  it("offers the schedule for a confirmed booking and for the trainer workspace", () => {
    expect(actionLabel(detail({ actionPath: "/member", status: "confirmed" })))
      .toBe("ดูตารางนัดหมาย");
    expect(actionLabel(detail({ actionPath: "/trainer", status: "confirmed" })))
      .toBe("ดูตารางนัดหมาย");
    expect(actionLabel(detail({ actionPath: "/trainer#booking-BK-1", status: "confirmed" })))
      .toBe("ดูตารางนัดหมาย");
    expect(actionLabel(detail({ actionPath: "/trainer/apply", status: "confirmed" })))
      .toBe("ดูตารางนัดหมาย");
  });

  it("asks for payment evidence while the hold is still open", () => {
    expect(actionLabel(detail({ actionPath: "/member", status: "awaiting_payment", paymentStatus: "not_submitted" })))
      .toBe("ส่งหลักฐานการชำระเงิน");
    expect(actionLabel(detail({ actionPath: "/member", status: "awaiting_payment", paymentStatus: "rejected" })))
      .toBe("ส่งหลักฐานการชำระเงิน");
    expect(actionLabel(detail({ actionPath: "/member", status: "payment_review", paymentStatus: "reviewing" })))
      .toBe("ดูสถานะการชำระเงิน");
  });

  it("invites a review only after the training finished", () => {
    expect(actionLabel(detail({ actionPath: "/member", status: "completed", paymentStatus: "approved" })))
      .toBe("เขียนรีวิว");
  });

  it("names the administrator surface", () => {
    expect(actionLabel(detail({ actionPath: "/admin", status: "payment_review", paymentStatus: "reviewing" })))
      .toBe("ตรวจสอบการชำระเงิน");
    expect(actionLabel(detail({ actionPath: "/admin#queue", status: "confirmed", paymentStatus: "approved" })))
      .toBe("ดูการจองในหน้าผู้ดูแลระบบ");
  });

  it("stops asking for a review once the slip has been decided", () => {
    // The detail carries the booking's current state, so a slip reviewed after
    // the notification was written must not keep presenting itself as a task.
    const reviewed = detail({
      type: "payment_review_105",
      actionPath: "/admin",
      status: "confirmed",
      paymentStatus: "approved",
    });
    expect(isSettledReview(reviewed)).toBe(true);
    expect(actionLabel(reviewed)).toBe("ดูการจองที่ตรวจแล้ว");

    const rejected = detail({
      type: "payment_review_104",
      actionPath: "/admin",
      status: "confirmed",
      paymentStatus: "approved",
    });
    expect(actionLabel(rejected)).toBe("ดูการจองที่ตรวจแล้ว");
  });

  it("still asks for a review while the slip is waiting", () => {
    const waiting = detail({
      type: "payment_review_106",
      actionPath: "/admin",
      status: "payment_review",
      paymentStatus: "reviewing",
    });
    expect(isSettledReview(waiting)).toBe(false);
    expect(actionLabel(waiting)).toBe("ตรวจสอบการชำระเงิน");
  });

  it("does not call an unrelated notification settled", () => {
    const approved = detail({
      type: "payment_approved_member",
      actionPath: "/member",
      status: "confirmed",
      paymentStatus: "approved",
    });
    expect(isSettledReview(approved)).toBe(false);
  });
});
