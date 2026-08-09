import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("puts the pending booking action before the workspace summaries", async () => {
    const bookings = [
      bookingFixture({ id: "BK-OLD-1", status: "cancelled" }),
      bookingFixture({ id: "BK-OLD-2", status: "completed" }),
      bookingFixture({ id: "BK-OLD-3", status: "awaiting_payment" }),
      bookingFixture(),
    ];
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce(bookings);

    render(<TrainerWorkbench />);

    const actionTitle = await screen.findByRole("heading", { name: "ตอบรับคำขอจอง" });
    const bookingHeading = screen.getByRole("heading", { name: "คำขอที่รอคำตอบ" });
    expect(screen.getByTestId("next-action")).toHaveAttribute("data-state", "action");
    expect(screen.getByRole("link", { name: "ตรวจคำขอ" })).toHaveAttribute("href", "/trainer#booking-BK-TEST");
    expect(actionTitle.compareDocumentPosition(bookingHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the application next action when the trainer has no profile", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({ profile: null, certificates: [], slots: [] })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);

    expect(await screen.findByRole("heading", { name: "เริ่มต้นเป็นเทรนเนอร์" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "สมัครเป็นเทรนเนอร์" })).toHaveAttribute("href", "/trainer/apply");
  });

  it("keeps only three pending summaries mounted until the archive is opened", async () => {
    const bookings = Array.from({ length: 4 }, (_, index) => bookingFixture({
      id: `BK-${index + 1}`,
      member: { displayName: `สมาชิก ${index + 1}` },
    }));
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce(bookings);

    render(<TrainerWorkbench />);

    expect(await screen.findByRole("link", { name: "ตรวจคำขอ" })).toHaveAttribute("href", "/trainer#booking-BK-1");
    expect(screen.getAllByTestId("trainer-booking-summary")).toHaveLength(3);
    expect(document.getElementById("booking-BK-1")).toBeInTheDocument();
    expect(document.getElementById("booking-BK-4")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("ดูคำขอทั้งหมด"));

    await waitFor(() => expect(screen.getAllByTestId("trainer-booking-summary")).toHaveLength(4));
    for (const booking of bookings) {
      expect(document.querySelectorAll(`#booking-${booking.id}`)).toHaveLength(1);
      expect(document.querySelectorAll(`[aria-label="ตอบรับคำขอ ${booking.id}"]`)).toHaveLength(1);
    }
  });

  it("shows the rejection reason and blocks slot creation", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path) => Promise.resolve(path === "/v1/trainer/me" ? rejectedWorkspace : []));
    render(<TrainerWorkbench />);
    expect(await screen.findByText("กรุณาส่งเอกสารใหม่")).toBeInTheDocument();
    expect(screen.getByTestId("next-action")).toBeInTheDocument();
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

  it("prevents duplicate completion and reports a failed refresh beside confirmed bookings", async () => {
    const booking = bookingFixture({
      id: "BK-REFRESH",
      status: "confirmed",
      quotedPrice: 1_200,
      paymentStatus: "approved",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ id: "BK-REFRESH", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"));

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ฝึกเสร็จแล้ว BK-REFRESH" }));

    const confirmedSection = screen.getByRole("region", { name: "นัดหมายที่ยืนยันแล้ว" });
    const refreshError = await within(confirmedSection).findByRole("alert");
    expect(refreshError).toHaveTextContent("บันทึกว่าฝึกเสร็จแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ");
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(screen.queryByText("บันทึกว่าคำขอ BK-REFRESH ฝึกเสร็จแล้ว")).not.toBeInTheDocument();
    expect(within(confirmedSection).queryByRole("button", { name: "ฝึกเสร็จแล้ว BK-REFRESH" })).not.toBeInTheDocument();
    expect(vi.mocked(authenticatedRequest).mock.calls.filter(([path, options]) => (
      path === "/v1/bookings/BK-REFRESH/status" && options?.method === "PATCH"
    ))).toHaveLength(1);
  });

  it("keeps retry feedback focused while loading and announces a successful refresh", async () => {
    const booking = bookingFixture({
      id: "BK-RETRY-OK",
      status: "confirmed",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    let resolveRetry!: (bookings: Booking[]) => void;
    const pendingRetry = new Promise<Booking[]>((resolve) => { resolveRetry = resolve; });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ id: "BK-RETRY-OK", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"))
      .mockImplementationOnce(() => pendingRetry);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ฝึกเสร็จแล้ว BK-RETRY-OK" }));

    const confirmedSection = screen.getByRole("region", { name: "นัดหมายที่ยืนยันแล้ว" });
    const refreshError = await within(confirmedSection).findByRole("alert");
    const retryButton = within(refreshError).getByRole("button", { name: "ลองโหลดใหม่" });
    retryButton.focus();
    fireEvent.click(retryButton);

    expect(refreshError).toBeInTheDocument();
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(within(refreshError).getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();

    await act(async () => { resolveRetry([]); });

    const successNotice = await screen.findByRole("status");
    expect(successNotice).toHaveTextContent("โหลดรายการนัดหมายล่าสุดแล้ว");
    await waitFor(() => expect(successNotice).toHaveFocus());
    expect(within(confirmedSection).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the retry alert focused and usable when refresh fails again", async () => {
    const booking = bookingFixture({
      id: "BK-RETRY-FAIL",
      status: "confirmed",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    let rejectRetry!: (reason: Error) => void;
    const pendingRetry = new Promise<Booking[]>((_, reject) => { rejectRetry = reject; });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ id: "BK-RETRY-FAIL", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"))
      .mockImplementationOnce(() => pendingRetry);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ฝึกเสร็จแล้ว BK-RETRY-FAIL" }));

    const confirmedSection = screen.getByRole("region", { name: "นัดหมายที่ยืนยันแล้ว" });
    const refreshError = await within(confirmedSection).findByRole("alert");
    fireEvent.click(within(refreshError).getByRole("button", { name: "ลองโหลดใหม่" }));

    expect(refreshError).toBeInTheDocument();
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(within(refreshError).getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();

    await act(async () => { rejectRetry(new Error("เครือข่ายขัดข้อง")); });

    expect(await within(confirmedSection).findByRole("alert")).toHaveTextContent("ยังโหลดรายการนัดหมายล่าสุดไม่สำเร็จ กรุณาลองใหม่");
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(within(refreshError).getByRole("button", { name: "ลองโหลดใหม่" })).toBeEnabled();
  });
});
