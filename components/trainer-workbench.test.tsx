import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerWorkbench } from "@/components/trainer-workbench";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

vi.mock("@/lib/api", () => ({
  authenticatedRequest: vi.fn(),
  ApiError: class ApiError extends Error { constructor(message: string, public status = 500) { super(message); } },
}));

const rejectedWorkspace = {
  profile: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค.", approvalStatus: "rejected" as const, approvalNote: "กรุณาส่งเอกสารใหม่" },
  certificates: [],
  slots: [],
};

const approvedWorkspace = {
  ...rejectedWorkspace,
  profile: { ...rejectedWorkspace.profile, approvalStatus: "approved" as const, approvalNote: null },
};

const pendingWorkspace = {
  ...rejectedWorkspace,
  profile: { ...rejectedWorkspace.profile, approvalStatus: "pending" as const, approvalNote: null },
};

type FixtureOverrides = Partial<Omit<Booking, "status" | "actions">> & {
  status?: Booking["status"] | "pending_trainer";
  actions?: Booking["actions"] & { canAccept?: boolean; canReject?: boolean; canCancelBooking?: boolean };
  confirmedStartsAt?: string | null;
  confirmedEndsAt?: string | null;
  requestedStartsAt?: string | null;
  cancellationReason?: string | null;
};

