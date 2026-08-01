import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentPanel } from "@/components/payment-panel";
import { RoleDashboard } from "@/components/role-dashboard";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  authenticatedRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string, public status = 500) { super(message); }
  },
}));
vi.mock("@/components/admin-review-queue", () => ({ AdminReviewQueue: () => null }));
vi.mock("@/components/trainer-workbench", () => ({ TrainerWorkbench: () => null }));

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "BK-PAY-001",
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
      canPay: true,
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

function chooseValidSlip() {
  const slip = new File(["image"], "slip.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("หลักฐานการโอน"), { target: { files: [slip] } });
  return slip;
}

describe("PaymentPanel", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("sends the exact booking, raw amount, and selected file before awaiting refresh", async () => {
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(authenticatedRequest).mockResolvedValue({ paymentId: 8, status: "reviewing" });
    render(<PaymentPanel booking={bookingFixture()} onUpdated={onUpdated} />);

    fireEvent.change(screen.getByLabelText("ยอดที่โอน"), { target: { value: "1200.00" } });
    const slip = chooseValidSlip();
    expect(screen.getByText("slip.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(1));
    const [path, init] = vi.mocked(authenticatedRequest).mock.calls[0];
    expect(path).toBe("/v1/payments");
    expect(init).toEqual(expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const body = init?.body as FormData;
    expect(body.get("bookingId")).toBe("BK-PAY-001");
    expect(body.get("amount")).toBe("1200.00");
    expect(body.get("slip")).toBe(slip);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("ส่งสลิปให้ผู้ดูแลตรวจแล้ว");
  });

  it.each(["", "0", "-10", "abc"])("blocks invalid amount %j", async (amount) => {
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ยอดที่โอน"), { target: { value: amount } });
    chooseValidSlip();
    fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));
    expect(await screen.findByText("กรุณาระบุยอดที่โอนเป็นจำนวนมากกว่า 0 บาท")).toBeInTheDocument();
    expect(screen.getByLabelText("ยอดที่โอน")).toHaveAttribute("aria-invalid", "true");
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("requires a transfer file", async () => {
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ยอดที่โอน"), { target: { value: "1200" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));
    expect(await screen.findByText("กรุณาเลือกไฟล์หลักฐานการโอน")).toBeInTheDocument();
    expect(screen.getByLabelText("หลักฐานการโอน")).toHaveAttribute("aria-invalid", "true");
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("lists accepted formats and rejects unsupported or oversized files before upload", () => {
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);
    const input = screen.getByLabelText("หลักฐานการโอน");
    expect(input).toHaveAttribute("accept", "image/jpeg,image/png,image/webp,application/pdf");
    expect(screen.getByText(/JPEG, PNG, WebP หรือ PDF/)).toHaveTextContent("ไม่เกิน 5 MB");

    fireEvent.change(input, { target: { files: [new File(["text"], "slip.txt", { type: "text/plain" })] } });
    expect(screen.getByText("รองรับเฉพาะไฟล์ JPEG, PNG, WebP หรือ PDF")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();

    const oversized = new File(["image"], "large.png", { type: "image/png" });
    Object.defineProperty(oversized, "size", { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [oversized] } });
    expect(screen.getByText("ไฟล์ต้องมีขนาดไม่เกิน 5 MB")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("announces a long selected filename without truncating its accessible text", () => {
    const longFilename = `หลักฐาน-${"ยาวมาก".repeat(40)}.pdf`;
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("หลักฐานการโอน"), {
      target: { files: [new File(["pdf"], longFilename, { type: "application/pdf" })] },
    });

    expect(screen.getByRole("status")).toHaveTextContent(`ไฟล์ที่เลือก: ${longFilename}`);
  });

  it("blocks a duplicate submit while the upload is busy", async () => {
    let resolveUpload!: (value: unknown) => void;
    vi.mocked(authenticatedRequest).mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve; }));
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(<PaymentPanel booking={bookingFixture()} onUpdated={onUpdated} />);
    fireEvent.change(screen.getByLabelText("ยอดที่โอน"), { target: { value: "1200" } });
    chooseValidSlip();

    const submit = screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" });
    fireEvent.click(submit);
    expect(await screen.findByRole("button", { name: "กำลังส่งสลิป…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "กำลังส่งสลิป…" }));
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    await act(async () => resolveUpload({ paymentId: 8, status: "reviewing" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it("retries a failed upload without losing the entered amount or filename", async () => {
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new Error("เครือข่ายขัดข้อง"))
      .mockResolvedValueOnce({ paymentId: 8, status: "reviewing" });
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(<PaymentPanel booking={bookingFixture()} onUpdated={onUpdated} />);
    fireEvent.change(screen.getByLabelText("ยอดที่โอน"), { target: { value: "1200" } });
    chooseValidSlip();
    fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("เครือข่ายขัดข้อง");
    expect(screen.getByLabelText("ยอดที่โอน")).toHaveValue(1200);
    expect(screen.getByText("slip.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลองส่งอีกครั้ง" }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it("retries only the refresh after an uploaded slip succeeds", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue({ paymentId: 8, status: "reviewing" });
    const onUpdated = vi.fn()
      .mockRejectedValueOnce(new Error("โหลดรายการไม่สำเร็จ"))
      .mockResolvedValueOnce(undefined);
    render(<PaymentPanel booking={bookingFixture()} onUpdated={onUpdated} />);
    fireEvent.change(screen.getByLabelText("ยอดที่โอน"), { target: { value: "1200" } });
    chooseValidSlip();
    fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("อัปโหลดสลิปแล้ว แต่โหลดสถานะล่าสุดไม่สำเร็จ");
    expect(screen.queryByRole("button", { name: "ส่งสลิปให้ตรวจ" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลองโหลดสถานะใหม่" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(2));
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("โหลดสถานะการชำระล่าสุดแล้ว");
  });

  it("shows the administrator's rejection note and an honest missing legacy amount", () => {
    render(<PaymentPanel booking={bookingFixture({
      paymentStatus: "rejected",
      payment: {
        id: 4,
        amount: null,
        status: "rejected",
        reviewNote: "ชื่อบัญชีในสลิปไม่ตรง กรุณาส่งไฟล์ใหม่",
        submittedAt: "2026-08-01T01:00:00.000Z",
      },
    })} onUpdated={vi.fn()} />);
    expect(screen.getByText("ชื่อบัญชีในสลิปไม่ตรง กรุณาส่งไฟล์ใหม่")).toBeInTheDocument();
    expect(screen.getByText("ไม่มียอดที่บันทึก")).toBeInTheDocument();
  });
});

describe("member booking ledger", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    localStorage.setItem("fitconnect_token", "member-token");
  });

  it("renders every booking in API order and exposes chat only when allowed", async () => {
    const first = bookingFixture({
      id: "BK-FIRST",
      actions: { ...bookingFixture().actions, canPay: false, canReadChat: true },
    });
    const second = bookingFixture({
      id: "BK-SECOND",
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ง." },
      status: "pending_trainer",
      quotedPrice: null,
      chatRoomId: null,
      actions: { ...bookingFixture().actions, canPay: false, canReadChat: false, canSendChat: false },
    });
    vi.mocked(authenticatedRequest).mockResolvedValue([first, second]);

    render(<RoleDashboard role="member" />);

    expect(await screen.findByRole("heading", { name: "คำขอ BK-FIRST" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "คำขอ BK-SECOND" })).toBeInTheDocument();
    const bookingHeadings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(bookingHeadings).toEqual(["คำขอ BK-FIRST", "คำขอ BK-SECOND"]);
    const chatLinks = screen.getAllByRole("link", { name: "เปิดการสนทนา" });
    expect(chatLinks).toHaveLength(1);
    expect(chatLinks[0]).toHaveAttribute("href", "/chat?booking=BK-FIRST");
  });
});
