import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerWorkbench } from "@/components/trainer-workbench";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  authenticatedRequest: vi.fn(),
  ApiError: class ApiError extends Error { constructor(message: string, public status = 500) { super(message); } },
}));

const rejectedWorkspace = {
  profile: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค.", approvalStatus: "rejected" as const, approvalNote: "กรุณาส่งเอกสารใหม่" },
  certificates: [],
  slots: [],
};

const approvedWorkspace = {
  ...rejectedWorkspace,
  profile: { ...rejectedWorkspace.profile, approvalStatus: "approved" as const, approvalNote: null },
};

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "BK-TEST",
    trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
    member: { displayName: "สมาชิกทดสอบ" },
    startsAt: "2026-08-10T02:00:00.000Z",
    endsAt: "2026-08-10T03:00:00.000Z",
    location: "ฟิตเนสทดสอบ",
    note: "มีอาการเจ็บเข่า",
    status: "pending_trainer",
    paymentStatus: "not_submitted",
    quotedPrice: null,
    chatRoomId: null,
    payment: null,
    review: null,
    actions: {
      canPay: false,
      canReadChat: false,
      canSendChat: false,
      canComplete: false,
      canReview: false,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    demo: false,
    ...overrides,
  };
}

describe("TrainerWorkbench", () => {
  beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

  it("shows the rejection reason and blocks slot creation", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path) => Promise.resolve(path === "/v1/trainer/me" ? rejectedWorkspace : []));
    render(<TrainerWorkbench />);
    expect(await screen.findByText("กรุณาส่งเอกสารใหม่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มช่วงเวลาว่าง" })).toBeDisabled();
  });

  it("requires a positive quote before accepting the selected pending booking", async () => {
    const bookings = [bookingFixture()];
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce(bookings)
      .mockResolvedValueOnce({ id: "BK-TEST", status: "awaiting_payment" })
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);
    await screen.findByText("สมาชิกทดสอบ");
    const quoteInput = screen.getByLabelText("ค่าฝึกสำหรับคำขอ BK-TEST");
    const acceptButton = screen.getByRole("button", { name: "ตอบรับคำขอ BK-TEST" });

    expect(acceptButton).toBeDisabled();
    for (const invalidQuote of ["0", "-100", "abc"]) {
      fireEvent.change(quoteInput, { target: { value: invalidQuote } });
      expect(acceptButton).toBeDisabled();
    }

    fireEvent.change(quoteInput, { target: { value: "1200" } });
    expect(acceptButton).toBeEnabled();
    fireEvent.click(acceptButton);
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-TEST/status",
      { method: "PATCH", body: JSON.stringify({ status: "awaiting_payment", quotedPrice: "1200" }) },
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("ตอบรับคำขอ BK-TEST แล้ว");
  });

  it("lets the trainer complete an eligible confirmed booking and refreshes bookings", async () => {
    const booking = bookingFixture({
      id: "BK-DONE",
      status: "confirmed",
      quotedPrice: 1_200,
      paymentStatus: "approved",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ id: "BK-DONE", status: "completed" })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ฝึกเสร็จแล้ว BK-DONE" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-DONE/status",
      { method: "PATCH", body: JSON.stringify({ status: "completed" }) },
    ));
    expect(authenticatedRequest).toHaveBeenLastCalledWith("/v1/bookings");
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกว่าคำขอ BK-DONE ฝึกเสร็จแล้ว");
  });

  it("keeps completion disabled until the server allows it and shows the appointment end", async () => {
    const booking = bookingFixture({ id: "BK-WAIT", status: "confirmed" });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking]);

    render(<TrainerWorkbench />);

    expect(await screen.findByRole("button", { name: "ฝึกเสร็จแล้ว BK-WAIT" })).toBeDisabled();
    expect(screen.getByText("ฝึกเสร็จได้หลัง จันทร์ 10 ส.ค. · 10:00 น.")).toBeInTheDocument();
  });
});
