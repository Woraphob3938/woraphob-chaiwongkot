import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { ApiError, authenticatedRequest, openProtectedFile } from "@/lib/api";
import type { AdminQueue } from "@/lib/types";

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
    province: "เชียงใหม่",
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
  location: "สนามกีฬากลาง จังหวัดสกลนคร",
  quotedPrice: 1200,
  amount: 1000,
  difference: -200,
  submittedAt: "2026-08-01T02:00:00.000Z",
  fileUrl: "/v1/admin/files/payment/21",
};

function paymentQueue(payments: AdminQueue["payments"] = [payment]): AdminQueue {
  return { trainers: [], payments };
}

describe("AdminReviewQueue", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    vi.mocked(openProtectedFile).mockReset();
  });

  it("requires a note before trainer rejection and refreshes after success", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(trainerQueue)
      .mockResolvedValueOnce({ trainerId: 9, status: "rejected" })
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<AdminReviewQueue />);
    await screen.findByText("ผู้สมัครทดสอบ");
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

    const row = await screen.findByRole("article", { name: "ตรวจสลิป PAY-000021" });
    expect(within(row).getByText("คำขอจอง BK-000777")).toBeInTheDocument();
    expect(within(row).getByText("สมาชิกทดสอบ")).toBeInTheDocument();
    expect(within(row).getByText("เทรนเนอร์ทดสอบ")).toBeInTheDocument();
    expect(within(row).getByText("เสาร์ 1 ส.ค. · 10:00 น. ถึง เสาร์ 1 ส.ค. · 11:00 น.")).toBeInTheDocument();
    expect(within(row).getByText("สนามกีฬากลาง จังหวัดสกลนคร")).toBeInTheDocument();
    expect(within(row).getByText("฿1,200.00")).toBeInTheDocument();
    expect(within(row).getByText("฿1,000.00")).toBeInTheDocument();
    expect(within(row).getByText("-฿200.00")).toBeInTheDocument();
    expect(within(row).getByText("เสาร์ 1 ส.ค. · 09:00 น.")).toBeInTheDocument();
    expect(within(row).getByText("ผู้ดูแลกำลังตรวจหลักฐาน")).toBeInTheDocument();
  });

  it("requires a trimmed rejection note and sends that exact note", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockResolvedValueOnce({ paymentId: 21, status: "rejected" })
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await screen.findByText("PAY-000021");

    fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" }));
    expect(screen.getByText("กรุณาระบุเหตุผลที่สลิปไม่ผ่าน")).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("ผลตรวจสลิป PAY-000021"), { target: { value: "  ยอดโอนไม่ตรงกับราคาที่แจ้ง  " } });
    fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/admin/payments/21/reject",
      { method: "POST", body: JSON.stringify({ note: "ยอดโอนไม่ตรงกับราคาที่แจ้ง" }) },
    ));
  });

  it("keeps rejection notes isolated by payment ID", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue([
      payment,
      { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
    ]));

    render(<AdminReviewQueue />);
    await screen.findByText("PAY-000021");

    fireEvent.change(screen.getByLabelText("ผลตรวจสลิป PAY-000021"), { target: { value: "ยอดไม่ตรง" } });
    expect(screen.getByLabelText("ผลตรวจสลิป PAY-000021")).toHaveValue("ยอดไม่ตรง");
    expect(screen.getByLabelText("ผลตรวจสลิป PAY-000022")).toHaveValue("");
  });

  it("approves with an empty JSON body and does not require a note", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue())
      .mockResolvedValueOnce({ paymentId: 21, status: "approved" })
      .mockResolvedValueOnce(paymentQueue([]));

    render(<AdminReviewQueue />);
    await screen.findByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/admin/payments/21/approve",
      { method: "POST", body: JSON.stringify({}) },
    ));
  });

  it("blocks duplicate actions only in the busy payment row", async () => {
    let resolveDecision: ((value: unknown) => void) | undefined;
    const pendingDecision = new Promise((resolve) => { resolveDecision = resolve; });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(paymentQueue([
        payment,
        { ...payment, id: 22, bookingId: "BK-000778", fileUrl: "/v1/admin/files/payment/22" },
      ]))
      .mockReturnValueOnce(pendingDecision);

    render(<AdminReviewQueue />);
    const firstApprove = await screen.findByRole("button", { name: "อนุมัติสลิป PAY-000021" });
    fireEvent.click(firstApprove);

    await waitFor(() => expect(firstApprove).toBeDisabled());
    expect(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000022" })).not.toBeDisabled();
    fireEvent.click(firstApprove);
    expect(authenticatedRequest).toHaveBeenCalledTimes(2);

    resolveDecision?.({ paymentId: 21, status: "approved" });
  });

  it("opens protected slip evidence and reports file errors accessibly", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue());
    vi.mocked(openProtectedFile).mockRejectedValueOnce(new Error("เปิดไฟล์สลิปไม่ได้"));

    render(<AdminReviewQueue />);
    await screen.findByText("PAY-000021");
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
    await screen.findByText("PAY-000021");
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
    await screen.findByText("PAY-000021");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" }));

    expect(await screen.findByText("บันทึกผลแล้ว แต่ยังโหลดคิวล่าสุดไม่ได้")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "อนุมัติสลิป PAY-000021" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "ลองโหลดคิว PAY-000021 อีกครั้ง" }));
    await waitFor(() => expect(screen.queryByText("PAY-000021")).not.toBeInTheDocument());
  });

  it("labels unknown legacy payment amounts honestly", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(paymentQueue([{
      ...payment,
      quotedPrice: null,
      amount: null,
      difference: null,
    }]));

    render(<AdminReviewQueue />);
    const row = await screen.findByRole("article", { name: "ตรวจสลิป PAY-000021" });
    expect(within(row).getAllByText("ไม่มียอดที่บันทึก")).toHaveLength(2);
    expect(within(row).getByText("คำนวณส่วนต่างไม่ได้")).toBeInTheDocument();
    expect(within(row).queryByText("฿0.00")).not.toBeInTheDocument();
  });
});
