import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationForm } from "@/components/application-form";
import { apiRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({ apiRequest: vi.fn() }));

describe("ApplicationForm", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequest).mockResolvedValue({ saved: true });
    localStorage.setItem("fitconnect_token", "trainer-token");
  });

  it("submits professional information without province data", async () => {
    render(<ApplicationForm />);

    expect(screen.queryByLabelText(/จังหวัด|พื้นที่หลักที่ให้บริการ/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ชื่อ-นามสกุล"), { target: { value: "เทรนเนอร์ ทดสอบ" } });
    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "0812345678" } });
    fireEvent.change(screen.getByLabelText("ประสบการณ์และแนวทางการฝึก"), { target: { value: "ดูแลการฝึกเวทอย่างปลอดภัย" } });
    fireEvent.change(screen.getByLabelText(/ใบรับรอง/), {
      target: { files: [new File(["certificate"], "certificate.pdf", { type: "application/pdf" })] },
    });
    fireEvent.submit(screen.getByRole("button", { name: /ส่งให้ผู้ดูแลระบบตรวจ/ }).closest("form")!);

    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(1));
    const request = vi.mocked(apiRequest).mock.calls[0]?.[1];
    expect(request?.body).toBeInstanceOf(FormData);
    expect((request?.body as FormData).has("provinceId")).toBe(false);
  });
});
