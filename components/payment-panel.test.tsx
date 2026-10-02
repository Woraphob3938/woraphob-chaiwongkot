import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentPanel } from "@/components/payment-panel";
import { RoleDashboard } from "@/components/role-dashboard";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

vi.mock("@/lib/api", () => ({
  authenticatedRequest: vi.fn(),
  apiAssetUrl: (path: string | null) => (path ? `http://api.test${path}` : null),
  ApiError: class ApiError extends Error {
    constructor(message: string, public status = 500) { super(message); }
  },
}));
vi.mock("@/components/admin-review-queue", () => ({ AdminReviewQueue: () => null }));
vi.mock("@/components/trainer-workbench", () => ({ TrainerWorkbench: () => null }));

function openBooking(summary: HTMLElement) {
  fireEvent.click(summary);
}

type FixtureOverrides = Partial<Omit<Booking, "status" | "actions">> & {
  status?: Booking["status"] | "pending_trainer";
  actions?: Booking["actions"] & { canAccept?: boolean; canReject?: boolean; canCancelBooking?: boolean };
};

function bookingFixture(overrides: FixtureOverrides = {}): Booking {
  return {
    id: "BK-PAY-001",
    trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
    startsAt: "2026-08-10T02:00:00.000Z",
    endsAt: "2026-08-10T03:00:00.000Z",
    status: "awaiting_payment",
    paymentStatus: "not_submitted",
    paymentDeadlineAt: "2026-08-10T02:10:00.000Z",
    paymentServiceMode: "freelance",
    quotedPrice: 1_200,
    chatRoomId: 7,
    payment: null,
    review: null,
    actions: {
      canPay: true,
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

describe("PaymentPanel", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("shows the status, the price and one pay button", () => {
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);

    expect(screen.getByText("ยอดที่ต้องชำระ")).toBeVisible();
    expect(screen.getByText(/ยังไม่ชำระ/)).toBeVisible();
    expect(screen.getAllByText("1,200.00 บาท").length).toBeGreaterThan(0);
    expect(screen.getByText(/ชำระให้ เทรนเนอร์ ค\. ผ่านระบบ FitConnect/)).toBeVisible();
    // Three plain steps tell the member what happens next.
    const steps = screen.getByRole("list", { name: "ขั้นตอนการชำระเงิน" });
    expect(steps.querySelectorAll("li")).toHaveLength(3);
    expect(screen.getByRole("list", { name: "วิธีชำระที่รองรับ" })).toHaveTextContent("พร้อมเพย์");
    expect(screen.getByRole("button", { name: "ชำระเงิน" })).toBeEnabled();
    expect(screen.queryByLabelText("หลักฐานการโอน")).not.toBeInTheDocument();
  });

  it("names the gym as the recipient of a gym booking", () => {
    render(<PaymentPanel booking={bookingFixture({ paymentServiceMode: "gym" })} onUpdated={vi.fn()} />);
    expect(screen.getByText(/ชำระให้ยิมผ่านระบบ FitConnect/)).toBeVisible();
  });

  it("opens Stripe Checkout for this booking", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce({ bookingId: "BK-PAY-001", checkoutUrl: "https://checkout.stripe.test/c/pay/cs_1" });
    const redirect = vi.fn();
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} redirect={redirect} />);

    fireEvent.click(screen.getByRole("button", { name: "ชำระเงิน" }));

    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://checkout.stripe.test/c/pay/cs_1"));
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/payments", {
      method: "POST",
      body: JSON.stringify({ bookingId: "BK-PAY-001" }),
    });
    expect(screen.getByRole("button", { name: "กำลังเปิดหน้าชำระเงิน…" })).toBeDisabled();
  });

  it("explains a refusal and lets the member try again", async () => {
    vi.mocked(authenticatedRequest).mockRejectedValueOnce(new Error("เทรนเนอร์ยังไม่ได้เปิดรับเงินออนไลน์ กรุณาติดต่อเทรนเนอร์ผ่านแชท"));
    const onUpdated = vi.fn();
    const redirect = vi.fn();
    render(<PaymentPanel booking={bookingFixture()} onUpdated={onUpdated} redirect={redirect} />);

    fireEvent.click(screen.getByRole("button", { name: "ชำระเงิน" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("เทรนเนอร์ยังไม่ได้เปิดรับเงินออนไลน์");
    expect(redirect).not.toHaveBeenCalled();
    expect(onUpdated).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ชำระเงิน" })).toBeEnabled();
  });

  it("does not offer payment when the booking cannot be paid", () => {
    render(<PaymentPanel booking={bookingFixture({
      actions: { ...bookingFixture().actions, canPay: false },
    })} onUpdated={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "ชำระเงิน" })).not.toBeInTheDocument();
    expect(screen.getByText("ยังชำระเงินไม่ได้ตามสถานะการจองนี้")).toBeVisible();
  });

  it("steps aside completely while the request waits for the trainer's answer", () => {
    const { container } = render(<PaymentPanel booking={bookingFixture({
      status: "pending_trainer",
      // Even a stale canPay must not open the payment step while the booking
      // is still pending_trainer.
      actions: { ...bookingFixture().actions, canPay: true },
    })} onUpdated={vi.fn()} />);

    expect(container.querySelector(".payment-panel")).toBeNull();
    expect(screen.queryByRole("button", { name: "ชำระเงิน" })).not.toBeInTheDocument();
  });
});

