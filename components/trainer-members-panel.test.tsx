import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerMembersPanel, TrainerReviewsPanel } from "@/components/trainer-members-panel";
import { authenticatedRequest } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

describe("Trainer members and reviews", () => {
  beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

  it("lists members with their training history and searches by name", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce([
      {
        id: 1, displayName: "สมชาย", imageUrl: null, goals: "ลดน้ำหนัก", experienceLevel: null,
        totalBookings: 2, completedSessions: 1, activeBookings: 1,
        nextSessionAt: "2026-10-01T05:00:00.000Z", lastSessionAt: "2026-09-01T05:00:00.000Z",
        history: [
          { id: "BK-2", status: "confirmed", bookingType: "single", sessionCount: 1, startsAt: "2026-10-01T05:00:00.000Z", endsAt: "2026-10-01T06:00:00.000Z", quotedPrice: 700 },
          { id: "BK-1", status: "completed", bookingType: "single", sessionCount: 1, startsAt: "2026-09-01T05:00:00.000Z", endsAt: "2026-09-01T06:00:00.000Z", quotedPrice: 700 },
        ],
      },
      { id: 2, displayName: "สมหญิง", imageUrl: null, goals: null, experienceLevel: null, totalBookings: 1, completedSessions: 0, activeBookings: 0, nextSessionAt: null, lastSessionAt: null, history: [] },
    ]);
    render(<TrainerMembersPanel />);
    const list = await screen.findByRole("list", { name: "รายชื่อสมาชิก" });
    expect(list.querySelectorAll(":scope > li")).toHaveLength(2);
    const history = screen.getByRole("list", { name: "ประวัติการฝึกของ สมชาย" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText(/นัดถัดไป/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ค้นหาสมาชิก"), { target: { value: "หญิง" } });
    expect(screen.getByRole("list", { name: "รายชื่อสมาชิก" }).querySelectorAll(":scope > li")).toHaveLength(1);
  });

  it("shows the average score, distribution and reviews", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce({
      count: 2, average: 4.5, distribution: { 5: 1, 4: 1, 3: 0, 2: 0, 1: 0 },
      reviews: [{ id: 1, rating: 5, comment: "สอนดีมาก", createdAt: "2026-09-02T00:00:00.000Z", bookingId: "BK-1", memberName: "สมชาย" }],
    });
    render(<TrainerReviewsPanel />);
    expect(await screen.findByText("4.5")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "คะแนนเฉลี่ย 4.5 จาก 5" })).toBeInTheDocument();
    expect(screen.getByText("สอนดีมาก")).toBeInTheDocument();
  });
  it("pages a long member list ten at a time", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(Array.from({ length: 23 }, (_, index) => ({
      id: index + 1, displayName: `สมาชิก ${String(index + 1).padStart(2, "0")}`, imageUrl: null, goals: null, experienceLevel: null,
      totalBookings: 1, completedSessions: 0, activeBookings: 0, nextSessionAt: null, lastSessionAt: null, history: [],
    })));
    render(<TrainerMembersPanel />);
    const list = await screen.findByRole("list", { name: "รายชื่อสมาชิก" });
    expect(list.querySelectorAll(":scope > li")).toHaveLength(10);
    expect(screen.getByText("แสดง 1–10 จาก 23")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "หน้า 3" }));
    expect(screen.getByRole("list", { name: "รายชื่อสมาชิก" }).querySelectorAll(":scope > li")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "หน้าถัดไป" })).toBeDisabled();
  });

  it("filters reviews by star and pages five at a time", async () => {
    const reviews = Array.from({ length: 7 }, (_, index) => ({
      id: index + 1, rating: index < 6 ? 5 : 3, comment: `รีวิว ${index + 1}`, createdAt: "2026-09-02T00:00:00.000Z", bookingId: `BK-${index}`, memberName: "สมชาย",
    }));
    vi.mocked(authenticatedRequest).mockResolvedValueOnce({ count: 7, average: 4.7, distribution: { 5: 6, 4: 0, 3: 1, 2: 0, 1: 0 }, reviews });
    render(<TrainerReviewsPanel />);
    const list = await screen.findByRole("list", { name: "รีวิวจากสมาชิก" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "3 ดาว" }));
    expect(within(screen.getByRole("list", { name: "รีวิวจากสมาชิก" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("รีวิว 7")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "4 ดาว" })).toBeDisabled();
  });
  it("does not call a capped history the full history", async () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `BK-${index}`, status: "completed", bookingType: "single", sessionCount: 1,
      startsAt: "2026-09-01T05:00:00.000Z", endsAt: "2026-09-01T06:00:00.000Z", quotedPrice: 700,
    }));
    vi.mocked(authenticatedRequest).mockResolvedValueOnce([{
      id: 1, displayName: "สมชาย", imageUrl: null, goals: null, experienceLevel: null,
      totalBookings: 132, completedSessions: 35, activeBookings: 0, nextSessionAt: null, lastSessionAt: null, history,
    }]);
    render(<TrainerMembersPanel />);
    const history5 = await screen.findByRole("list", { name: "ประวัติการฝึกของ สมชาย" });
    expect(within(history5).getAllByRole("listitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "ดู 20 รายการล่าสุด" }));
    expect(within(screen.getByRole("list", { name: "ประวัติการฝึกของ สมชาย" })).getAllByRole("listitem")).toHaveLength(20);
    expect(screen.getByText("แสดง 20 รายการล่าสุดจากทั้งหมด 132 การจอง")).toBeInTheDocument();
  });
});
