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
  trainingTypes: [],
  serviceMode: "freelance" as const,
  priceFrom: 500,
  monthlyPrice: 1800,
  monthlySessionCount: 2,
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

  it("explains that a trainer was chosen but no time was selected", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);

    render(<BookingForm trainerSlug="live-trainer" />);

    expect(await screen.findByRole("heading", { name: "ยังไม่ได้เลือกเวลา" })).toBeInTheDocument();
  });

  it("warns unauthenticated user to log in when submitting", async () => {
    localStorage.removeItem("fitconnect_token");
    localStorage.removeItem("fitconnect_user");
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    expect(screen.queryByLabelText("สถานที่ที่สะดวก")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ }));
    expect(await screen.findByText("กรุณาเข้าสู่ระบบเพื่อทำการขอจอง")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("loads the selected trainer from the API before submitting", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    vi.mocked(authenticatedRequest).mockResolvedValue({
      id: "BK-LIVE",
      status: "awaiting_payment",
      quotedPrice: 500,
      paymentDeadlineAt: "2026-08-10T02:10:00.000Z",
    });
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    fireEvent.change(screen.getByLabelText(/เป้าหมายหรือข้อจำกัดที่ควรรู้/), { target: { value: "เริ่มฝึกเวท" } });
    fireEvent.submit(screen.getByRole("form", { name: "ยืนยันการจอง" }));
    expect(screen.getByRole("dialog", { name: "ยืนยันและเริ่มเวลา 10 นาที" })).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเริ่มเวลา 10 นาที" }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings", {
      method: "POST",
      body: JSON.stringify({ trainerId: 1, slotId: 44, note: "เริ่มฝึกเวท" }),
    }));
    expect(push).toHaveBeenCalledWith("/member?booking=BK-LIVE");
  });

  it("presents booking facts before an explicitly optional note and one submit action", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);

    const trainerName = await screen.findByText("เทรนเนอร์จริง");
    const note = screen.getByLabelText("เป้าหมายหรือข้อจำกัดที่ควรรู้ (ไม่บังคับ)");
    const submit = screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ });
    expect(trainerName.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /ตรวจสอบและยืนยัน/ })).toHaveLength(1);
  });

  it("returns keyboard focus to the review button after dismissing confirmation", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);

    const reviewButton = await screen.findByRole("button", { name: /ตรวจสอบและยืนยัน/ });
    reviewButton.focus();
    fireEvent.click(reviewButton);
    expect(screen.getByRole("dialog", { name: "ยืนยันและเริ่มเวลา 10 นาที" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(reviewButton).toHaveFocus());
  });

  it("does not reuse a preserved slot when the requested slot id changes", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    const { rerender } = render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");

    rerender(<BookingForm trainerSlug="live-trainer" slotId="99" />);

    expect(await screen.findByRole("heading", { name: "ช่วงเวลาที่เลือกถูกเปลี่ยน" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตรวจสอบและยืนยัน/ })).not.toBeInTheDocument();
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
    const note = screen.getByLabelText(/เป้าหมายหรือข้อจำกัดที่ควรรู้/);
    fireEvent.change(note, { target: { value: "รักษาข้อมูลนี้ไว้" } });
    fireEvent.click(screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเริ่มเวลา 10 นาที" }));
    expect(await screen.findByText("ช่วงเวลานี้ไม่พร้อมจองแล้ว")).toBeInTheDocument();
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText(/เป้าหมายหรือข้อจำกัดที่ควรรู้/)).toHaveValue("รักษาข้อมูลนี้ไว้");
    const staleSubmit = screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ });
    expect(staleSubmit).toBeDisabled();
    expect(screen.getByText("เวลาที่เลือกไม่ว่างแล้ว กรุณาเลือกเวลาใหม่")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เลือกเวลาอื่น" })).toHaveAttribute("href", "/trainers/live-trainer");
    fireEvent.click(staleSubmit);
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    rerender(<BookingForm trainerSlug="live-trainer" slotId="45" />);
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ })).toBeEnabled());
    expect(screen.queryByText("เวลาที่เลือกไม่ว่างแล้ว กรุณาเลือกเวลาใหม่")).not.toBeInTheDocument();
    expect(screen.queryByText("ช่วงเวลานี้ไม่พร้อมจองแล้ว")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเริ่มเวลา 10 นาที" }));
    expect(await screen.findByText("เกิดข้อผิดพลาดจากระบบ")).toBeInTheDocument();
  });

  it("uses the trainer's fixed gym route without asking the member to choose a service mode", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ ...liveTrainer, serviceMode: "both" });
    vi.mocked(authenticatedRequest).mockResolvedValue({
      id: "BK-GYM",
      status: "awaiting_payment",
      quotedPrice: 500,
      paymentDeadlineAt: "2026-08-10T02:10:00.000Z",
    });

    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    expect(screen.queryByText("เลือกรูปแบบบริการ")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเริ่มเวลา 10 นาที" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings", {
      method: "POST",
      body: JSON.stringify({ trainerId: 1, slotId: 44, note: "", paymentServiceMode: "gym" }),
    }));
  });

  it("submits a monthly package with its first appointment and explains later scheduling", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    vi.mocked(authenticatedRequest).mockResolvedValue({
      id: "BK-MONTHLY",
      status: "awaiting_payment",
      quotedPrice: 1800,
      paymentDeadlineAt: "2026-08-10T02:10:00.000Z",
    });

    render(<BookingForm trainerSlug="live-trainer" bookingType="monthly" slotIds="44" />);
    await screen.findByText("แพ็กเกจ 30 วัน");
    expect(screen.getByText("นัดแรก 1 จาก 2 ครั้ง")).toBeInTheDocument();
    expect(screen.getByText("อีก 1 นัดจัดเวลาได้หลังการชำระเงินผ่าน")).toBeInTheDocument();
    expect(screen.getByText(/หากไม่ส่งสลิปภายในเวลา การจองจะหมดอายุ/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ตรวจสอบและยืนยัน/ }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเริ่มเวลา 10 นาที" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings", {
      method: "POST",
      body: JSON.stringify({ trainerId: 1, bookingType: "monthly", slotIds: [44], note: "" }),
    }));
  });
});
