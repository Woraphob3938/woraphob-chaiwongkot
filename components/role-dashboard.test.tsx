import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleDashboard } from "@/components/role-dashboard";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

vi.mock("@/lib/api", () => ({ authenticatedRequest: vi.fn() }));
vi.mock("@/components/admin-review-queue", () => ({ AdminReviewQueue: () => null }));
vi.mock("@/components/trainer-workbench", () => ({ TrainerWorkbench: () => null }));

function bookingFixture(id: string, overrides: Partial<Booking> = {}): Booking {
  return {
    id,
    trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
    startsAt: "2026-08-10T02:00:00.000Z",
    endsAt: "2026-08-10T03:00:00.000Z",
    location: "ฟิตเนสทดสอบ",
    status: "awaiting_payment",
    paymentStatus: "not_submitted",
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
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    demo: false,
    ...overrides,
  };
}

const bookings = [
  bookingFixture("BK-PAY", { actions: { ...bookingFixture("unused").actions, canPay: true } }),
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
    status: "pending_trainer",
    quotedPrice: null,
    chatRoomId: null,
    actions: { ...bookingFixture("unused").actions, canReadChat: false, canSendChat: false },
  }),
];

describe("member role dashboard", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    localStorage.setItem("fitconnect_token", "member-token");
  });

  it("puts the next action before three compact booking summaries", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(bookings);

    render(<RoleDashboard role="member" />);

    const nextAction = await screen.findByTestId("next-action");
    const bookingHeading = screen.getByRole("heading", { name: "การจองล่าสุด" });
    expect(nextAction.compareDocumentPosition(bookingHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("สิ่งที่ต้องทำต่อ")).toBeInTheDocument();
    expect(screen.getAllByTestId("booking-summary")).toHaveLength(3);
    expect(screen.getAllByText("ดูรายละเอียด")).toHaveLength(3);
    expect(screen.getByText("ดูการจองทั้งหมด")).toBeInTheDocument();
  });

  it("reveals all facts and allowed actions without duplicating them", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(bookings);
    render(<RoleDashboard role="member" />);

    const [paymentSummary, reviewSummary] = await screen.findAllByTestId("booking-summary");
    fireEvent.click(within(paymentSummary).getByText("ดูรายละเอียด"));

    expect(paymentSummary).toHaveAttribute("open");
    expect(within(paymentSummary).getByText("รอชำระเงิน")).toBeInTheDocument();
    expect(within(paymentSummary).getAllByText("จันทร์ 10 ส.ค. · 09:00 น.").length).toBeGreaterThan(0);
    expect(within(paymentSummary).getByText("ฟิตเนสทดสอบ")).toBeInTheDocument();
    expect(within(paymentSummary).getAllByText("เทรนเนอร์ ค.").length).toBeGreaterThan(0);
    expect(within(paymentSummary).getAllByText("1,200.00 บาท").length).toBeGreaterThan(0);
    expect(within(paymentSummary).getByRole("button", { name: "ส่งสลิปให้ตรวจ" })).toBeInTheDocument();
    expect(within(paymentSummary).getByRole("link", { name: "เปิดการสนทนา" })).toHaveAttribute("href", "/chat?booking=BK-PAY");
    expect(within(paymentSummary).getAllByRole("link", { name: "เปิดการสนทนา" })).toHaveLength(1);

    fireEvent.click(within(reviewSummary).getByText("ดูรายละเอียด"));
    expect(within(reviewSummary).getByRole("button", { name: "ส่งรีวิว" })).toBeInTheDocument();
    expect(within(reviewSummary).getAllByRole("button", { name: "ส่งรีวิว" })).toHaveLength(1);
  });

  it("keeps older bookings reachable through the same-page view-all disclosure", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(bookings);
    render(<RoleDashboard role="member" />);

    await screen.findByTestId("next-action");
    expect(screen.getAllByTestId("booking-summary")).toHaveLength(3);
    fireEvent.click(screen.getByText("ดูการจองทั้งหมด"));

    await waitFor(() => expect(screen.getAllByTestId("booking-summary")).toHaveLength(4));
    expect(screen.getAllByText("เทรนเนอร์ ฉ.").length).toBeGreaterThan(0);
    expect(document.querySelector("#booking-BK-OLDER")).toBeInTheDocument();
  });
});
