import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { authenticatedRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost/fitconnect-api",
  authenticatedRequest: vi.fn(),
  openProtectedFile: vi.fn(),
}));

const queue = {
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

describe("AdminReviewQueue", () => {
  beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

  it("requires a note before rejection and refreshes after success", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(queue)
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
  });
});
