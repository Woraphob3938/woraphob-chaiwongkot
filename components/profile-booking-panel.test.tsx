import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
  it("chooses a calendar slot, shows its summary, and exposes the existing booking URL", () => {
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
    fireEvent.click(within(dialog).getByRole("button", { name: "09:00 ถึง 10:00" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันเวลานี้" }));

    expect(screen.getByText("เลือกเวลาแล้ว")).toBeInTheDocument();
    expect(screen.getByText(/09:00 ถึง 10:00 น./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปลี่ยนเวลา" })).toBeInTheDocument();
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
});
