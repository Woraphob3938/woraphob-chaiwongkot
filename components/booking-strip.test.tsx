import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BookingStrip } from "@/components/booking-strip";
import { trainers } from "@/lib/demo-data";

describe("BookingStrip", () => {
  it("exposes one compact unready summary before a trainer is selected", () => {
    render(<BookingStrip trainer={null} slot={null} />);

    const strip = screen.getByRole("complementary", { name: "สรุปการจอง" });
    expect(strip).toHaveClass("booking-strip--unready");
    expect(screen.getByText("ยังไม่เลือกเทรนเนอร์")).toHaveClass("booking-strip__compact-summary");
    expect(screen.getByRole("button", { name: "เลือกเทรนเนอร์" })).toBeDisabled();
  });

  it("keeps selected time and verification facts in the compact unready summary", () => {
    const trainer = { ...trainers[0], verification: "pending" as const };
    const slot = trainer.slots[0];
    render(<BookingStrip trainer={trainer} slot={slot} />);

    const summary = screen.getByText((_, element) => element?.classList.contains("booking-strip__compact-summary") ?? false);
    expect(summary).toHaveClass("booking-strip__compact-summary");
    expect(summary).toHaveTextContent(trainer.displayName);
    expect(summary).toHaveTextContent("จันทร์ 3 ส.ค. 09:00");
    expect(screen.getByRole("button", { name: "รอการตรวจคุณสมบัติ" })).toBeDisabled();
  });
});
