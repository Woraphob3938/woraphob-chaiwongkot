import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    quotedPrice: 1_200,
    paymentRecipient: { accountName: "สมชาย ใจดี", promptPayId: "0812345678" },
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

function chooseValidSlip() {
  const slip = new File(["image"], "slip.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("หลักฐานการโอน"), { target: { files: [slip] } });
  return slip;
}

describe("PaymentPanel", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("shows status and the administrator note before an open payment action and closed evidence", () => {
    render(<PaymentPanel booking={bookingFixture({
      paymentStatus: "rejected",
      payment: {
        id: 4,
        amount: 1_200,
        status: "rejected",
        reviewNote: "ชื่อบัญชีในสลิปไม่ตรง กรุณาส่งไฟล์ใหม่",
        submittedAt: "2026-08-01T01:00:00.000Z",
      },
    })} onUpdated={vi.fn()} />);

    const status = screen.getByText("สถานะหลักฐาน").closest("div");
    const note = screen.getByText("ชื่อบัญชีในสลิปไม่ตรง กรุณาส่งไฟล์ใหม่");
    const submit = screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" });
    const evidenceTitle = screen.getByText("รายละเอียดหลักฐานเดิม");
    const evidence = evidenceTitle.closest("details");

    expect(status).toBeVisible();
    expect(note).toBeVisible();
    expect(submit).toBeEnabled();
    expect(evidence).not.toHaveAttribute("open");
    expect(within(evidence as HTMLElement).getByText("ยอดที่เคยส่ง")).toBeInTheDocument();
    expect(status).not.toBeNull();
    expect(screen.getByText("สลิปไม่ผ่าน กรุณาส่งใหม่ภายใน 10 นาที")).toBeInTheDocument();
    expect((status as Node).compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(submit.compareDocumentPosition(evidence as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("does not mount the upload form when payment is not allowed", () => {
    render(<PaymentPanel booking={bookingFixture({
      actions: { ...bookingFixture().actions, canPay: false },
    })} onUpdated={vi.fn()} />);

    expect(screen.getByText("สถานะหลักฐาน")).toBeVisible();
    expect(screen.queryByLabelText("ยอดที่โอน")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("หลักฐานการโอน")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งสลิปให้ตรวจ" })).not.toBeInTheDocument();
    expect(screen.getByText("ยังส่งสลิปไม่ได้ตามสถานะการจองนี้")).toBeVisible();
  });

  it("shows a fixed-amount QR and sends the slip without a transaction reference", async () => {
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    vi.mocked(authenticatedRequest).mockResolvedValue({ paymentId: 8, status: "reviewing" });
    render(<PaymentPanel booking={bookingFixture()} onUpdated={onUpdated} />);

    expect(screen.getAllByText("1,200.00 บาท")).toHaveLength(2);
    expect(screen.getByText("สมชาย ใจดี")).toBeInTheDocument();
    const slip = chooseValidSlip();
    expect(screen.getByText("slip.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(1));
    const [path, init] = vi.mocked(authenticatedRequest).mock.calls[0];
    expect(path).toBe("/v1/payments");
    expect(init).toEqual(expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const body = init?.body as FormData;
    expect(body.get("bookingId")).toBe("BK-PAY-001");
    expect(body.get("amount")).toBeNull();
    expect(body.get("transactionRef")).toBeNull();
    expect(body.get("slip")).toBe(slip);
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("ส่งสลิปให้ผู้รับผิดชอบตรวจแล้ว");
  });

  it("offers the trainer's default bank account beside PromptPay", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PaymentPanel
      booking={bookingFixture({ paymentRecipient: {
        accountName: "สมชาย ใจดี",
        promptPayId: "0812345678",
        bankAccount: { bankName: "กสิกรไทย", accountName: "สมชาย ใจดี", accountNumber: "1234567890" },
      } })}
      onUpdated={vi.fn()}
    />);

    const bank = screen.getByLabelText("โอนเข้าบัญชีธนาคาร");
    expect(within(bank).getByText("กสิกรไทย")).toBeInTheDocument();
    expect(within(bank).getByText("123-4-56789-0")).toBeInTheDocument();
    fireEvent.click(within(bank).getByRole("button", { name: "คัดลอกเลขบัญชี" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("1234567890"));
  });

  it("shows no bank block when the trainer has no bank account", () => {
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);
    expect(screen.queryByLabelText("โอนเข้าบัญชีธนาคาร")).not.toBeInTheDocument();
  });

  it("leads with the QR the trainer uploaded and keeps the amount QR one disclosure away", () => {
    render(<PaymentPanel
      booking={bookingFixture({ paymentRecipient: { accountName: "สมชาย ใจดี", promptPayId: "0812345678", paymentQrUrl: "/v1/trainer-payment-qr/3" } })}
      onUpdated={vi.fn()}
    />);

    // The uploaded image is the primary code, with the amount beside it and a
    // caution to check the recipient before transferring.
    const uploaded = screen.getByAltText("QR รับเงินของ สมชาย ใจดี");
    expect(uploaded).toBeInTheDocument();
    expect(uploaded.getAttribute("src")).toContain("/v1/trainer-payment-qr/3");
    expect(screen.getByText(/QR นี้เป็นภาพที่เทรนเนอร์อัปโหลด/)).toBeInTheDocument();
    expect(screen.getAllByText("1,200.00 บาท").length).toBeGreaterThan(0);

    // The generated, amount-carrying QR is available but not shown by default.
    const generated = screen.getByText("หรือใช้ QR พร้อมยอดเงิน").closest("details");
    if (!generated) throw new Error("generated QR disclosure is missing");
    expect(generated.open).toBe(false);
    expect(generated.querySelector("svg")).toBeTruthy();
  });

  it("falls back to the generated QR when the trainer never uploaded one", () => {
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);

    expect(screen.queryByAltText("QR รับเงินของ สมชาย ใจดี")).not.toBeInTheDocument();
    expect(screen.queryByText("หรือใช้ QR พร้อมยอดเงิน")).not.toBeInTheDocument();
    expect(document.querySelector(".payment-qr-card__code svg")).toBeTruthy();
  });

  it("requires a transfer file", async () => {
    render(<PaymentPanel booking={bookingFixture()} onUpdated={vi.fn()} />);
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
    chooseValidSlip();

    const submit = screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" });
    fireEvent.click(submit);
    expect(await screen.findByRole("button", { name: "กำลังส่งสลิป…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "กำลังส่งสลิป…" }));
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    await act(async () => resolveUpload({ paymentId: 8, status: "reviewing" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it("retries a failed upload without losing the filename", async () => {
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new Error("เครือข่ายขัดข้อง"))
      .mockResolvedValueOnce({ paymentId: 8, status: "reviewing" });
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(<PaymentPanel booking={bookingFixture()} onUpdated={onUpdated} />);
    chooseValidSlip();
    fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("เครือข่ายขัดข้อง");
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

  it("steps aside completely while the request waits for the trainer's answer", () => {
    const { container } = render(<PaymentPanel booking={bookingFixture({
      status: "pending_trainer",
      // Even a stale canPay must not open the payment step while the booking
      // is still pending_trainer.
      actions: { ...bookingFixture().actions, canPay: true },
    })} onUpdated={vi.fn()} />);

    expect(container.querySelector(".payment-panel")).toBeNull();
    expect(screen.queryByText("สถานะหลักฐาน")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งสลิปให้ตรวจ" })).not.toBeInTheDocument();
    expect(screen.queryByText("สมชาย ใจดี")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("หลักฐานการโอน")).not.toBeInTheDocument();
  });
});

describe("member booking ledger", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    localStorage.setItem("fitconnect_token", "member-token");
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
});
