import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { ApiError, authenticatedRequest, openProtectedFile } from "@/lib/api";
import type { AdminQueue } from "@/lib/types";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    API_URL: "http://localhost/fitconnect-api",
    authenticatedRequest: vi.fn(),
    openProtectedFile: vi.fn(),
  };
});

const trainerQueue: AdminQueue = {
  trainers: [{
    id: 9,
    slug: "trainer-nine",
    displayName: "ผู้สมัครทดสอบ",
    submittedAt: "2026-08-01T00:00:00.000Z",
    certificates: [{ id: 12, name: "ใบรับรอง", issuer: "สถาบันทดสอบ", submittedAt: "2026-08-01T00:00:00.000Z", fileUrl: "/v1/admin/files/certificate/12" }],
  }],
  payments: [],
};

const payment = {
  id: 21,
  bookingId: "BK-000777",
  memberName: "สมาชิกทดสอบ",
  trainerName: "เทรนเนอร์ทดสอบ",
  startsAt: "2026-08-01T03:00:00.000Z",
  endsAt: "2026-08-01T04:00:00.000Z",
  quotedPrice: 1200,
  amount: 1000,
  difference: -200,
  submittedAt: "2026-08-01T02:00:00.000Z",
  fileUrl: "/v1/admin/files/payment/21",
};