function bookingFixture(overrides: FixtureOverrides = {}): Booking {
  return {
    id: "BK-TEST",
    trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
    member: { displayName: "สมาชิกทดสอบ" },
    startsAt: "2026-08-10T02:00:00.000Z",
    endsAt: "2026-08-10T03:00:00.000Z",
    note: "มีอาการเจ็บเข่า",
    status: "awaiting_payment",
    paymentStatus: "not_submitted",
    paymentDeadlineAt: "2099-08-10T02:10:00.000Z",
    quotedPrice: 1_200,
    chatRoomId: null,
    payment: null,
    review: null,
    actions: {
      canPay: false,
      canReadChat: false,
      canSendChat: false,
      canComplete: false,
      canReview: false,
      canCancel: false,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    demo: false,
    ...overrides,
  } as Booking;
}

/** The weekly calendar is always open; slots are managed by clicking them. */
const scheduleDisclosure = () => {
  const calendar = document.getElementById("schedule");
  if (!calendar) throw new Error("weekly calendar is missing");
  return calendar;
};

describe("TrainerWorkbench", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(authenticatedRequest).mockReset();
    push.mockReset();
    // The workspace renders the Monday–Sunday week containing "now" while the
    // fixtures place slots on "tomorrow" (and on 2026-08-10/12). Pin the clock to
    // a Wednesday inside that week, or the two disagree: run on a Sunday and
    // "tomorrow" is already next week, so nothing renders.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-12T02:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing when all is set, and keeps the calendar before the appointments", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({
        ...approvedWorkspace,
        slots: [{ id: 70, startsAt: "2026-08-12T02:00:00.000Z", endsAt: "2026-08-12T03:00:00.000Z", state: "available" }],
      })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);

    const appointments = await screen.findByRole("region", { name: "นัดของสมาชิก" });
    const calendar = scheduleDisclosure();
    // The "all set" card only repeated the calendar and pushed the work down.
    expect(screen.queryByRole("heading", { name: "พร้อมดูแลสมาชิกแล้ว" })).not.toBeInTheDocument();
    expect(screen.queryByText("สถานที่")).not.toBeInTheDocument();
    expect(calendar.compareDocumentPosition(appointments) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts a next action that asks for something before the calendar", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([bookingFixture({ id: "BK-ASK", status: "pending_trainer" })]);

    render(<TrainerWorkbench />);

    const actionTitle = await screen.findByRole("heading", { name: "ตอบรับคำขอจอง" });
    expect(actionTitle.compareDocumentPosition(scheduleDisclosure()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("counts an accepted request as waiting on the member, not on the trainer", async () => {
    const accepted = bookingFixture({
      id: "BK-HELD",
      status: "pending_trainer",
      confirmationReleaseAt: "2026-08-12T11:00:00.000Z",
      actions: { ...bookingFixture().actions, canAccept: false, canReject: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([accepted]);

    render(<TrainerWorkbench />);

    const requests = await screen.findByRole("region", { name: "คำขอจอง" });
    expect(within(requests).getByText("รอสมาชิก 1")).toBeInTheDocument();
    expect(within(requests).queryByText(/รอคุณ/)).not.toBeInTheDocument();
    expect(document.getElementById("request-BK-HELD")).toHaveClass("is-waiting");
    // Nothing to answer, so the KPI and the tab stay calm.
    expect(screen.getByRole("link", { name: /คำขอรอตอบรับ/ })).toHaveTextContent("0");
    expect(screen.getByRole("tab", { name: "งานและตาราง" })).toBeInTheDocument();
    // An accepted request is withdrawn, not rejected.
    expect(screen.queryByRole("button", { name: "ปฏิเสธ BK-HELD" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการตอบรับ BK-HELD" }));
    expect(screen.getByRole("dialog", { name: "ยกเลิกการตอบรับ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ยืนยันยกเลิกการตอบรับ" })).toBeInTheDocument();
  });

  it("shows availability and confirmed appointments in a seven-day weekly workspace", async () => {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + 1);
    startsAt.setHours(9, 0, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(10, 0, 0, 0);
    const bookingStartsAt = new Date(startsAt);
    bookingStartsAt.setHours(11, 0, 0, 0);
    const bookingEndsAt = new Date(startsAt);
    bookingEndsAt.setHours(12, 0, 0, 0);
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({
        ...approvedWorkspace,
        slots: [
          { id: 80, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), state: "available" },
          { id: 81, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), state: "held" },
        ],
      })
      .mockResolvedValueOnce([
        bookingFixture({
          id: "BK-WEEK",
          startsAt: bookingStartsAt.toISOString(),
          endsAt: bookingEndsAt.toISOString(),
          status: "confirmed",
          paymentStatus: "approved",
        }),
      ]);

    render(<TrainerWorkbench />);

    // Week navigation belongs to the calendar, not the unfiltered appointment list.
    expect(await screen.findByRole("heading", { name: "นัดของสมาชิก" })).toBeInTheDocument();
    expect(screen.getByText(/นัด · \d+ ช่วงเวลา$/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 วันก่อนหน้า" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "7 วันถัดไป" })).toBeInTheDocument();

    const weeklySchedule = scheduleDisclosure();
    expect(within(weeklySchedule).getByRole("button", { name: "7 วันก่อนหน้า" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "นัดของสมาชิก" })).queryByRole("button", { name: "7 วันก่อนหน้า" })).not.toBeInTheDocument();
    const days = within(weeklySchedule).getAllByRole("group");
    expect(days).toHaveLength(7);
    // Seven days from today: tomorrow's session is always in view.
    expect(days[0]).toHaveClass("is-today");
    expect(within(weeklySchedule).getAllByText("พร้อมจอง")).not.toHaveLength(0);
    expect(within(weeklySchedule).getAllByText("มีคำขอจอง")).not.toHaveLength(0);
    expect(within(weeklySchedule).getByText("สมาชิกทดสอบ")).toBeInTheDocument();
    expect(within(weeklySchedule).getAllByText("นัดยืนยันแล้ว").length).toBeGreaterThan(0);
    // The open slot is edited from the calendar; the held one stays read-only.
    expect(within(weeklySchedule).getAllByRole("button", { name: /^แก้ไขช่วงเวลา/ })).toHaveLength(1);
    expect(within(weeklySchedule).queryByRole("button", { name: /ลบช่วงว่าง/ })).not.toBeInTheDocument();
    expect(within(weeklySchedule).queryByRole("button", { name: "บันทึกผลการฝึก" })).not.toBeInTheDocument();
  });

  it("opens the availability popup directly from the workspace toolbar", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([]);
    render(<TrainerWorkbench />);

    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มช่วงเวลาว่าง" }));
    expect(screen.getByRole("dialog", { name: "เพิ่มช่วงเวลาว่าง" })).toBeInTheDocument();
  });

  it("shows two decision requests first and expands the rest on demand", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce(["A", "B", "C"].map((id) => bookingFixture({ id: `BK-${id}` })));

    render(<TrainerWorkbench />);
    expect(await screen.findByRole("heading", { name: "คำขอจอง" })).toBeInTheDocument();
    expect(document.querySelectorAll("[id^='request-BK-']")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "ดูอีก 1 รายการ" }));
    expect(document.querySelectorAll("[id^='request-BK-']")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "ย่อรายการ" }));
    expect(document.querySelectorAll("[id^='request-BK-']")).toHaveLength(2);
  });

  it("uses a distinct success color for confirmed appointments", () => {
    const styles = readFileSync("app/globals.css", "utf8");

    expect(styles).toMatch(/\.trainer-week-event--confirmed\s*\{[\s\S]*?background:\s*var\(--color-success-soft\);[\s\S]*?border-color:\s*var\(--color-success\);/);
    expect(styles).toMatch(/\.trainer-week__legend \.is-confirmed\s*\{[\s\S]*?background:\s*var\(--color-success-soft\);/);
  });

  it("keeps appointment details inside the dialog without horizontal overflow", () => {
    const styles = readFileSync("app/globals.css", "utf8");

    expect(styles).toMatch(/\.trainer-appointment-dialog\s*\{[\s\S]*?max-width:\s*42rem;[\s\S]*?overflow-x:\s*hidden;/);
    expect(styles).toMatch(/\.trainer-appointment-dialog \.trainer-booking-card\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\);/);
    expect(styles).toMatch(/\.trainer-appointment-dialog \.trainer-booking-card \.queue-actions\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1;[\s\S]*?grid-row:\s*auto;/);
  });

  it("keeps the actionable appointment first in the one list", async () => {
    const future = (day: number, hour: number) => {
      const date = new Date();
      date.setDate(date.getDate() + day);
      date.setHours(hour, 0, 0, 0);
      return date.toISOString();
    };
    const bookings = [
      bookingFixture({ id: "BK-URGENT", status: "confirmed", actions: { ...bookingFixture().actions, canComplete: true } }),
      bookingFixture({ id: "BK-NEXT-1", status: "confirmed", startsAt: future(1, 9), endsAt: future(1, 10) }),
      bookingFixture({ id: "BK-NEXT-2", status: "confirmed", startsAt: future(2, 9), endsAt: future(2, 10) }),
      bookingFixture({ id: "BK-LATER", status: "confirmed", startsAt: future(3, 9), endsAt: future(3, 10) }),
    ];
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce(bookings)
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    const { container } = render(<TrainerWorkbench />);

    expect(await screen.findByRole("heading", { name: "นัดของสมาชิก" })).toBeInTheDocument();
    // One list now owns every appointment: the record owing a result first,
    // then the upcoming ones in date order.
    expect(Array.from(container.querySelectorAll("#appointments .trainer-appointment-row")).map((row) => row.id)).toEqual([
      "booking-BK-URGENT",
      "booking-BK-NEXT-1",
      "booking-BK-NEXT-2",
      "booking-BK-LATER",
    ]);
    expect(screen.getByText("4 รายการ")).toBeInTheDocument();
    // The calendar answers "when", so the list no longer carries its own filters.
    expect(screen.queryByLabelText("ค้นหานัดหมาย")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "ดูรายละเอียด" })[0]);
    expect(screen.getByRole("dialog", { name: "รายละเอียดนัดหมาย" })).toBeInTheDocument();
  });

  it("leads with the slip queue when a slip waits for the trainer's own review", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ trainers: [], payments: [{ id: 9, bookingId: "BK-SLIP" }] });

    render(<TrainerWorkbench />);

    expect(await screen.findByRole("heading", { name: "ตรวจสลิปที่รออยู่" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "เปิดคิวตรวจสลิป" })).toHaveAttribute("href", "/trainer#payment-review");
    const deskSummary = screen.getByText("ตรวจสลิปการจองของฉัน").closest("summary");
    if (!deskSummary) throw new Error("slip disclosure is missing");
    expect(within(deskSummary).getByText("1 สลิป")).toBeInTheDocument();
  });

  it("shows one page of appointments and appends the next page on request", async () => {
    const finishedSession = (daysAgo: number) => {
      const start = new Date();
      start.setDate(start.getDate() - daysAgo);
      start.setHours(9, 0, 0, 0);
      return { startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3_600_000).toISOString() };
    };
    const pending = [1, 2, 3, 4, 5, 6, 7, 8].map((day) => bookingFixture({ id: `BK-P${day}`, status: "confirmed", ...finishedSession(day) }));
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({ ...approvedWorkspace, slots: [] })
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<TrainerWorkbench />);

    const section = await screen.findByRole("region", { name: "นัดของสมาชิก" });
    expect(within(section).getByText("8 รายการ")).toBeInTheDocument();
    expect(section.querySelectorAll(".trainer-appointment-row")).toHaveLength(4);

    // The escape hatch appends the next page instead of spending 1349px inline.
    fireEvent.click(within(section).getByRole("button", { name: /แสดงอีก 4 รายการ/ }));
    expect(section.querySelectorAll(".trainer-appointment-row")).toHaveLength(8);
    expect(within(section).getByRole("button", { name: "ย่อนัดหมาย" })).toBeInTheDocument();
  });

  it("moves focus to the record the next-action card names", async () => {
    const booking = bookingFixture({
      id: "BK-TARGET",
      status: "confirmed",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    window.location.hash = "#booking-BK-TARGET";
    render(<TrainerWorkbench />);

    const row = (await screen.findByText("BK-TARGET")).closest("article");
    if (!row) throw new Error("appointment row is missing");
    await waitFor(() => expect(within(row).getByRole("button", { name: "บันทึกผลการฝึก BK-TARGET" })).toHaveFocus());
    window.location.hash = "";
  });

  it("hands focus to the record's own button when the card is followed", async () => {
    const booking = bookingFixture({
      id: "BK-FOLLOW",
      status: "confirmed",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("link", { name: "บันทึกผลการฝึก" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "บันทึกผลการฝึก BK-FOLLOW" })).toHaveFocus());
  });

  it("keeps the money on its own tab", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<TrainerWorkbench />);

    const workTab = await screen.findByRole("tab", { name: /งานและตาราง/ });
    const financeTab = screen.getByRole("tab", { name: /การเงิน/ });
    expect(workTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("trainer-finance-panel")).toHaveAttribute("hidden");
    expect(document.getElementById("trainer-work-panel")).not.toHaveAttribute("hidden");

    fireEvent.click(financeTab);
    expect(financeTab).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("trainer-finance-panel")).not.toHaveAttribute("hidden");
    expect(document.getElementById("trainer-work-panel")).toHaveAttribute("hidden");

    // Arrow keys move between the tabs, as on the profile page; Home returns to work.
    fireEvent.keyDown(financeTab, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "รีวิว" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "รีวิว" }), { key: "Home" });
    expect(workTab).toHaveAttribute("aria-selected", "true");
  });

  it("offers the completion action on the appointment row itself", async () => {
    const booking = bookingFixture({
      id: "BK-ROW",
      status: "confirmed",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<TrainerWorkbench />);

    const row = (await screen.findByText("BK-ROW")).closest("article");
    if (!row) throw new Error("appointment row is missing");
    fireEvent.click(within(row).getByRole("button", { name: "บันทึกผลการฝึก BK-ROW" }));
    expect(screen.getByRole("dialog", { name: "บันทึกผลการฝึก?" })).toBeInTheDocument();
  });

  it("labels booked and blocked schedule slots by their real state", async () => {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + 1);
    startsAt.setHours(9, 0, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(10, 0, 0, 0);
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({
        ...approvedWorkspace,
        slots: [
          { id: 82, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), state: "booked" },
          { id: 83, startsAt: new Date(startsAt.getTime() + 3_600_000).toISOString(), endsAt: new Date(endsAt.getTime() + 3_600_000).toISOString(), state: "blocked" },
        ],
      })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);

    // The seven-column grid is a read-only map inside its own disclosure; its
    // accessible name comes from the summary, which dom-accessibility-api does
    // not surface as the group's name, so locate it through the disclosure class.
    await screen.findByRole("heading", { name: "นัดของสมาชิก" });
    const weeklySchedule = scheduleDisclosure();
    // A booked slot with no matching appointment row in the list still draws its
    // own state; the legend no longer needs a swatch for it.
    expect(within(weeklySchedule).getByText("ถูกจองแล้ว")).toBeInTheDocument();
    expect(within(weeklySchedule).getAllByText("ปิดช่วงเวลา")).not.toHaveLength(0);
  });

  it("blocks completion when an appointment ends before it starts", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([bookingFixture({
        id: "BK-BAD-TIME",
        status: "confirmed",
        startsAt: "2026-09-12T04:00:00.000Z",
        endsAt: "2026-09-12T03:00:00.000Z",
        actions: { ...bookingFixture().actions, canComplete: true, canReadChat: true },
      })]);

    render(<TrainerWorkbench />);

    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    expect(screen.getAllByText("ข้อมูลเวลาไม่ถูกต้อง").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /บันทึกผลการฝึก BK-BAD-TIME/ })).not.toBeInTheDocument();
  });

  it("adds a one-hour availability slot from the calendar dialog", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path, init) => {
      if (path === "/v1/trainer/me") return Promise.resolve(approvedWorkspace);
      if (path === "/v1/bookings") return Promise.resolve([]);
      if (path === "/v1/availability-slots" && init?.method === "POST") {
        return Promise.resolve({ id: 90, startsAt: "", endsAt: "", state: "available" });
      }
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });

    render(<TrainerWorkbench />);
    await screen.findByRole("heading", { name: "นัดของสมาชิก" });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มช่วงเวลาว่าง" }));

    const dialog = screen.getByRole("dialog", { name: "เพิ่มช่วงเวลาว่าง" });
    const availableDays = within(dialog).getAllByRole("button", { name: /^เลือกวันที่/ })
      .filter((button) => !button.hasAttribute("disabled"));
    const availableDay = availableDays.length > 2 ? availableDays[1] : availableDays[0];
    if (!availableDay) throw new Error("calendar has no selectable date");
    fireEvent.click(availableDay);
    fireEvent.click(within(dialog).getByRole("button", { name: "เริ่ม 10:00 น." }));

    expect(within(dialog).queryByLabelText("เวลาสิ้นสุด")).not.toBeInTheDocument();
    expect(within(dialog).getByText("จะเพิ่ม 1 ช่วง · แต่ละช่วงสิ้นสุดใน 1 ชั่วโมง")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันเพิ่มช่วงเวลา" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/availability-slots",
      expect.objectContaining({ method: "POST" }),
    ));
    const createCall = vi.mocked(authenticatedRequest).mock.calls.find(([path, init]) => (
      path === "/v1/availability-slots" && init?.method === "POST"
    ));
    const payload = JSON.parse(String(createCall?.[1]?.body));
    expect(Object.keys(payload)).toEqual(["startsAt"]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "เพิ่มช่วงเวลาว่าง" })).not.toBeInTheDocument());
  });

  it("places every confirmed monthly session on the weekly schedule", async () => {
    const first = new Date();
    first.setDate(first.getDate() + 1);
    first.setHours(9, 0, 0, 0);
    const second = new Date(first);
    second.setHours(second.getHours() + 2);
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({ ...approvedWorkspace, slots: [] })
      .mockResolvedValueOnce([bookingFixture({
        id: "BK-PACK",
        bookingType: "monthly",
        sessionCount: 2,
        status: "confirmed",
        paymentStatus: "approved",
        startsAt: first.toISOString(),
        endsAt: new Date(second.getTime() + 60 * 60 * 1000).toISOString(),
        sessions: [
          { id: 91, startsAt: first.toISOString(), endsAt: new Date(first.getTime() + 60 * 60 * 1000).toISOString() },
          { id: 92, startsAt: second.toISOString(), endsAt: new Date(second.getTime() + 60 * 60 * 1000).toISOString() },
        ],
      })]);

    render(<TrainerWorkbench />);

    await screen.findByRole("heading", { name: "นัดของสมาชิก" });
    const weeklySchedule = scheduleDisclosure();
    expect(within(weeklySchedule).getAllByText("สมาชิกทดสอบ")).toHaveLength(2);
  });

  it("shows the application next action when the trainer has no profile", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({ profile: null, certificates: [], slots: [] })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);

    expect(await screen.findByRole("heading", { name: "กรอกข้อมูลวิชาชีพให้ครบ" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "กรอกข้อมูลวิชาชีพ" })[0]).toHaveAttribute("href", "/trainer/apply");
  });

  it("shows held availability as read-only without booking decisions or quote fields", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({
        ...approvedWorkspace,
        slots: [{ id: 71, startsAt: "2026-08-12T02:00:00.000Z", endsAt: "2026-08-12T03:00:00.000Z", state: "held" }],
      })
      .mockResolvedValueOnce([bookingFixture({ status: "awaiting_payment", quotedPrice: 1_200 })]);

    render(<TrainerWorkbench />);

    expect(await screen.findAllByText("มีคำขอจอง")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: /^แก้ไขช่วงเวลา/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับ|ปฏิเสธ/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/ค่าฝึกสำหรับคำขอ/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ลบช่วงเวลา/ })).not.toBeInTheDocument();
  });

  it("confirms an available slot before deleting it", async () => {
    const startsAt = new Date();
    startsAt.setDate(startsAt.getDate() + 1);
    startsAt.setHours(9, 0, 0, 0);
    const endsAt = new Date(startsAt);
    endsAt.setHours(10, 0, 0, 0);
    const availableSlot = {
      id: 72,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      state: "available" as const,
    };
    let workspaceLoads = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path, init) => {
      if (path === "/v1/trainer/me") {
        workspaceLoads += 1;
        return Promise.resolve({
          ...approvedWorkspace,
          slots: workspaceLoads === 1 ? [availableSlot] : [],
        });
      }
      if (path === "/v1/bookings") return Promise.resolve([]);
      if (path === "/v1/availability-slots/72" && init?.method === "DELETE") {
        return Promise.resolve({ id: 72, deleted: true });
      }
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });

    render(<TrainerWorkbench />);
    await screen.findByRole("heading", { name: "นัดของสมาชิก" });
    // Deleting starts from the slot on the calendar, through its edit dialog.
    fireEvent.click(await within(scheduleDisclosure()).findByRole("button", { name: /^แก้ไขช่วงเวลา/ }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "แก้ไขช่วงเวลาว่าง" })).getByRole("button", { name: "ลบช่วงเวลานี้" }));

    expect(screen.getByRole("dialog", { name: "ลบช่วงเวลานี้?" })).toBeInTheDocument();
    expect(screen.getByText("สมาชิกจะไม่เห็นช่วงเวลานี้อีก")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalledWith("/v1/availability-slots/72", { method: "DELETE" });

    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบช่วงเวลา" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/availability-slots/72", {
      method: "DELETE",
    }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /ลบช่วงเวลา/ })).not.toBeInTheDocument());
  });

  it("reports a successfully loaded incomplete profile to the route guard", async () => {
    const onIncompleteProfile = vi.fn();
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({ profile: null, certificates: [], slots: [] })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench onIncompleteProfile={onIncompleteProfile} />);

    await waitFor(() => expect(onIncompleteProfile).toHaveBeenCalledTimes(1));
  });

  it("does not report an incomplete profile when workspace loading fails", async () => {
    const onIncompleteProfile = vi.fn();
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new Error("โหลดสถานะเทรนเนอร์ไม่ได้"))
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench onIncompleteProfile={onIncompleteProfile} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดสถานะเทรนเนอร์ไม่ได้");
    expect(onIncompleteProfile).not.toHaveBeenCalled();
  });

  it("withholds advice and booking controls when workspace loading fails", async () => {
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new Error("โหลดสถานะเทรนเนอร์ไม่ได้"))
      .mockResolvedValueOnce([bookingFixture()])
      .mockResolvedValueOnce({ trainers: [], payments: [] })
      .mockResolvedValueOnce(approvedWorkspace);

    render(<TrainerWorkbench />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดสถานะเทรนเนอร์ไม่ได้");
    expect(screen.queryByTestId("next-action")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /สมัครเป็นเทรนเนอร์|เพิ่มช่วงเวลาว่าง|ตรวจคำขอ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับ|ปฏิเสธ|ฝึกเสร็จแล้ว/ })).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));

    expect(await screen.findByRole("heading", { name: "เพิ่มช่วงเวลาว่าง" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับ|ปฏิเสธ/ })).not.toBeInTheDocument();
  });

  it("withholds combined advice and booking controls when bookings loading fails", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockRejectedValueOnce(new Error("โหลดคำขอจองไม่ได้"))
      .mockResolvedValueOnce({ trainers: [], payments: [] })
      .mockResolvedValueOnce([bookingFixture()]);

    render(<TrainerWorkbench />);

    expect(await screen.findByRole("region", { name: "สถานะโปรไฟล์" })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("โหลดคำขอจองไม่ได้");
    expect(screen.queryByTestId("next-action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับ|ปฏิเสธ|ฝึกเสร็จแล้ว/ })).not.toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีนัดที่ยืนยันแล้ว")).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));

    expect(await screen.findByRole("heading", { name: "เพิ่มช่วงเวลาว่าง" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับ|ปฏิเสธ/ })).not.toBeInTheDocument();
  });

  it("keeps a pending application CTA on the visible approval status", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(pendingWorkspace)
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);

    expect(await screen.findByTestId("next-action")).toHaveAttribute("data-state", "waiting");
    expect(screen.getByRole("link", { name: "ดูสถานะการสมัคร" })).toHaveAttribute("href", "/trainer#approval-status");
    expect(document.getElementById("approval-status")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "เพิ่มช่วงเวลาว่าง" })).not.toBeInTheDocument();
  });

  it("shows the rejection reason and blocks slot creation", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path) => Promise.resolve(path === "/v1/trainer/me" ? rejectedWorkspace : []));
    render(<TrainerWorkbench />);
    expect(await screen.findByText("กรุณาส่งเอกสารใหม่")).toBeInTheDocument();
    expect(screen.getByTestId("next-action")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "แก้ไขใบสมัคร" })).toHaveAttribute("href", "/trainer/apply");
    expect(screen.queryByRole("link", { name: "เพิ่มช่วงเวลาว่าง" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มช่วงเวลาว่าง" })).toBeDisabled();
  });

  it("lets the trainer complete an eligible confirmed booking and refreshes bookings", async () => {
    const booking = bookingFixture({
      id: "BK-DONE",
      status: "confirmed",
      quotedPrice: 1_200,
      paymentStatus: "approved",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] })
      .mockResolvedValueOnce({ id: "BK-DONE", status: "completed" })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกผลการฝึก BK-DONE" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลการฝึก" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-DONE/status",
      { method: "PATCH", body: JSON.stringify({ status: "completed" }) },
    ));
    expect(authenticatedRequest).toHaveBeenLastCalledWith("/v1/bookings");
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกผลการฝึกสำหรับคำขอ BK-DONE แล้ว");
  });

  it("keeps completion disabled until the server allows it and shows the appointment end", async () => {
    const booking = bookingFixture({ id: "BK-WAIT", status: "confirmed" });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking]);

    render(<TrainerWorkbench />);

    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    expect(await screen.findByRole("button", { name: "รอสิ้นสุดการฝึก BK-WAIT" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "บันทึกผลการฝึก BK-WAIT" })).not.toBeInTheDocument();
    expect(screen.getByText("บันทึกผลได้หลัง จันทร์ 10 ส.ค. 2569 · 10:00 น.")).toBeInTheDocument();
  });

  it("prevents duplicate completion and reports a failed refresh beside confirmed bookings", async () => {
    const booking = bookingFixture({
      id: "BK-REFRESH",
      status: "confirmed",
      quotedPrice: 1_200,
      paymentStatus: "approved",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] })
      .mockResolvedValueOnce({ id: "BK-REFRESH", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"));

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกผลการฝึก BK-REFRESH" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลการฝึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "บันทึกผลการฝึก?" })).not.toBeInTheDocument());

    // The result of recording a session stays on screen even when the follow-up
    // refresh fails and the appointment list has dropped out.
    const refreshError = await screen.findByText(/บันทึกผลแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ/);
    const refreshAlert = refreshError.closest(".workbench-error") as HTMLElement | null;
    if (!refreshAlert) throw new Error("completion error panel is missing");
    await waitFor(() => expect(refreshAlert).toHaveFocus());
    expect(screen.queryByText("บันทึกผลการฝึกสำหรับคำขอ BK-REFRESH แล้ว")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกผลการฝึก BK-REFRESH" })).not.toBeInTheDocument();
    expect(vi.mocked(authenticatedRequest).mock.calls.filter(([path, options]) => (
      path === "/v1/bookings/BK-REFRESH/status" && options?.method === "PATCH"
    ))).toHaveLength(1);
  });

  it("keeps retry feedback focused while loading and announces a successful refresh", async () => {
    const booking = bookingFixture({
      id: "BK-RETRY-OK",
      status: "confirmed",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    let resolveRetry!: (bookings: Booking[]) => void;
    const pendingRetry = new Promise<Booking[]>((resolve) => { resolveRetry = resolve; });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] })
      .mockResolvedValueOnce({ id: "BK-RETRY-OK", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"))
      .mockImplementationOnce(() => pendingRetry);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกผลการฝึก BK-RETRY-OK" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลการฝึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "บันทึกผลการฝึก?" })).not.toBeInTheDocument());

    const refreshError = await screen.findByText(/บันทึกผลแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ/);
    const refreshAlert = refreshError.closest(".workbench-error") as HTMLElement | null;
    if (!refreshAlert) throw new Error("completion error panel is missing");
    const retryButton = within(refreshAlert).getByRole("button", { name: "ลองโหลดใหม่" });
    retryButton.focus();
    fireEvent.click(retryButton);

    expect(refreshAlert).toBeInTheDocument();
    await waitFor(() => expect(refreshAlert).toHaveFocus());
    expect(within(refreshAlert).getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();

    await act(async () => { resolveRetry([]); });

    const successNotice = await screen.findByRole("status");
    expect(successNotice).toHaveTextContent("โหลดรายการนัดหมายล่าสุดแล้ว");
    await waitFor(() => expect(successNotice).toHaveFocus());
    expect(screen.queryByText(/บันทึกผลแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ/)).not.toBeInTheDocument();
  });

  it("keeps the retry alert focused and usable when refresh fails again", async () => {
    const booking = bookingFixture({
      id: "BK-RETRY-FAIL",
      status: "confirmed",
      actions: { ...bookingFixture().actions, canComplete: true },
    });
    let rejectRetry!: (reason: Error) => void;
    const pendingRetry = new Promise<Booking[]>((_, reject) => { rejectRetry = reject; });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] })
      .mockResolvedValueOnce({ id: "BK-RETRY-FAIL", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"))
      .mockImplementationOnce(() => pendingRetry);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกผลการฝึก BK-RETRY-FAIL" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลการฝึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "บันทึกผลการฝึก?" })).not.toBeInTheDocument());

    const refreshError = await screen.findByText(/บันทึกผลแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ/);
    const refreshAlert = refreshError.closest(".workbench-error") as HTMLElement | null;
    if (!refreshAlert) throw new Error("completion error panel is missing");
    fireEvent.click(within(refreshAlert).getByRole("button", { name: "ลองโหลดใหม่" }));

    expect(refreshAlert).toBeInTheDocument();
    await waitFor(() => expect(refreshAlert).toHaveFocus());
    expect(within(refreshAlert).getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();

    await act(async () => { rejectRetry(new Error("เครือข่ายขัดข้อง")); });

    expect(await screen.findByText("ยังโหลดรายการนัดหมายล่าสุดไม่สำเร็จ กรุณาลองใหม่")).toBeInTheDocument();
    await waitFor(() => expect(refreshAlert).toHaveFocus());
    expect(within(refreshAlert).getByRole("button", { name: "ลองโหลดใหม่" })).toBeEnabled();
  });

  it("offers a pending request with accept and reject and previews every confirmed time", async () => {
    const pending = bookingFixture({
      id: "BK-ACCEPT",
      status: "pending_trainer",
      startsAt: "2026-08-13T02:00:00.000Z",
      endsAt: "2026-08-13T03:00:00.000Z",
      requestedStartsAt: "2026-08-13T02:00:00.000Z",
      actions: { ...bookingFixture().actions, canAccept: true, canReject: true },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<TrainerWorkbench />);

    const row = (await screen.findByText("BK-ACCEPT")).closest("article");
    if (!row) throw new Error("request card is missing");
    expect(within(row).getByText("ช่วงเวลาที่ต้องการ")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "ตอบรับ BK-ACCEPT" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "ปฏิเสธ BK-ACCEPT" })).toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button", { name: "ตอบรับ BK-ACCEPT" }));
    const dialog = screen.getByRole("dialog", { name: "ตอบรับคำขอจอง" });
    // The training time never moves; the rounds only decide when the member hears back.
    expect(within(dialog).getByText("เวลาฝึก (ไม่เปลี่ยน)")).toBeInTheDocument();
    expect(within(dialog).getByText(/09:00 น\. – 10:00 น\./)).toBeInTheDocument();
    expect(within(dialog).getByText("รอบ 12:00 น.")).toBeInTheDocument();
    expect(within(dialog).getByText("รอบ 18:00 น.")).toBeInTheDocument();
  });

  it("accepts a pending request and releases it to the member at the round the trainer picks", async () => {
    const pending = bookingFixture({
      id: "BK-ACCEPT",
      status: "pending_trainer",
      startsAt: "2026-08-13T02:00:00.000Z",
      endsAt: "2026-08-13T03:00:00.000Z",
      requestedStartsAt: "2026-08-13T02:00:00.000Z",
      actions: { ...bookingFixture().actions, canAccept: true, canReject: true },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/trainer/me") return Promise.resolve(approvedWorkspace);
      if (path === "/v1/bookings") return Promise.resolve([pending]);
      if (path === "/v1/trainer/review-queue") return Promise.resolve({ trainers: [], payments: [] });
      return Promise.resolve({ id: "BK-ACCEPT", status: "awaiting_payment" });
    });

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ตอบรับ BK-ACCEPT" }));
    const dialog = screen.getByRole("dialog", { name: "ตอบรับคำขอจอง" });
    const options = within(dialog).getAllByRole("radio");
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining("12:00 น."),
      expect.stringContaining("18:00 น."),
    ]);
    // Now is 09:00 on 12 Aug: the 18:00 round reaches the member that evening.
    expect(options[1]).toHaveTextContent("แจ้งสมาชิก พุธ 12 ส.ค. 2569 · 18:00 น.");
    fireEvent.click(options[1]);
    expect(options[1]).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันตอบรับ" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-ACCEPT/status",
      { method: "PATCH", body: JSON.stringify({ status: "awaiting_payment", confirmedTime: "18:00" }) },
    ));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ตอบรับคำขอ BK-ACCEPT แล้ว ระบบจะแจ้งสมาชิก พุธ 12 ส.ค. 2569 · 18:00 น."));
  });

  it("rejects a pending request only with a reason and sends it as the note", async () => {
    const pending = bookingFixture({
      id: "BK-REJECT",
      status: "pending_trainer",
      startsAt: "2026-08-13T02:00:00.000Z",
      endsAt: "2026-08-13T03:00:00.000Z",
      actions: { ...bookingFixture().actions, canAccept: true, canReject: true },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/trainer/me") return Promise.resolve(approvedWorkspace);
      if (path === "/v1/bookings") return Promise.resolve([pending]);
      if (path === "/v1/trainer/review-queue") return Promise.resolve({ trainers: [], payments: [] });
      return Promise.resolve({ id: "BK-REJECT", status: "cancelled" });
    });

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ปฏิเสธ BK-REJECT" }));
    const dialog = screen.getByRole("dialog", { name: "ปฏิเสธคำขอจอง" });

    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันปฏิเสธ" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("กรุณาระบุเหตุผล");
    expect(vi.mocked(authenticatedRequest).mock.calls.some(([path]) => path.includes("/status"))).toBe(false);

    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ปฏิเสธ/), { target: { value: "ไม่สะดวกเวลาดังกล่าว" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันปฏิเสธ" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-REJECT/status",
      { method: "PATCH", body: JSON.stringify({ status: "cancelled", note: "ไม่สะดวกเวลาดังกล่าว" }) },
    ));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ปฏิเสธคำขอ BK-REJECT แล้ว"));
  });

  it("cancels a booking from its card with the required reason", async () => {
    const booking = bookingFixture({
      id: "BK-CANCEL",
      status: "confirmed",
      startsAt: "2026-08-13T02:00:00.000Z",
      endsAt: "2026-08-13T03:00:00.000Z",
      actions: { ...bookingFixture().actions, canCancelBooking: true },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/trainer/me") return Promise.resolve(approvedWorkspace);
      if (path === "/v1/bookings") return Promise.resolve([booking]);
      if (path === "/v1/trainer/review-queue") return Promise.resolve({ trainers: [], payments: [] });
      return Promise.resolve({ id: "BK-CANCEL", status: "cancelled" });
    });

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการจอง BK-CANCEL" }));
    const dialog = screen.getByRole("dialog", { name: "ยกเลิกการจอง" });

    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิกการจอง" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("กรุณาระบุเหตุผล");

    fireEvent.change(within(dialog).getByLabelText(/เหตุผลที่ยกเลิก/), { target: { value: "ติดภารกิจฉุกเฉิน" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันยกเลิกการจอง" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-CANCEL/status",
      { method: "PATCH", body: JSON.stringify({ status: "cancelled", note: "ติดภารกิจฉุกเฉิน" }) },
    ));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("ยกเลิกการจอง BK-CANCEL แล้ว"));
  });

  it("shows the confirmed period prominently on the trainer's booking card", async () => {
    const booking = bookingFixture({
      id: "BK-CONFIRMED-TIME",
      status: "confirmed",
      startsAt: "2026-08-13T02:00:00.000Z",
      endsAt: "2026-08-13T03:00:00.000Z",
      confirmedStartsAt: "2026-08-13T05:00:00.000Z",
      confirmedEndsAt: "2026-08-13T06:00:00.000Z",
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    const dialog = screen.getByRole("dialog", { name: "รายละเอียดนัดหมาย" });

    expect(within(dialog).getByText("ช่วงเวลาที่ยืนยัน")).toBeInTheDocument();
    expect(within(dialog).getByText(/12:00 น\. – 13:00 น\./)).toBeInTheDocument();
  });

  it("edits an available slot's start time and keeps a booked slot locked", async () => {
    const availableSlot = { id: 72, startsAt: "2026-08-13T02:00:00.000Z", endsAt: "2026-08-13T03:00:00.000Z", state: "available" as const };
    const bookedSlot = { id: 73, startsAt: "2026-08-13T05:00:00.000Z", endsAt: "2026-08-13T06:00:00.000Z", state: "booked" as const };
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/trainer/me") return Promise.resolve({ ...approvedWorkspace, slots: [availableSlot, bookedSlot] });
      if (path === "/v1/bookings") return Promise.resolve([]);
      if (path === "/v1/trainer/review-queue") return Promise.resolve({ trainers: [], payments: [] });
      return Promise.resolve({ id: 72, startsAt: "", endsAt: "", state: "available" });
    });

    render(<TrainerWorkbench />);
    await screen.findByRole("heading", { name: "นัดของสมาชิก" });

    // A booked slot may not move, so only the open future one is a button.
    expect(screen.queryByRole("button", { name: "แก้ไขช่วงเวลา พฤหัสบดี 13 ส.ค. 2569 · 12:00 น." })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไขช่วงเวลา พฤหัสบดี 13 ส.ค. 2569 · 09:00 น." }));

    const dialog = screen.getByRole("dialog", { name: "แก้ไขช่วงเวลาว่าง" });
    expect(within(dialog).getByText(/เวลาเดิม/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("วันที่"), { target: { value: "2026-08-14" } });
    fireEvent.change(within(dialog).getByLabelText("เวลาเริ่มต้นใหม่"), { target: { value: "11:00" } });
    expect(within(dialog).getByText(/เวลาใหม่/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันแก้ไขเวลา" }));

    const expectedStartsAt = new Date("2026-08-14T11:00:00").toISOString();
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/availability-slots/72",
      { method: "PATCH", body: JSON.stringify({ startsAt: expectedStartsAt }) },
    ));
    const editCall = vi.mocked(authenticatedRequest).mock.calls.find(([path, init]) => (
      path === "/v1/availability-slots/72" && init?.method === "PATCH"
    ));
    expect(Object.keys(JSON.parse(String(editCall?.[1]?.body)))).toEqual(["startsAt"]);
  });

  it("surfaces the API's Thai error when a slot edit is refused", async () => {
    const availableSlot = { id: 74, startsAt: "2026-08-13T02:00:00.000Z", endsAt: "2026-08-13T03:00:00.000Z", state: "available" as const };
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/trainer/me") return Promise.resolve({ ...approvedWorkspace, slots: [availableSlot] });
      if (path === "/v1/bookings") return Promise.resolve([]);
      if (path === "/v1/trainer/review-queue") return Promise.resolve({ trainers: [], payments: [] });
      return Promise.reject(new Error("ช่วงเวลานี้ถูกจองแล้ว แก้ไขไม่ได้"));
    });

    render(<TrainerWorkbench />);
    await screen.findByRole("heading", { name: "นัดของสมาชิก" });
    fireEvent.click(screen.getByRole("button", { name: "แก้ไขช่วงเวลา พฤหัสบดี 13 ส.ค. 2569 · 09:00 น." }));

    const dialog = screen.getByRole("dialog", { name: "แก้ไขช่วงเวลาว่าง" });
    fireEvent.change(within(dialog).getByLabelText("เวลาเริ่มต้นใหม่"), { target: { value: "11:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันแก้ไขเวลา" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("ช่วงเวลานี้ถูกจองแล้ว แก้ไขไม่ได้");
  });

  it("renders the statistics panel monthly and yearly with the gym salary summary", async () => {
    const statsPayload = {
      bookingsByMonth: [
        { month: 1, total: 3 },
        { month: 2, total: 1 },
      ],
      incomeByMonth: [
        { month: 1, amount: 3_600 },
        { month: 2, amount: 1_200 },
      ],
      totals: { bookings: 4, income: 4_800 },
      salarySummary: [{ month: 1, sessions: 4, amount: 4_800 }],
    };
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/trainer/me") return Promise.resolve(approvedWorkspace);
      if (path === "/v1/bookings") return Promise.resolve([]);
      if (path === "/v1/trainer/review-queue") return Promise.resolve({ trainers: [], payments: [] });
      if (path.startsWith("/v1/trainer/stats")) return Promise.resolve(statsPayload);
      return Promise.reject(new Error(`unexpected request: ${path}`));
    });

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("tab", { name: /การเงิน/ }));

    expect(await screen.findByRole("heading", { name: "สถิติ" })).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/trainer/stats?year=2026");

    const monthly = await screen.findByRole("table", { name: "จำนวนการจองและรายได้รายเดือน" });
    expect(within(monthly).getByRole("rowheader", { name: "ม.ค." })).toBeInTheDocument();
    expect(within(monthly).getByText("3 การจอง")).toBeInTheDocument();
    expect(within(monthly).getByText("฿3,600")).toBeInTheDocument();
    expect(within(monthly).getByRole("rowheader", { name: "ก.พ." })).toBeInTheDocument();
    expect(within(monthly).getByText("1 การจอง")).toBeInTheDocument();

    const salary = screen.getByRole("table", { name: "สรุปเงินเดือนรายเดือนของเทรนเนอร์ประจำยิม" });
    expect(within(salary).getByText("4 ครั้ง")).toBeInTheDocument();
    expect(within(salary).getByText("฿4,800")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "รายปี" }));
    const yearly = screen.getByRole("table", { name: "จำนวนการจองและรายได้รายปี" });
    expect(within(yearly).getByRole("rowheader", { name: "พ.ศ. 2569" })).toBeInTheDocument();
    expect(within(yearly).getByText("4 การจอง")).toBeInTheDocument();
    expect(within(yearly).getByText("฿4,800")).toBeInTheDocument();
  });
});
