import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "@/components/booking-form";
import { apiRequest, authenticatedRequest, ApiError } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  authenticatedRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string, public status = 500, public code = "REQUEST_FAILED", public fields = {}) { super(message); }
  },
}));

const liveTrainer = {
  id: 1,
  slug: "live-trainer",
  displayName: "เทรนเนอร์จริง",
  headline: "ทดสอบ",
  bio: "",
  yearsExperience: 1,
  province: { id: 57, nameTh: "สกลนคร", region: "ตะวันออกเฉียงเหนือ" },
  serviceAreas: [],
  trainingTypes: [],
  serviceMode: "freelance" as const,
  priceFrom: 500,
  reviewCount: 0,
  verification: "verified" as const,
  certificates: [],
  slots: [{ id: 44, startsAt: "2026-08-10T02:00:00.000Z", endsAt: "2026-08-10T03:00:00.000Z", available: true }],
  demo: false,
};

describe("BookingForm", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(authenticatedRequest).mockReset();
    push.mockReset();
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify({ role: "member" }));
  });

  it("warns unauthenticated user to log in when submitting", async () => {
    localStorage.removeItem("fitconnect_token");
    localStorage.removeItem("fitconnect_user");
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    fireEvent.change(screen.getByLabelText("สถานที่ที่สะดวก"), { target: { value: "ฟิตเนสทดสอบ" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ }));
    expect(await screen.findByText("กรุณาเข้าสู่ระบบเพื่อทำการขอจอง")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("loads the selected trainer from the API before submitting", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    vi.mocked(authenticatedRequest).mockResolvedValue({ id: "BK-LIVE", status: "pending_trainer" });
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    fireEvent.change(screen.getByLabelText("สถานที่ที่สะดวก"), { target: { value: "ฟิตเนสกลางเมือง" } });
    fireEvent.change(screen.getByLabelText(/เป้าหมายหรือข้อจำกัดที่ควรรู้/), { target: { value: "เริ่มฝึกเวท" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings", {
      method: "POST",
      body: JSON.stringify({ trainerId: 1, slotId: 44, location: "ฟิตเนสกลางเมือง", note: "เริ่มฝึกเวท" }),
    }));
    expect(push).toHaveBeenCalledWith("/member?booking=BK-LIVE");
  });

  it("presents booking facts before an explicitly optional note and one submit action", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);

    const trainerName = await screen.findByText("เทรนเนอร์จริง");
    const note = screen.getByLabelText("เป้าหมายหรือข้อจำกัดที่ควรรู้ (ไม่บังคับ)");
    const submit = screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ });
    expect(trainerName.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /ยืนยันและส่งคำขอ/ })).toHaveLength(1);
  });

  it("does not reuse a preserved slot when the requested slot id changes", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    const { rerender } = render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");

    rerender(<BookingForm trainerSlug="live-trainer" slotId="99" />);

    expect(await screen.findByRole("heading", { name: "ช่วงเวลาที่เลือกถูกเปลี่ยน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ยืนยันและส่งคำขอ/ })).not.toBeInTheDocument();
  });

  it("keeps typed values but blocks a stale slot until a fresh valid slot is selected", async () => {
    const replacementSlot = { ...liveTrainer.slots[0], id: 45 };
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(liveTrainer)
      .mockResolvedValueOnce({ ...liveTrainer, slots: [] })
      .mockResolvedValueOnce({ ...liveTrainer, slots: [replacementSlot] });
    vi.mocked(authenticatedRequest).mockRejectedValue(new ApiError("ช่วงเวลานี้ไม่พร้อมจองแล้ว", 409, "SLOT_UNAVAILABLE"));
    const { rerender } = render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    const location = screen.getByLabelText("สถานที่ที่สะดวก");
    fireEvent.change(location, { target: { value: "สถานที่เดิม" } });
    const note = screen.getByLabelText(/เป้าหมายหรือข้อจำกัดที่ควรรู้/);
    fireEvent.change(note, { target: { value: "รักษาข้อมูลนี้ไว้" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ }));
    expect(await screen.findByText("ช่วงเวลานี้ไม่พร้อมจองแล้ว")).toBeInTheDocument();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("สถานที่ที่สะดวก")).toHaveValue("สถานที่เดิม");
    expect(screen.getByLabelText(/เป้าหมายหรือข้อจำกัดที่ควรรู้/)).toHaveValue("รักษาข้อมูลนี้ไว้");
    const staleSubmit = screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ });
    expect(staleSubmit).toBeDisabled();
    expect(screen.getByText("เวลาที่เลือกไม่ว่างแล้ว กรุณาเลือกเวลาใหม่")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เลือกเวลาอื่น" })).toHaveAttribute("href", "/trainers/live-trainer");
    fireEvent.click(staleSubmit);
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    rerender(<BookingForm trainerSlug="live-trainer" slotId="45" />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ })).toBeEnabled());
    expect(screen.queryByText("เวลาที่เลือกไม่ว่างแล้ว กรุณาเลือกเวลาใหม่")).not.toBeInTheDocument();
    expect(screen.queryByText("ช่วงเวลานี้ไม่พร้อมจองแล้ว")).not.toBeInTheDocument();
    expect(screen.getByLabelText("สถานที่ที่สะดวก")).toHaveValue("สถานที่เดิม");
    expect(screen.getByLabelText(/เป้าหมายหรือข้อจำกัดที่ควรรู้/)).toHaveValue("รักษาข้อมูลนี้ไว้");
  });

  it("displays form error message on API failure", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    vi.mocked(authenticatedRequest).mockRejectedValue(new ApiError(
      "เกิดข้อผิดพลาดจากระบบ",
      500,
      "SERVER_ERROR",
    ));
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    fireEvent.change(screen.getByLabelText("สถานที่ที่สะดวก"), { target: { value: "ฟิตเนสทดสอบ" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ }));
    expect(await screen.findByText("เกิดข้อผิดพลาดจากระบบ")).toBeInTheDocument();
  });
});
