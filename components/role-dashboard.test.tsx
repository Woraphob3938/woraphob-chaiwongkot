import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleDashboard } from "@/components/role-dashboard";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

vi.mock("@/lib/api", () => ({ authenticatedRequest: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/admin-review-queue", () => ({
  AdminReviewQueue: () => null,
  TrainerPaymentReview: () => null,
}));
vi.mock("@/components/trainer-workbench", () => ({
  TrainerWorkbench: ({ onIncompleteProfile }: { onIncompleteProfile?: () => void }) => (
    <button type="button" onClick={onIncompleteProfile}>จำลองโปรไฟล์ไม่ครบ</button>
  ),
}));

function openBooking(summary: HTMLElement) {
  fireEvent.click(summary);
}

type FixtureOverrides = Partial<Omit<Booking, "status" | "actions">> & {
  status?: Booking["status"] | "pending_trainer";
  actions?: Booking["actions"] & { canAccept?: boolean; canReject?: boolean; canCancelBooking?: boolean };
  confirmedStartsAt?: string | null;
  confirmedEndsAt?: string | null;
  requestedStartsAt?: string | null;
  cancellationReason?: string | null;
};

function bookingFixture(id: string, overrides: FixtureOverrides = {}): Booking {
  return {
    id,
    trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
    startsAt: "2026-08-10T02:00:00.000Z",
    endsAt: "2026-08-10T03:00:00.000Z",
    status: "awaiting_payment",
    paymentStatus: "not_submitted",
    paymentDeadlineAt: "2099-08-10T02:10:00.000Z",
    quotedPrice: 1_200,
    chatRoomId: 7,
    payment: null,
    review: null,
    actions: {
      canPay: false,
      canReadChat: true,
      canSendChat: true,
      canComplete: false,
      canReview: false,
      canCancel: false,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    demo: false,
    ...overrides,
  } as Booking;
}

const bookings = [
  bookingFixture("BK-PAY", {
    paymentRecipient: { accountName: "เทรนเนอร์ ค.", promptPayId: "0812345678" },
    actions: { ...bookingFixture("unused").actions, canPay: true },
  }),
  bookingFixture("BK-REVIEW", {
    trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ง." },
    status: "completed",
    paymentStatus: "approved",
    payment: { id: 8, amount: 1_200, status: "approved", reviewNote: null, submittedAt: "2026-08-02T00:00:00.000Z" },
    actions: { ...bookingFixture("unused").actions, canPay: false, canReview: true },
  }),
  bookingFixture("BK-CONFIRMED", {
    trainer: { id: 5, slug: "trainer-e", displayName: "เทรนเนอร์ จ." },
    status: "confirmed",
    paymentStatus: "approved",
  }),
  bookingFixture("BK-OLDER", {
    trainer: { id: 6, slug: "trainer-f", displayName: "เทรนเนอร์ ฉ." },
    status: "expired",
    quotedPrice: null,
    chatRoomId: null,
    actions: { ...bookingFixture("unused").actions, canReadChat: false, canSendChat: false },
  }),
];

const fourthActionBookings = bookings.map((booking, index) => ({
  ...booking,
  status: index === 3 ? "awaiting_payment" as const : booking.status,
  quotedPrice: index === 3 ? 1_500 : booking.quotedPrice,
  actions: {
    ...booking.actions,
    canPay: index === 3,
    canReview: false,
  },
}));

describe("member role dashboard", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    localStorage.setItem("fitconnect_token", "member-token");
  });

  it("shows one visible page title that matches the navigation", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([]);
    render(<RoleDashboard role="member" />);

    expect(screen.getByRole("heading", { level: 1, name: "การจองของฉัน" })).not.toHaveClass("sr-only");
    expect(screen.queryByText("ติดตามคำขอ นัดหมาย การชำระ และการสนทนาได้จากสถานะเดียวกัน")).not.toBeInTheDocument();
    await screen.findByTestId("next-action");
  });

  it("does not show demo explanations for bookings", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture("BK-DEMO", { demo: true })]);

    render(<RoleDashboard role="member" />);

    await screen.findByTestId("booking-summary");
    expect(screen.queryByText(/ข้อมูลสาธิต|ภาพสังเคราะห์/)).not.toBeInTheDocument();
  });

  it("puts the next action before compact booking summaries", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(bookings);

    render(<RoleDashboard role="member" />);

    const nextAction = await screen.findByTestId("next-action");
    const bookingHeading = screen.getByRole("heading", { name: "การจอง" });
    expect(nextAction.compareDocumentPosition(bookingHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("heading", { name: "ส่งหลักฐานการชำระเงิน" })).toBeInTheDocument();
    // The default view is the work still in motion; the expired one waits
    // under its own filter.
    expect(screen.getAllByTestId("booking-summary")).toHaveLength(3);
    expect(screen.getAllByText(/^ดูรายละเอียดคำขอ/)).toHaveLength(3);
    expect(screen.queryByText("การจองอื่น")).not.toBeInTheDocument();
    expect(screen.queryByText("ดูทั้งหมด")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ดูทั้งหมด: การจองล่าสุด" })).not.toBeInTheDocument();
  });

  it("opens booking facts in a centered dialog and reveals the review form on request", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(bookings);
    render(<RoleDashboard role="member" />);

    const [paymentSummary, reviewSummary] = await screen.findAllByTestId("booking-summary");
    openBooking(paymentSummary);
    const paymentDialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });

    expect(within(paymentDialog).getByText("รอชำระเงิน")).toBeInTheDocument();
    expect(within(paymentDialog).getAllByText("จันทร์ 10 ส.ค. 2569 · 09:00 น.").length).toBeGreaterThan(0);
    expect(within(paymentDialog).queryByText("สถานที่")).not.toBeInTheDocument();
    expect(within(paymentDialog).getAllByText("1,200.00 บาท").length).toBeGreaterThan(0);
    expect(within(paymentDialog).getByRole("button", { name: "ส่งสลิปให้ตรวจ" })).toBeInTheDocument();
    expect(within(paymentDialog).getByText("อัปโหลดสลิปภายในเวลาที่เหลือ")).toBeInTheDocument();
    expect(within(paymentDialog).getByRole("timer", { name: /^เวลาที่เหลือสำหรับส่งสลิป/ })).toBeInTheDocument();
    expect(within(paymentDialog).getByRole("link", { name: "เปิดการสนทนา" })).toHaveAttribute("href", "/chat?booking=BK-PAY");
    expect(within(paymentDialog).getAllByRole("link", { name: "เปิดการสนทนา" })).toHaveLength(1);
    fireEvent.click(within(paymentDialog).getByRole("button", { name: "ปิด" }));

    openBooking(reviewSummary);
    const reviewDialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ง." });
    expect(within(reviewDialog).getByRole("button", { name: "ส่งรีวิว", hidden: true })).not.toBeVisible();
    fireEvent.click(within(reviewDialog).getByText("เขียนรีวิว"));
    expect(within(reviewDialog).getByRole("button", { name: "ส่งรีวิว" })).toBeInTheDocument();
    expect(within(reviewDialog).getAllByRole("button", { name: "ส่งรีวิว" })).toHaveLength(1);
  });

  it("refreshes a completed appointment when the member returns and reveals the review action", async () => {
    const confirmed = bookingFixture("BK-JUST-DONE", {
      status: "confirmed",
      paymentStatus: "approved",
    });
    const completed = bookingFixture("BK-JUST-DONE", {
      status: "completed",
      paymentStatus: "approved",
      actions: { ...bookingFixture("unused").actions, canReview: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([confirmed])
      .mockResolvedValueOnce([completed]);

    render(<RoleDashboard role="member" />);
    const summary = await screen.findByTestId("booking-summary");
    expect(within(summary).getByText("ชำระแล้ว")).toBeInTheDocument();

    fireEvent.focus(window);

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(2));
    expect(within(summary).getByText("เสร็จสิ้น")).toBeInTheDocument();
    openBooking(summary);
    const dialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });
    fireEvent.click(within(dialog).getByText("เขียนรีวิว"));
    expect(within(dialog).getByRole("button", { name: "ส่งรีวิว" })).toBeInTheDocument();
  });

  it("explains an expired booking and never mounts the upload action", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture("BK-EXPIRED", {
      status: "expired",
      paymentDeadlineAt: null,
      actions: { ...bookingFixture("unused").actions, canPay: false, canSendChat: false },
    })]);

    render(<RoleDashboard role="member" />);
    const [summary] = await screen.findAllByTestId("booking-summary");
    openBooking(summary);
    const dialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });

    expect(within(dialog).getByText("การจองหมดเวลา ช่วงเวลานี้ถูกคืนแล้ว")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("หลักฐานการโอน")).not.toBeInTheDocument();
  });

  it("shows every appointment inside a monthly package", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture("BK-MONTHLY", {
      bookingType: "monthly",
      sessionCount: 2,
      periodStart: "2026-08-10T02:00:00.000Z",
      periodEnd: "2026-09-09T02:00:00.000Z",
      quotedPrice: 1800,
      sessions: [
        { id: 44, startsAt: "2026-08-10T02:00:00.000Z", endsAt: "2026-08-10T03:00:00.000Z" },
        { id: 45, startsAt: "2026-08-17T02:00:00.000Z", endsAt: "2026-08-17T03:00:00.000Z" },
      ],
    })]);

    render(<RoleDashboard role="member" />);
    const summary = await screen.findByTestId("booking-summary");
    openBooking(summary);
    const dialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });

    expect(within(dialog).getByText("แพ็กเกจ 30 วัน · 2 ครั้ง")).toBeInTheDocument();
    expect(within(dialog).getAllByText("จันทร์ 10 ส.ค. 2569 · 09:00 น.").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("จันทร์ 17 ส.ค. 2569 · 09:00 น.")).toBeInTheDocument();
    expect(within(dialog).getByText("ราคาแพ็กเกจ")).toBeInTheDocument();
  });

  it("lets a paid monthly member schedule the remaining appointments one at a time", async () => {
    const monthly = bookingFixture("BK-MONTHLY-NEXT", {
      bookingType: "monthly",
      sessionCount: 2,
      periodStart: "2026-08-10T02:00:00.000Z",
      periodEnd: "2026-09-09T02:00:00.000Z",
      status: "confirmed",
      paymentStatus: "approved",
      sessions: [{ id: 44, startsAt: "2026-08-10T02:00:00.000Z", endsAt: "2026-08-10T03:00:00.000Z" }],
      actions: { ...bookingFixture("unused").actions, canScheduleSession: true },
    });
    const trainer = {
      id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค.", headline: "", bio: "", yearsExperience: 1,
      trainingTypes: [], serviceMode: "freelance", priceFrom: 500, monthlyPrice: 1800, monthlySessionCount: 2,
      reviewCount: 0, verification: "verified", certificates: [], demo: false,
      slots: [{ id: 45, startsAt: "2026-08-17T02:00:00.000Z", endsAt: "2026-08-17T03:00:00.000Z", available: true }],
    };
    vi.mocked(authenticatedRequest).mockImplementation(async (path) => {
      if (path === "/v1/bookings") return [monthly] as never;
      if (path === "/v1/trainers/trainer-c") return trainer as never;
      if (path === "/v1/bookings/BK-MONTHLY-NEXT/sessions") return {} as never;
      throw new Error(`unexpected ${path}`);
    });

    render(<RoleDashboard role="member" />);
    const summary = await screen.findByTestId("booking-summary");
    openBooking(summary);
    const dialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });
    const schedule = await within(dialog).findByRole("button", { name: "จัดเวลานัดที่ 2" });
    fireEvent.click(schedule);
    fireEvent.click(screen.getByRole("button", { name: "09:00–10:00" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันเวลานี้" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันเพิ่มนัดนี้" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-MONTHLY-NEXT/sessions",
      { method: "POST", body: JSON.stringify({ slotId: 45 }) },
    ));
  });

  it("confirms an unpaid cancellation and reloads the member ledger", async () => {
    const cancellable = bookingFixture("BK-CANCEL", {
      actions: { ...bookingFixture("unused").actions, canCancel: true } as Booking["actions"],
    });
    const cancelled = bookingFixture("BK-CANCEL", {
      status: "cancelled",
      paymentDeadlineAt: null,
      actions: { ...bookingFixture("unused").actions, canReadChat: true, canSendChat: false },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([cancellable])
      .mockResolvedValueOnce({ id: "BK-CANCEL", status: "cancelled" })
      .mockResolvedValueOnce([cancelled]);

    render(<RoleDashboard role="member" />);
    const summary = await screen.findByTestId("booking-summary");
    openBooking(summary);
    const bookingDialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });
    fireEvent.click(within(bookingDialog).getByRole("button", { name: "ยกเลิกการจอง" }));

    expect(screen.getByRole("dialog", { name: "ยกเลิกการจองนี้?" })).toBeInTheDocument();
    expect(screen.getByText("ช่วงเวลาจะถูกคืนให้สมาชิกคนอื่นทันที")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/เหตุผลการยกเลิก/), { target: { value: "  ติดธุระในวันนัด  " } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิกการจอง" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings/BK-CANCEL/cancel", {
      method: "POST",
      body: JSON.stringify({ reason: "ติดธุระในวันนัด" }),
    }));
    await waitFor(() => expect(screen.getByText("คำขอนี้สิ้นสุดแล้ว")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "ยกเลิกการจอง" })).not.toBeInTheDocument();
  });

  it("returns focus after dismissing the cancellation dialog", async () => {
    const cancellable = bookingFixture("BK-CANCEL-FOCUS", {
      actions: { ...bookingFixture("unused").actions, canCancel: true } as Booking["actions"],
    });
    vi.mocked(authenticatedRequest).mockResolvedValue([cancellable]);

    render(<RoleDashboard role="member" />);
    const summary = await screen.findByTestId("booking-summary");
    openBooking(summary);
    const bookingDialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });
    const cancelButton = within(bookingDialog).getByRole("button", { name: "ยกเลิกการจอง" });
    cancelButton.focus();
    fireEvent.click(cancelButton);
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(cancelButton).toHaveFocus());
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps the next-action booking first and paginates long booking history", async () => {
    const longHistory = [
      ...fourthActionBookings,
      ...Array.from({ length: 8 }, (_, index) => bookingFixture(`BK-HISTORY-${index + 1}`, {
        trainer: { id: 10 + index, slug: `trainer-${index}`, displayName: `เทรนเนอร์ ${index + 1}` },
        status: "expired",
      })),
    ];
    vi.mocked(authenticatedRequest).mockResolvedValue(longHistory);
    render(<RoleDashboard role="member" />);

    const actionLink = await screen.findByRole("link", { name: "อัปโหลดสลิป" });
    expect(actionLink).toHaveAttribute("href", "/member#booking-BK-OLDER");
    expect(document.querySelector("#booking-BK-OLDER")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ทั้งหมด 12" }));
    expect(screen.getAllByTestId("booking-summary")[0]).toHaveAttribute("id", "booking-BK-OLDER");
    expect(screen.getAllByTestId("booking-summary")).toHaveLength(10);
    expect(screen.getByText("รายการ 1–10 จาก 12")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    expect(screen.getAllByTestId("booking-summary")).toHaveLength(2);
    expect(screen.getByText("รายการ 11–12 จาก 12")).toBeInTheDocument();
    expect(screen.getByText("หน้า 2 / 2")).toBeInTheDocument();
  });

  it("searches bookings and filters them by status while keeping the next action visible", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(bookings);
    render(<RoleDashboard role="member" />);

    // Four groups at most, with the work still in motion selected first.
    expect(await screen.findByRole("button", { name: "กำลังดำเนินการ 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ยกเลิก/หมดเวลา 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ทั้งหมด 4" })).toBeInTheDocument();
    // A completed booking still owed a review counts as active, so the
    // finished group has nothing to show and is not offered.
    expect(screen.queryByRole("button", { name: /ฝึกเสร็จแล้ว/ })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "กรองการจองตามสถานะ" }).querySelectorAll("button").length).toBeLessThanOrEqual(4);

    fireEvent.change(screen.getByRole("searchbox", { name: "ค้นหาการจอง" }), { target: { value: "BK-REVIEW" } });
    expect(screen.getAllByTestId("booking-summary").map((summary) => summary.id)).toEqual(["booking-BK-REVIEW"]);

    fireEvent.change(screen.getByRole("searchbox", { name: "ค้นหาการจอง" }), { target: { value: "" } });
    expect(screen.queryByText("การจองอื่น")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "อัปโหลดสลิป" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก/หมดเวลา 1" }));
    expect(screen.getByRole("button", { name: "ยกเลิก/หมดเวลา 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("booking-summary").map((summary) => summary.id)).toEqual(["booking-BK-OLDER"]);
  });

  it("shows the confirmed period the trainer set on the member's booking card", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture("BK-CONFIRMED-TIME", {
      status: "confirmed",
      paymentStatus: "approved",
      startsAt: "2026-08-13T02:00:00.000Z",
      endsAt: "2026-08-13T03:00:00.000Z",
      confirmedStartsAt: "2026-08-13T05:00:00.000Z",
      confirmedEndsAt: "2026-08-13T06:00:00.000Z",
    })]);

    render(<RoleDashboard role="member" />);
    const [summary] = await screen.findAllByTestId("booking-summary");
    openBooking(summary);
    const dialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });

    expect(within(dialog).getByText("ช่วงเวลาที่ยืนยัน")).toBeInTheDocument();
    expect(within(dialog).getByText(/12:00 น\. – 13:00 น\./)).toBeInTheDocument();
    expect(within(dialog).getByText("เวลาที่ขอไว้")).toBeInTheDocument();
  });

  it("hides the payment panel and the payment clock while the trainer has not answered", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture("BK-WAITING", {
      status: "pending_trainer",
      requestedStartsAt: "2026-08-13T02:00:00.000Z",
      paymentRecipient: { accountName: "เทรนเนอร์ ค.", promptPayId: "0812345678" },
      // Even a stale `canPay` must not open the payment step early.
      actions: { ...bookingFixture("unused").actions, canPay: true },
    })]);

    render(<RoleDashboard role="member" />);
    const [summary] = await screen.findAllByTestId("booking-summary");
    expect(screen.getByRole("button", { name: "กำลังดำเนินการ 1" })).toBeInTheDocument();
    openBooking(summary);
    const dialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });

    expect(within(dialog).getByText("รอเทรนเนอร์ตอบรับ")).toBeInTheDocument();
    expect(within(dialog).getByText("รอเทรนเนอร์ตอบรับ ระบบจะแจ้งผลให้คุณในรอบ 12:00 หรือ 18:00 น. แล้วจึงชำระเงินได้ เวลาฝึกยังเป็นเวลาที่คุณขอ")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "ส่งสลิปให้ตรวจ" })).not.toBeInTheDocument();
    expect(within(dialog).queryByText("อัปโหลดสลิปภายในเวลาที่เหลือ")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("timer")).not.toBeInTheDocument();
  });

  it("lets the member withdraw a request the trainer has not answered", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture("BK-WITHDRAW", {
      status: "pending_trainer",
      actions: { ...bookingFixture("unused").actions, canCancel: true },
    })]);

    render(<RoleDashboard role="member" />);
    const [summary] = await screen.findAllByTestId("booking-summary");
    openBooking(summary);
    const dialog = screen.getByRole("dialog", { name: "เทรนเนอร์ ค." });
    expect(within(dialog).getByRole("button", { name: "ยกเลิกการจอง" })).toBeInTheDocument();
  });

  it("reloads once when the payment window closes, however many clocks show it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const deadline = new Date(Date.now() + 2_000).toISOString();
      vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture("BK-CLOCK", { status: "awaiting_payment", paymentStatus: "not_submitted", paymentDeadlineAt: deadline, actions: { ...bookingFixture("unused").actions, canPay: true } })]);
      render(<RoleDashboard role="member" />);
      const [summary] = await screen.findAllByTestId("booking-summary");
      openBooking(summary);
      // Card, row and dialog all show the clock.
      expect(screen.getAllByRole("timer", { hidden: true }).length).toBeGreaterThanOrEqual(3);
      const before = vi.mocked(authenticatedRequest).mock.calls.length;
      await vi.advanceTimersByTimeAsync(3_000);
      await waitFor(() => expect(vi.mocked(authenticatedRequest).mock.calls.length).toBe(before + 1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens the booking the next-action card names and shows its clock", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(bookings);
    render(<RoleDashboard role="member" />);

    const card = await screen.findByTestId("next-action");
    expect(within(card).getByRole("timer")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("link", { name: "อัปโหลดสลิป" }));
    expect(screen.getByRole("dialog", { name: "เทรนเนอร์ ค." })).toBeInTheDocument();
  });
});

describe("trainer role dashboard", () => {
  it("continues an incomplete trainer to professional profile setup", () => {
    const navigate = vi.fn();
    render(<RoleDashboard role="trainer" navigate={navigate} />);

    fireEvent.click(screen.getByRole("button", { name: "จำลองโปรไฟล์ไม่ครบ" }));
    expect(navigate).toHaveBeenCalledWith("/trainer/apply");
  });
});
