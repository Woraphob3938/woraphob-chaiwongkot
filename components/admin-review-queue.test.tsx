import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
};

describe("AdminReviewQueue", () => {
  beforeEach(() => {
    push.mockReset();
    vi.mocked(authenticatedRequest).mockReset();
    vi.mocked(openProtectedFile).mockReset();
  });

  it("puts one reachable next action before the count and the selected application", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(trainerQueue);

    render(<AdminReviewQueue />);

    const nextActionLabel = await screen.findByTestId("next-action");
    const trainerCountLabel = screen.getByText("ใบสมัครรอตรวจ");
    expect(nextActionLabel.compareDocumentPosition(trainerCountLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trainerCountLabel.nextElementSibling).toHaveTextContent("01");
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/admin/review-queue");
    // Payments settle through Stripe; nothing about slips is left to review.
    expect(screen.queryByText(/สลิป/)).not.toBeInTheDocument();

    const reviewQueue = screen.getByRole("navigation", { name: "คิวรายการรอตรวจ" });
    const trainerItem = within(reviewQueue).getByRole("button", { name: "เลือกตรวจใบสมัคร ผู้สมัครทดสอบ" });
    expect(trainerItem).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("region", { name: "หลักฐานของผู้สมัครทดสอบ" })).toHaveTextContent("ใบรับรอง");
    expect(screen.getByRole("complementary", { name: "คำตัดสินสำหรับผู้สมัครทดสอบ" })).toContainElement(
      screen.getByRole("button", { name: "อนุมัติ" }),
    );
  });

  it("requires a note before rejection and refreshes after success", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(trainerQueue)
      .mockResolvedValueOnce({ trainerId: 9, status: "rejected" })
      .mockResolvedValueOnce({ trainers: [] });

    render(<AdminReviewQueue />);
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

  it("explains a stale 409 decision after reloading the queue", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(trainerQueue)
      .mockRejectedValueOnce(new ApiError("ใบสมัครนี้มีผลตรวจแล้ว", 409))
      .mockResolvedValueOnce({ trainers: [] });

    render(<AdminReviewQueue />);
    await screen.findAllByText("ผู้สมัครทดสอบ");
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));

    expect(await screen.findByRole("status")).toHaveTextContent("ผู้ดูแลระบบคนอื่นบันทึกผลรายการนี้แล้ว โหลดคิวล่าสุดแล้ว");
  });

  it("opens a certificate PDF and reports a file error accessibly", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(trainerQueue);
    vi.mocked(openProtectedFile).mockRejectedValueOnce(new Error("เปิดไฟล์ไม่สำเร็จ"));

    render(<AdminReviewQueue />);
    fireEvent.click(await screen.findByRole("button", { name: "เปิด PDF" }));

    expect(openProtectedFile).toHaveBeenCalledWith("/v1/admin/files/certificate/12");
    expect(await screen.findByRole("alert")).toHaveTextContent("เปิดไฟล์ไม่สำเร็จ");
  });

  it("offers a retry when the queue cannot load", async () => {
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new Error("โหลดคิวตรวจสอบไม่สำเร็จ"))
      .mockResolvedValueOnce({ trainers: [] });

    render(<AdminReviewQueue />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ยังเปิดคิวตรวจสอบไม่ได้");
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));

    expect(await screen.findByRole("heading", { name: "ตรวจสอบและอนุมัติข้อมูลเทรนเนอร์" })).toBeInTheDocument();
  });
});
