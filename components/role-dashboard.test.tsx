import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleDashboard } from "@/components/role-dashboard";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

vi.mock("@/lib/api", () => ({ authenticatedRequest: vi.fn() }));
vi.mock("@/components/admin-review-queue", () => ({ AdminReviewQueue: () => null }));
vi.mock("@/components/trainer-workbench", () => ({
  TrainerWorkbench: ({ onIncompleteProfile }: { onIncompleteProfile?: () => void }) => (
    <button type="button" onClick={onIncompleteProfile}>จำลองโปรไฟล์ไม่ครบ</button>
  ),
}));

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
    expect(screen.queryByRole("link", { name: "ดูทั้งหมด: การจองล่าสุด" })).not.toBeInTheDocument();
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

  it("mounts the next-action booking first and reveals every booking once through view-all", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue(fourthActionBookings);
    render(<RoleDashboard role="member" />);

    const actionLink = await screen.findByRole("link", { name: "อัปโหลดสลิป" });
    expect(actionLink).toHaveAttribute("href", "/member#booking-BK-OLDER");
    expect(document.querySelector("#booking-BK-OLDER")).toBeInTheDocument();
    expect(screen.getAllByTestId("booking-summary").map((summary) => summary.id)).toEqual([
      "booking-BK-OLDER",
      "booking-BK-PAY",
      "booking-BK-REVIEW",
    ]);

    const archive = document.querySelector("#all-bookings");
    const archiveSummary = document.querySelector("#all-bookings > summary");
    expect(archiveSummary).toHaveTextContent("ดูการจองทั้งหมด");
    if (!(archive instanceof HTMLDetailsElement) || !(archiveSummary instanceof HTMLElement)) {
      throw new Error("archive disclosure is missing");
    }
    fireEvent.click(archiveSummary);

    expect(archive).toHaveAttribute("open");
    await waitFor(() => expect(screen.getAllByTestId("booking-summary")).toHaveLength(4));
    const allSummaryIds = screen.getAllByTestId("booking-summary").map((summary) => summary.id);
    expect(allSummaryIds).toEqual([
      "booking-BK-OLDER",
      "booking-BK-PAY",
      "booking-BK-REVIEW",
      "booking-BK-CONFIRMED",
    ]);
    expect(new Set(allSummaryIds).size).toBe(fourthActionBookings.length);
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
