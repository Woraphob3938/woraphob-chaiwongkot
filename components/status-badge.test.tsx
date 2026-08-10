import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/status-badge";

describe("StatusBadge", () => {
  it.each([
    ["awaiting_payment", "รอชำระเงิน"],
    ["payment_review", "รอตรวจสลิป"],
    ["confirmed", "ยืนยันการชำระแล้ว"],
    ["completed", "ฝึกเสร็จแล้ว"],
    ["expired", "หมดเวลาแล้ว"],
  ] as const)("renders the exact workflow label for %s", (status, label) => {
    const { container } = render(<StatusBadge status={status} />);

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
