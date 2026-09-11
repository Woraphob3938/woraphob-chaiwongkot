import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileBookingPanel } from "@/components/profile-booking-panel";
import { trainers } from "@/lib/demo-data";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

function BookingPanelHarness({ trainer }: { trainer: Trainer }) {
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  return (
    <ProfileBookingPanel
      trainer={trainer}
      selectedSlot={selectedSlot}
      onSelectSlot={setSelectedSlot}
    />
  );
}

describe("ProfileBookingPanel", () => {
  it.each(["freelance", "gym", "both"] as const)("names the correct slip reviewer for %s", (serviceMode) => {
    render(<BookingPanelHarness trainer={{ ...trainers[0], serviceMode }} />);
    expect(screen.getByText(serviceMode === "freelance" ? /ส่งสลิปให้เทรนเนอร์ฟรีแลนซ์ตรวจอนุมัติ/ : /ส่งสลิปให้ผู้ดูแลระบบตรวจอนุมัติ/)).toBeInTheDocument();
    if (serviceMode === "freelance") expect(screen.queryByText(/ผู้ดูแลระบบตรวจอนุมัติ/)).not.toBeInTheDocument();
  });

  it("chooses a calendar slot, shows its summary, and exposes the existing booking URL", async () => {
    const trainer = { ...trainers[0], demo: false };
    render(<BookingPanelHarness trainer={trainer} />);

    expect(screen.getByRole("complementary", { name: "เลือกเวลาฝึก" })).toBeInTheDocument();
    expect(screen.getByText("ค่าฝึกต่อครั้ง")).toBeInTheDocument();
    expect(screen.queryByText(/เทรนเนอร์จะตรวจคำขอ/)).not.toBeInTheDocument();
    expect(screen.queryByText("ตารางว่างทั้งหมด")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกเวลาก่อน" })).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: /ดูตารางว่างทั้งหมด.*4 ช่วงพร้อมจอง/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "เลือกวันและเวลาฝึก" });
    fireEvent.click(within(dialog).getByRole("button", { name: "09:00–10:00" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันเวลานี้" }));

    expect(screen.getByText("เลือกเวลาแล้ว")).toBeInTheDocument();
    expect(screen.getByText(/09:00–10:00 น./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปลี่ยนเวลา" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "เปลี่ยนเวลา" })).toHaveFocus();
    });
    expect(screen.getByRole("link", { name: "จองเวลานี้" })).toHaveAttribute(
      "href",
      `/booking?trainer=${trainer.slug}&slot=${trainer.slots[0].id}`,
    );
  });

  it("explains when no available slot can be selected", () => {
    const trainer = {
      ...trainers[0],
      demo: false,
      slots: trainers[0].slots.map((slot) => ({ ...slot, available: false })),
    };
    render(<BookingPanelHarness trainer={trainer} />);

    expect(
      screen.getByRole("button", { name: /ยังไม่มีเวลาว่างให้จอง.*0 ช่วงพร้อมจอง/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "เลือกเวลาก่อน" })).toBeDisabled();
  });

  it("blocks booking when the trainer has not set a fixed session price", () => {
    const trainer = { ...trainers[0], demo: false, priceFrom: null };
    render(
      <ProfileBookingPanel
        trainer={trainer}
        selectedSlot={trainer.slots[0]}
        onSelectSlot={vi.fn()}
      />,
    );

    expect(screen.getByText("เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยังจองไม่ได้" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "จองเวลานี้" })).not.toBeInTheDocument();
  });

  it("starts a monthly package with one appointment and explains that the rest are scheduled later", () => {
    const trainer = {
      ...trainers[0],
      demo: false,
      monthlyPrice: 2400,
      monthlySessionCount: 2,
    };
    render(<BookingPanelHarness trainer={trainer} />);

    fireEvent.click(screen.getByRole("button", { name: "แพ็กเกจ 30 วัน" }));
    expect(screen.getByText("2 ครั้ง ภายใน 30 วัน")).toBeInTheDocument();
    expect(screen.getByText("เลือกนัดแรกก่อน อีก 1 นัดจัดเวลาได้หลังชำระเงินผ่าน")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เลือกเวลานัดแรก", expanded: false }));
    const dialog = screen.getByRole("dialog", { name: "เลือกวันและเวลานัดแรก" });
    fireEvent.click(within(dialog).getByRole("button", { name: "09:00–10:00" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันเวลานัดแรก" }));

    expect(screen.getByRole("link", { name: "จองแพ็กเกจนี้" })).toHaveAttribute(
      "href",
      `/booking?trainer=${trainer.slug}&type=monthly&slots=${trainer.slots[0].id}`,
    );
    expect(screen.getByText(/ผู้ดูแลระบบตรวจอนุมัติ/)).toBeInTheDocument();
  });
});