describe("member booking ledger", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    localStorage.setItem("fitconnect_token", "member-token");
    window.history.replaceState(null, "", "/member");
  });

  it("renders the next-action booking first and exposes chat only when allowed", async () => {
    const first = bookingFixture({
      id: "BK-FIRST",
      actions: { ...bookingFixture().actions, canPay: false, canReadChat: true },
    });
    const second = bookingFixture({
      id: "BK-SECOND",
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ง." },
      status: "awaiting_payment",
      quotedPrice: 1_200,
      paymentDeadlineAt: "2099-08-10T02:10:00.000Z",
      chatRoomId: null,
      actions: { ...bookingFixture().actions, canPay: true, canReadChat: false, canSendChat: false },
    });
    vi.mocked(authenticatedRequest).mockResolvedValue([first, second]);

    render(<RoleDashboard role="member" />);

    const summaries = await screen.findAllByTestId("booking-summary");
    expect(summaries.map((summary) => summary.id)).toEqual(["booking-BK-SECOND", "booking-BK-FIRST"]);
    summaries.forEach((summary) => openBooking(summary));
    const chatLinks = screen.getAllByRole("link", { name: "เปิดการสนทนา" });
    expect(chatLinks).toHaveLength(1);
    expect(chatLinks[0]).toHaveAttribute("href", "/chat?booking=BK-FIRST");
  });

  it("says a cancelled checkout was not paid", async () => {
    window.history.replaceState(null, "", "/member?booking=BK-PAY-001&checkout=cancelled");
    vi.mocked(authenticatedRequest).mockResolvedValue([bookingFixture({ paymentDeadlineAt: "2099-08-10T02:10:00.000Z" })]);

    render(<RoleDashboard role="member" />);

    expect(await screen.findByText("ยังไม่ได้ชำระเงิน")).toBeInTheDocument();
    expect(vi.mocked(authenticatedRequest).mock.calls.map(([path]) => path)).not.toContain("/v1/payments/confirm");
  });

  it("settles the payment before loading the list when the member returns from Checkout", async () => {
    window.history.replaceState(null, "", "/member?booking=BK-PAID&checkout=success");
    const confirmed = bookingFixture({
      id: "BK-PAID",
      status: "confirmed",
      paymentStatus: "approved",
      paymentDeadlineAt: null,
      actions: { ...bookingFixture().actions, canPay: false },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path: string) =>
      Promise.resolve(path === "/v1/payments/confirm" ? { bookingId: "BK-PAID", outcome: "paid" } : [confirmed]) as never);

    render(<RoleDashboard role="member" />);

    await screen.findAllByTestId("booking-summary");
    const calls = vi.mocked(authenticatedRequest).mock.calls.map(([path]) => path);
    expect(calls.indexOf("/v1/payments/confirm")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("/v1/payments/confirm")).toBeLessThan(calls.indexOf("/v1/bookings"));
    expect(window.location.search).toBe("?booking=BK-PAID");
    // The member is told at once, without pressing pay again.
    expect(await screen.findByText("ชำระเงินสำเร็จ การจองยืนยันแล้ว")).toBeInTheDocument();
  });
});
