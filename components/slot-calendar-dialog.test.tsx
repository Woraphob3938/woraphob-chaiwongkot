import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SlotCalendarDialog } from "@/components/slot-calendar-dialog";
import { Button } from "@/components/ui/button";
import type { AvailabilitySlot } from "@/lib/types";

const slots: AvailabilitySlot[] = [
  {
    id: 1,
    startsAt: "2026-08-03T02:00:00.000Z",
    endsAt: "2026-08-03T03:00:00.000Z",
    available: true,
  },
  {
    id: 2,
    startsAt: "2026-08-03T10:00:00.000Z",
    endsAt: "2026-08-03T11:00:00.000Z",
    available: true,
  },
  {
    id: 3,
    startsAt: "2026-08-04T11:00:00.000Z",
    endsAt: "2026-08-04T12:00:00.000Z",
    available: true,
  },
];

function renderDialog(
  onConfirm = vi.fn(),
  selectedSlot: AvailabilitySlot | null = null,
) {
  render(
    <SlotCalendarDialog
      trainerName="เทรนเนอร์ทดสอบ"
      slots={slots}
      selectedSlot={selectedSlot}
      onConfirm={onConfirm}
    >
      <Button type="button">ดูตารางว่างทั้งหมด</Button>
    </SlotCalendarDialog>,
  );
  return onConfirm;
}

describe("SlotCalendarDialog", () => {
  it("confirms exactly the selected Bangkok date and time", async () => {
    const onConfirm = renderDialog();
    const trigger = screen.getByRole("button", { name: "ดูตารางว่างทั้งหมด" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "เลือกวันและเวลาฝึก" });
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: /วันที่ 3 สิงหาคม 2569.*2 ช่วงว่าง/,
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "17:00 ถึง 18:00" }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "ยืนยันเวลานี้" }),
    );

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(slots[1]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("preserves the confirmed slot when closed without confirmation", async () => {
    const onConfirm = renderDialog(vi.fn(), slots[0]);
    const trigger = screen.getByRole("button", { name: "ดูตารางว่างทั้งหมด" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "17:00 ถึง 18:00" }));
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("moves the selected day and clears the draft when changing month", () => {
    const septemberSlot: AvailabilitySlot = {
      id: 4,
      startsAt: "2026-09-02T02:00:00.000Z",
      endsAt: "2026-09-02T03:00:00.000Z",
      available: true,
    };
    render(
      <SlotCalendarDialog
        trainerName="เทรนเนอร์ทดสอบ"
        slots={[...slots, septemberSlot]}
        selectedSlot={slots[0]}
        onConfirm={vi.fn()}
      >
        <Button type="button">ดูตารางว่างทั้งหมด</Button>
      </SlotCalendarDialog>,
    );

    fireEvent.click(screen.getByRole("button", { name: "ดูตารางว่างทั้งหมด" }));
    fireEvent.click(screen.getByRole("button", { name: "เดือนถัดไป" }));

    expect(screen.getByRole("heading", { name: "กันยายน 2569" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /วันที่ 2 กันยายน 2569.*1 ช่วงว่าง/ }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "ยืนยันเวลานี้" })).toBeDisabled();
  });
});
