import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "@/components/status-badge";
import { bookingStatusCopy, paymentStatusCopy } from "@/lib/payment-copy";
import type { Booking, BookingStatus } from "@/lib/types";

/**
 * The badge used to keep its own copy of these words and drifted from
 * `lib/payment-copy.ts` (`payment_review` read "รอตรวจสลิป", `confirmed` read
 * "ยืนยันการชำระแล้ว"). These cases are the guard: every status the badge can
 * be handed must read exactly like the canonical table.
 */
describe("StatusBadge", () => {
  it.each(Object.entries(bookingStatusCopy) as Array<[BookingStatus, string]>)(
    "renders the canonical booking label for %s",
    (status, label) => {
      const { container } = render(<StatusBadge status={status} />);

      expect(screen.getByText(label)).toBeInTheDocument();
      expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    },
  );

  it.each(Object.entries(paymentStatusCopy) as Array<[Booking["paymentStatus"], string]>)(
    "renders the canonical payment label for %s",
    (status, label) => {
      render(<StatusBadge status={status} source="payment" />);

      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it("keeps a verification status in its own words", () => {
    render(<StatusBadge status="verified" />);

    expect(screen.getByText("โปรไฟล์ผ่านการตรวจ")).toBeInTheDocument();
  });

  it("reads a bare payment literal canonically when it has no verification meaning", () => {
    render(<StatusBadge status="reviewing" />);

    expect(screen.getByText(paymentStatusCopy.reviewing)).toBeInTheDocument();
  });

  it("does not label an approved application or a rejected certificate as a slip decision", () => {
    const { unmount } = render(<StatusBadge status="approved" />);
    expect(screen.getByText("อนุมัติแล้ว")).toBeInTheDocument();
    unmount();

    const rejectedCertificate = render(<StatusBadge status="rejected" />);
    expect(screen.getByText("ต้องแก้ไข")).toBeInTheDocument();
    rejectedCertificate.unmount();

    render(<StatusBadge status="rejected" source="payment" />);
    expect(screen.getByText(paymentStatusCopy.rejected)).toBeInTheDocument();
  });
  it("words a trainer's approval exactly as the administrator scope names it", () => {
    const { rerender } = render(<StatusBadge status="pending" source="approval" />);
    expect(screen.getByText("รออนุมัติ")).toBeInTheDocument();
    rerender(<StatusBadge status="approved" source="approval" />);
    expect(screen.getByText("อนุมัติแล้ว")).toBeInTheDocument();
    rerender(<StatusBadge status="rejected" source="approval" />);
    expect(screen.getByText("ถูกระงับ")).toBeInTheDocument();
  });

  it("calls a confirmed booking paid", () => {
    render(<StatusBadge status="confirmed" />);
    expect(screen.getByText("ชำระแล้ว")).toBeInTheDocument();
  });
});
