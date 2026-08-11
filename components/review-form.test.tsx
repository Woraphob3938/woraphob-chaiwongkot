import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewForm } from "@/components/review-form";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

vi.mock("@/lib/api", () => ({ authenticatedRequest: vi.fn() }));

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "BK-REVIEW-001",
    trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
    startsAt: "2026-08-10T02:00:00.000Z",
    endsAt: "2026-08-10T03:00:00.000Z",
    status: "completed",
    paymentStatus: "approved",
    paymentDeadlineAt: null,
    quotedPrice: 1_200,
    chatRoomId: 7,
    payment: { id: 8, amount: 1_200, status: "approved", reviewNote: null, submittedAt: "2026-08-01T01:00:00.000Z" },
    review: null,
    actions: {
      canPay: false,
      canReadChat: true,
      canSendChat: false,
      canComplete: false,
      canReview: true,
      canCancel: false,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    demo: false,
    ...overrides,
  };
}

function completeReviewFields(comment = "  อธิบายชัดเจนและตรงเวลา  ") {
  fireEvent.click(screen.getByRole("radio", { name: "5 ดาว" }));
  fireEvent.change(screen.getByLabelText("ความคิดเห็น"), { target: { value: comment } });
}

describe("ReviewForm", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("shows review status before the open review action", () => {
    render(<ReviewForm booking={bookingFixture()} onUpdated={vi.fn()} />);

    const status = screen.getByText("สถานะรีวิว").closest("div");
    const submit = screen.getByRole("button", { name: "ส่งรีวิว" });
    expect(status).toBeVisible();
    expect(screen.getByText("ยังไม่มีรีวิวที่เผยแพร่")).toBeVisible();
    expect(submit).toBeEnabled();
    expect(status).not.toBeNull();
    expect((status as Node).compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows the factual published review summary without mounting another form", () => {
    render(<ReviewForm booking={bookingFixture({
      review: {
        rating: 4,
        comment: "สอนเข้าใจง่ายและดูแลท่าฝึกดี",
        status: "published",
        createdAt: "2026-08-10T04:00:00.000Z",
      },
      actions: { ...bookingFixture().actions, canReview: false },
    })} onUpdated={vi.fn()} />);

    expect(screen.getByText("เผยแพร่แล้ว")).toBeVisible();
    expect(screen.getByText("4 จาก 5 ดาว")).toBeVisible();
    expect(screen.getByText("สอนเข้าใจง่ายและดูแลท่าฝึกดี")).toBeVisible();
    expect(screen.queryByRole("button", { name: "ส่งรีวิว" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("ความคิดเห็น")).not.toBeInTheDocument();
  });

  it("submits the exact rating and trimmed comment before awaiting refresh", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue({ reviewId: 5, status: "published" });
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(<ReviewForm booking={bookingFixture()} onUpdated={onUpdated} />);
    completeReviewFields();
    fireEvent.click(screen.getByRole("button", { name: "ส่งรีวิว" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/reviews",
      { method: "POST", body: JSON.stringify({ bookingId: "BK-REVIEW-001", rating: 5, comment: "อธิบายชัดเจนและตรงเวลา" }) },
    ));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("status")).toHaveTextContent("เผยแพร่รีวิวแล้ว");
  });

  it("requires a rating and a non-blank trimmed comment", async () => {
    render(<ReviewForm booking={bookingFixture()} onUpdated={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("ความคิดเห็น"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งรีวิว" }));
    expect(await screen.findByText("กรุณาเลือกคะแนน 1 ถึง 5 ดาว")).toBeInTheDocument();
    expect(screen.getByText("กรุณาเขียนความคิดเห็นก่อนส่งรีวิว")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("enforces the backend limit of 2,000 characters", async () => {
    render(<ReviewForm booking={bookingFixture()} onUpdated={vi.fn()} />);
    completeReviewFields("ก".repeat(2_001));
    fireEvent.click(screen.getByRole("button", { name: "ส่งรีวิว" }));
    expect(await screen.findByText("ความคิดเห็นต้องไม่เกิน 2,000 ตัวอักษร")).toBeInTheDocument();
    expect(screen.getByLabelText("ความคิดเห็น")).toHaveAttribute("aria-invalid", "true");
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("does not mount the form when the server does not allow a review", () => {
    render(<ReviewForm booking={bookingFixture({ actions: { ...bookingFixture().actions, canReview: false } })} onUpdated={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "ส่งรีวิว" })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryByLabelText("ความคิดเห็น")).not.toBeInTheDocument();
    expect(screen.getByText("ยังเขียนรีวิวไม่ได้ตามสถานะการจองนี้")).toBeInTheDocument();
  });

  it("blocks a duplicate submit while the review is busy", async () => {
    let resolveReview!: (value: unknown) => void;
    vi.mocked(authenticatedRequest).mockImplementation(() => new Promise((resolve) => { resolveReview = resolve; }));
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(<ReviewForm booking={bookingFixture()} onUpdated={onUpdated} />);
    completeReviewFields();
    fireEvent.click(screen.getByRole("button", { name: "ส่งรีวิว" }));
    expect(await screen.findByRole("button", { name: "กำลังส่งรีวิว…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "กำลังส่งรีวิว…" }));
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
    await act(async () => resolveReview({ reviewId: 5, status: "published" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it("keeps the draft and can retry when the review request fails", async () => {
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new Error("ส่งข้อมูลไม่สำเร็จ"))
      .mockResolvedValueOnce({ reviewId: 5, status: "published" });
    const onUpdated = vi.fn().mockResolvedValue(undefined);
    render(<ReviewForm booking={bookingFixture()} onUpdated={onUpdated} />);
    completeReviewFields("รีวิวที่ต้องเก็บไว้");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรีวิว" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ส่งข้อมูลไม่สำเร็จ");
    expect(screen.getByLabelText("ความคิดเห็น")).toHaveValue("รีวิวที่ต้องเก็บไว้");
    expect(screen.getByRole("radio", { name: "5 ดาว" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "ลองส่งอีกครั้ง" }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(1));
  });

  it("retries only the refresh after the review was created", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue({ reviewId: 5, status: "published" });
    const onUpdated = vi.fn()
      .mockRejectedValueOnce(new Error("โหลดรายการไม่สำเร็จ"))
      .mockResolvedValueOnce(undefined);
    render(<ReviewForm booking={bookingFixture()} onUpdated={onUpdated} />);
    completeReviewFields("รีวิวหลังฝึกเสร็จ");
    fireEvent.click(screen.getByRole("button", { name: "ส่งรีวิว" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ส่งรีวิวแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ");
    expect(screen.queryByRole("button", { name: "ส่งรีวิว" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ลองโหลดรีวิวใหม่" }));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(2));
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("โหลดรีวิวล่าสุดแล้ว");
  });
});
