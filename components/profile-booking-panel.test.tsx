import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileBookingPanel } from "@/components/profile-booking-panel";
import { trainers } from "@/lib/demo-data";

describe("ProfileBookingPanel", () => {
  it("selects an available slot and exposes one direct booking action", () => {
    const trainer = { ...trainers[0], demo: false };
    const onSelectSlot = vi.fn();
    const { rerender } = render(
      <ProfileBookingPanel trainer={trainer} selectedSlot={null} onSelectSlot={onSelectSlot} />,
    );

    expect(screen.getByRole("complementary", { name: "เลือกเวลาฝึก" })).toBeInTheDocument();
    expect(screen.getByText("ค่าฝึกต่อครั้ง")).toBeInTheDocument();
    expect(screen.queryByText(/เทรนเนอร์จะตรวจคำขอ/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกเวลาก่อน" })).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: /\d{2}:\d{2}/ })[0]);
    expect(onSelectSlot).toHaveBeenCalledWith(trainer.slots[0]);

    rerender(
      <ProfileBookingPanel trainer={trainer} selectedSlot={trainer.slots[0]} onSelectSlot={onSelectSlot} />,
    );
    expect(screen.getByRole("link", { name: "จองเวลานี้" })).toHaveAttribute(
      "href",
      `/booking?trainer=${trainer.slug}&slot=${trainer.slots[0].id}`,
    );
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