function paymentQueue(payments: AdminQueue["payments"] = [payment]): AdminQueue {
  return { trainers: [], payments };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openQueueDisclosure(label: "ใบสมัครเทรนเนอร์" | "หลักฐานการชำระเงิน") {
  const queue = await screen.findByRole("navigation", { name: "คิวรายการรอตรวจ" });
  const selections = label === "ใบสมัครเทรนเนอร์"
    ? within(queue).getAllByRole("button", { name: /เลือกตรวจใบสมัคร/ })
    : within(queue).getAllByRole("button", { name: /เลือกตรวจสลิป/ });
  const selection = selections[0];
  if (selection.getAttribute("aria-current") !== "true") fireEvent.click(selection);
  return selection;
}

describe("AdminReviewQueue", () => {
  beforeEach(() => {
    push.mockReset();
    vi.mocked(authenticatedRequest).mockReset();
    vi.mocked(openProtectedFile).mockReset();
  });

  it("puts one reachable next action before factual counts and the selected review workbench", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce({
      trainers: trainerQueue.trainers,
      payments: [payment],
    });

    render(<AdminReviewQueue />);

    const nextActionLabel = await screen.findByText("สิ่งที่ต้องทำต่อ");
    const trainerCountLabel = screen.getByText("ใบสมัครรอตรวจ");
    const paymentCountLabel = screen.getByText("สลิปรอตรวจ");
    expect(nextActionLabel.compareDocumentPosition(trainerCountLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nextActionLabel.compareDocumentPosition(paymentCountLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trainerCountLabel.nextElementSibling).toHaveTextContent("01");
    expect(paymentCountLabel.nextElementSibling).toHaveTextContent("01");

    const queue = document.getElementById("review-queue");
    expect(queue).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เปิดคิวตรวจสอบ" })).toHaveAttribute("href", "/admin#review-queue");

    const reviewQueue = screen.getByRole("navigation", { name: "คิวรายการรอตรวจ" });
    const trainerItem = within(reviewQueue).getByRole("button", { name: "เลือกตรวจใบสมัคร ผู้สมัครทดสอบ" });
    const paymentItem = within(reviewQueue).getByRole("button", { name: "เลือกตรวจสลิป PAY-000021" });
    expect(trainerItem).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "ปฏิเสธ" })).toBeInTheDocument();

    fireEvent.click(paymentItem);
    expect(paymentItem).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" })).toBeInTheDocument();
  });

  it("uses one queue, evidence workspace, and decision panel for the selected review", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce({
      trainers: trainerQueue.trainers,
      payments: [payment],
    });

    render(<AdminReviewQueue />);

    const reviewQueue = await screen.findByRole("navigation", { name: "คิวรายการรอตรวจ" });
    const trainerItem = within(reviewQueue).getByRole("button", { name: "เลือกตรวจใบสมัคร ผู้สมัครทดสอบ" });
    const paymentItem = within(reviewQueue).getByRole("button", { name: "เลือกตรวจสลิป PAY-000021" });
    expect(trainerItem).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("region", { name: "หลักฐานของผู้สมัครทดสอบ" })).toHaveTextContent("ใบรับรอง");
    expect(screen.getByRole("complementary", { name: "คำตัดสินสำหรับผู้สมัครทดสอบ" })).toContainElement(
      screen.getByRole("button", { name: "อนุมัติ" }),
    );

    fireEvent.click(paymentItem);

    expect(paymentItem).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("region", { name: "หลักฐานของสลิป PAY-000021" })).toHaveTextContent("คำขอจอง BK-000777");
    expect(screen.getByRole("complementary", { name: "คำตัดสินสำหรับสลิป PAY-000021" })).toContainElement(
      screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }),
    );
  });

  it("requires a note before trainer rejection and refreshes after success", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(trainerQueue)
      .mockResolvedValueOnce({ trainerId: 9, status: "rejected" })
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<AdminReviewQueue />);
    await openQueueDisclosure("ใบสมัครเทรนเนอร์");
    await screen.findAllByText("ผู้สมัครทดสอบ");
    fireEvent.click(screen.getByRole("button", { name: "ปฏิเสธ" }));
    expect(screen.getByText("กรุณาระบุเหตุผลก่อนปฏิเสธ")).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("หมายเหตุสำหรับผู้สมัครทดสอบ"), { target: { value: "เอกสารไม่ชัดเจน" } });
    fireEvent.click(screen.getByRole("button", { name: "ปฏิเสธ" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/admin/trainers/9/reject",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "เอกสารไม่ชัดเจน" }) }),
    ));
    await waitFor(() => expect(screen.queryByText("ผู้สมัครทดสอบ")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("ปฏิเสธใบสมัครผู้สมัครทดสอบแล้ว");
  });

  it("renders the payment evidence with Thai appointment and currency formatting", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue());

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");

    const row = await screen.findByRole("article", { name: "ตรวจสลิป PAY-000021" });
    expect(within(row).getByText("คำขอจอง BK-000777")).toBeInTheDocument();
    expect(within(row).getByText("สมาชิกทดสอบ")).toBeInTheDocument();
    expect(within(row).getByText("เทรนเนอร์ทดสอบ")).toBeInTheDocument();
    expect(within(row).getByText("เสาร์ 1 ส.ค. · 10:00 น. ถึง เสาร์ 1 ส.ค. · 11:00 น.")).toBeInTheDocument();
    expect(within(row).queryByText("สถานที่")).not.toBeInTheDocument();
    expect(within(row).getByText("฿1,200.00")).toBeInTheDocument();
    expect(within(row).getByText("฿1,000.00")).toBeInTheDocument();
    expect(within(row).getByText("-฿200.00")).toBeInTheDocument();
    expect(within(row).getByText("เสาร์ 1 ส.ค. · 09:00 น.")).toBeInTheDocument();
    expect(within(row).getByText("ผู้ดูแลกำลังตรวจหลักฐาน")).toBeInTheDocument();
  });

  it("gives long unbroken evidence values an explicit wrapping contract", async () => {
    const longBooking = `BK-${"X".repeat(90)}`;
    const longTrainer = `เทรนเนอร์${"ย".repeat(90)}`;
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue([{
      ...payment,
      bookingId: longBooking,
      trainerName: longTrainer,
    }]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    const row = await screen.findByRole("article", { name: "ตรวจสลิป PAY-000021" });

    const wrappedValues = [
      within(row).getByText(`คำขอจอง ${longBooking}`),
      within(row).getByText(longTrainer),
    ];
    for (const value of wrappedValues) {
      expect(value).toHaveStyle({ display: "block", minWidth: "0", maxWidth: "100%", overflowWrap: "anywhere" });
    }
  });

  it("requires a trimmed rejection note and sends that exact note", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockResolvedValueOnce({ paymentId: 21, status: "rejected" })
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");

    fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" }));
    expect(screen.getByText("กรุณาระบุเหตุผลที่สลิปไม่ผ่าน")).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("ผลตรวจสลิป PAY-000021"), { target: { value: "  ยอดโอนไม่ตรงกับค่าฝึกต่อครั้ง  " } });
    fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/admin/payments/21/reject",
      { method: "POST", body: JSON.stringify({ note: "ยอดโอนไม่ตรงกับค่าฝึกต่อครั้ง" }) },
    ));
  });

  it.each([
    ["awaiting_payment", "ให้สมาชิกส่งใหม่ภายใน 10 นาที"],
    ["expired", "ปฏิเสธครั้งที่สองและคืนช่วงเวลาแล้ว"],
  ] as const)("uses the server booking status after rejecting a payment: %s", async (bookingStatus, notice) => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockResolvedValueOnce({ paymentId: 21, status: "rejected", bookingStatus, paymentDeadlineAt: bookingStatus === "awaiting_payment" ? "2099-08-10T02:10:00.000Z" : null })
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    fireEvent.change(screen.getByLabelText("ผลตรวจสลิป PAY-000021"), { target: { value: "สลิปไม่ชัด" } });
    fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" }));

    await waitFor(() => expect(screen.queryByText("PAY-000021")).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent(notice);
  });

  it("keeps rejection notes isolated by payment ID", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue([
      payment,
      { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
    ]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");

    fireEvent.change(screen.getByLabelText("ผลตรวจสลิป PAY-000021"), { target: { value: "ยอดไม่ตรง" } });
    expect(screen.getByLabelText("ผลตรวจสลิป PAY-000021")).toHaveValue("ยอดไม่ตรง");
    fireEvent.click(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000022" }));
    expect(screen.getByLabelText("ผลตรวจสลิป PAY-000022")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000021" }));
    expect(screen.getByLabelText("ผลตรวจสลิป PAY-000021")).toHaveValue("ยอดไม่ตรง");
  });

  it("approves with an empty JSON body and does not require a note", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockResolvedValueOnce({ paymentId: 21, status: "approved" })
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/admin/payments/21/approve",
      { method: "POST", body: JSON.stringify({}) },
    ));
  });

  it("locks only the busy payment while another decision stays available", async () => {
    let resolveDecision: ((value: unknown) => void) | undefined;
    const pendingDecision = new Promise((resolve) => { resolveDecision = resolve; });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue([
        payment,
        { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
      ]))
      .mockReturnValueOnce(pendingDecision);

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    const firstApprove = await screen.findByRole("button", { name: "อนุมัติสลิป PAY-000021" });
    fireEvent.click(firstApprove);

    await waitFor(() => expect(firstApprove).toBeDisabled());
    expect(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000021" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000022" }));
    expect(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000022" })).not.toBeDisabled();
    expect(authenticatedRequest).toHaveBeenCalledTimes(2);

    resolveDecision?.({ paymentId: 21, status: "approved" });
  });

  it("opens protected slip evidence and reports file errors accessibly", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue());
    vi.mocked(openProtectedFile).mockRejectedValueOnce(new Error("เปิดไฟล์สลิปไม่ได้"));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "เปิดสลิป PAY-000021" }));

    await waitFor(() => expect(openProtectedFile).toHaveBeenCalledWith("/v1/admin/files/payment/21"));
    expect(await screen.findByRole("alert")).toHaveTextContent("เปิดไฟล์สลิปไม่ได้");
  });

  it("keeps payment actions available to retry after a request error", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockRejectedValueOnce(new Error("บันทึกผลไม่สำเร็จ กรุณาลองอีกครั้ง"))
      .mockResolvedValueOnce({ paymentId: 21, status: "approved" })
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    const approve = await screen.findByRole("button", { name: "อนุมัติสลิป PAY-000021" });
    fireEvent.click(approve);

    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกผลไม่สำเร็จ กรุณาลองอีกครั้ง");
    expect(approve).not.toBeDisabled();
    fireEvent.click(approve);

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(4));
    expect(screen.queryByText("PAY-000021")).not.toBeInTheDocument();
  });

  it("refreshes and explains a stale 409 payment decision", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockRejectedValueOnce(new ApiError("หลักฐานนี้ได้รับการตัดสินแล้ว", 409, "PAYMENT_ALREADY_REVIEWED"))
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("status")).toHaveTextContent("ผู้ดูแลคนอื่นบันทึกผลรายการนี้แล้ว");
    expect(screen.queryByText("PAY-000021")).not.toBeInTheDocument();
  });

  it("keeps a locally resolved payment inert when refresh fails and offers retry", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockResolvedValueOnce({ paymentId: 21, status: "approved" })
      .mockRejectedValueOnce(new Error("โหลดคิวล่าสุดไม่สำเร็จ"))
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));

    expect(await screen.findByText("บันทึกผลแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "ลองโหลดคิว PAY-000021 อีกครั้ง" }));
    await waitFor(() => expect(screen.queryByText("PAY-000021")).not.toBeInTheDocument());
  });

  it("ignores an older queue response after a newer refresh has applied", async () => {
    const olderRefresh = deferred<AdminQueue>();
    const newerRefresh = deferred<AdminQueue>();
    let queueLoads = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path.includes("/v1/admin/payments/")) return Promise.resolve({ status: "approved" });
      queueLoads += 1;
      if (queueLoads === 1) {
        return Promise.resolve(paymentQueue([
          payment,
          { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
        ]));
      }
      return queueLoads === 2 ? olderRefresh.promise : newerRefresh.promise;
    });

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));
    fireEvent.click(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000022" }));
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000022" }));
    await waitFor(() => expect(queueLoads).toBe(3));

    newerRefresh.resolve(paymentQueue([]));
    await waitFor(() => expect(screen.queryByText("PAY-000021")).not.toBeInTheDocument());
    expect(screen.queryByText("PAY-000022")).not.toBeInTheDocument();
    expect(screen.getByText("ข้อมูลจากระบบ")).toBeInTheDocument();

    olderRefresh.resolve(paymentQueue([
      payment,
      { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
    ]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "อนุมัติสลิป PAY-000021" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "อนุมัติสลิป PAY-000022" })).not.toBeInTheDocument();
    expect(screen.getByText("ข้อมูลจากระบบ")).toBeInTheDocument();
  });

  it("does not let an obsolete refresh failure clear loading or show an error", async () => {
    const olderRefresh = deferred<AdminQueue>();
    const newerRefresh = deferred<AdminQueue>();
    let queueLoads = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path.includes("/v1/admin/payments/")) return Promise.resolve({ status: "approved" });
      queueLoads += 1;
      if (queueLoads === 1) {
        return Promise.resolve(paymentQueue([
          payment,
          { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
        ]));
      }
      return queueLoads === 2 ? olderRefresh.promise : newerRefresh.promise;
    });

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));
    fireEvent.click(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000022" }));
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000022" }));
    await waitFor(() => expect(queueLoads).toBe(3));

    olderRefresh.reject(new Error("คำขอเก่าล้มเหลว"));
    await waitFor(() => expect(screen.getByText("กำลังอัปเดต")).toBeInTheDocument());
    expect(screen.queryByText("บันทึกผลแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000021" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000022" })).toBeDisabled();

    newerRefresh.resolve(paymentQueue([]));
    await waitFor(() => expect(screen.queryByText("PAY-000021")).not.toBeInTheDocument());
    expect(screen.getByText("ข้อมูลจากระบบ")).toBeInTheDocument();
  });

  it("keeps the newest refresh failure when an older response completes later", async () => {
    const olderRefresh = deferred<AdminQueue>();
    const newerRefresh = deferred<AdminQueue>();
    let queueLoads = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path.includes("/v1/admin/payments/")) return Promise.resolve({ status: "approved" });
      queueLoads += 1;
      if (queueLoads === 1) {
        return Promise.resolve(paymentQueue([
          payment,
          { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
        ]));
      }
      return queueLoads === 2 ? olderRefresh.promise : newerRefresh.promise;
    });

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));
    fireEvent.click(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000022" }));
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000022" }));
    await waitFor(() => expect(queueLoads).toBe(3));

    newerRefresh.reject(new Error("โหลดคิวล่าสุดไม่สำเร็จ"));
    expect(await screen.findByText("บันทึกผลสลิป PAY-000022 แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้")).toBeInTheDocument();

    await act(async () => {
      olderRefresh.resolve(paymentQueue([
        payment,
        { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
      ]));
      await Promise.resolve();
    });

    expect(screen.getByText("บันทึกผลสลิป PAY-000022 แล้ว แต่ยังโหลดคิวล่าสุดไม่ได้")).toBeInTheDocument();
    expect(screen.queryByText("อนุมัติสลิป PAY-000021 แล้ว")).not.toBeInTheDocument();
    expect(screen.getByText("บันทึกผลแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้")).toBeInTheDocument();
  });

  it("does not announce success for a retry superseded by a newer refresh", async () => {
    const olderRetry = deferred<AdminQueue>();
    const newerRefresh = deferred<AdminQueue>();
    let queueLoads = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path.includes("/v1/admin/payments/")) return Promise.resolve({ status: "approved" });
      queueLoads += 1;
      if (queueLoads === 1) {
        return Promise.resolve(paymentQueue([
          payment,
          { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
        ]));
      }
      if (queueLoads === 2) return Promise.reject(new Error("โหลดคิวล่าสุดไม่สำเร็จ"));
      return queueLoads === 3 ? olderRetry.promise : newerRefresh.promise;
    });

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    await screen.findAllByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));
    const retry = await screen.findByRole("button", { name: "ลองโหลดคิว PAY-000021 อีกครั้ง" });
    fireEvent.click(retry);
    await waitFor(() => expect(queueLoads).toBe(3));

    fireEvent.click(screen.getByRole("button", { name: "เลือกตรวจสลิป PAY-000022" }));
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000022" }));
    await waitFor(() => expect(queueLoads).toBe(4));
    newerRefresh.resolve(paymentQueue([]));
    expect(await screen.findByText("อนุมัติสลิป PAY-000022 แล้ว")).toBeInTheDocument();

    await act(async () => {
      olderRetry.resolve(paymentQueue([
        payment,
        { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
      ]));
      await Promise.resolve();
    });

    expect(screen.getByText("อนุมัติสลิป PAY-000022 แล้ว")).toBeInTheDocument();
    expect(screen.queryByText("โหลดคิวตรวจสอบล่าสุดแล้ว")).not.toBeInTheDocument();
  });

  it("labels unknown legacy payment amounts honestly", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue([{
      ...payment,
      quotedPrice: null,
      amount: null,
      difference: null,
    }]));

    render(<AdminReviewQueue />);
    await openQueueDisclosure("หลักฐานการชำระเงิน");
    const row = await screen.findByRole("article", { name: "ตรวจสลิป PAY-000021" });
    expect(within(row).getAllByText("ไม่มียอดที่บันทึก")).toHaveLength(2);
    expect(within(row).getByText("คำนวณส่วนต่างไม่ได้")).toBeInTheDocument();
    expect(within(row).queryByText("฿0.00")).not.toBeInTheDocument();
  });
});
