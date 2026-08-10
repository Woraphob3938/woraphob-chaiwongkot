import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaymentDeadline } from "@/components/payment-deadline";

describe("PaymentDeadline", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onExpired once when the server deadline is reached", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T03:00:00.000Z"));
    const onExpired = vi.fn();

    render(
      <PaymentDeadline
        deadlineAt="2026-08-10T03:00:02.000Z"
        onExpired={onExpired}
      />,
    );

    expect(screen.getByText("00:02")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("หมดเวลาแล้ว");
  });
});
