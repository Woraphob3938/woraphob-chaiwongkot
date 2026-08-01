import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerWorkbench } from "@/components/trainer-workbench";
import { authenticatedRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  authenticatedRequest: vi.fn(),
  ApiError: class ApiError extends Error { constructor(message: string, public status = 500) { super(message); } },
}));

const rejectedWorkspace = {
  profile: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค.", approvalStatus: "rejected" as const, approvalNote: "กรุณาส่งเอกสารใหม่" },
  certificates: [],
  slots: [],
};

describe("TrainerWorkbench", () => {
  beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

  it("shows the rejection reason and blocks slot creation", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path) => Promise.resolve(path === "/v1/trainer/me" ? rejectedWorkspace : []));
    render(<TrainerWorkbench />);
    expect(await screen.findByText("กรุณาส่งเอกสารใหม่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มช่วงเวลาว่าง" })).toBeDisabled();
  });

  it("accepts only the selected pending booking", async () => {
    const approved = { ...rejectedWorkspace, profile: { ...rejectedWorkspace.profile, approvalStatus: "approved" as const, approvalNote: null } };
    const bookings = [{
      id: "BK-TEST",
      trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
      member: { displayName: "สมาชิกทดสอบ" },
      startsAt: "2026-08-10T02:00:00.000Z",
      endsAt: "2026-08-10T03:00:00.000Z",
      location: "ฟิตเนสทดสอบ",
      note: "มีอาการเจ็บเข่า",
      status: "pending_trainer" as const,
      paymentStatus: "not_submitted" as const,
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
    }];
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(bookings)
      .mockResolvedValueOnce({ id: "BK-TEST", status: "awaiting_payment" })
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);
    await screen.findByText("สมาชิกทดสอบ");
    fireEvent.click(screen.getByRole("button", { name: "ตอบรับคำขอ BK-TEST" }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-TEST/status",
      { method: "PATCH", body: JSON.stringify({ status: "awaiting_payment" }) },
    ));
    expect(await screen.findByRole("status")).toHaveTextContent("ตอบรับคำขอ BK-TEST แล้ว");
  });
});
