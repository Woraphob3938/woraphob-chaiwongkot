import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
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
  };
}

describe("TrainerWorkbench", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(authenticatedRequest).mockReset();
    push.mockReset();
  });

  it("puts the schedule action before the weekly workspace", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({
        ...approvedWorkspace,
        slots: [{ id: 70, startsAt: "2026-08-12T02:00:00.000Z", endsAt: "2026-08-12T03:00:00.000Z", state: "available" }],
      })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);

    const actionTitle = await screen.findByRole("heading", { name: "พร้อมดูแลสมาชิกแล้ว" });
    const weekHeading = screen.getByRole("heading", { name: "ตารางรายสัปดาห์" });
    expect(screen.getByRole("link", { name: "ดูตารางงาน" })).toHaveAttribute("href", "/trainer#schedule");
    expect(screen.queryByText("สถานที่")).not.toBeInTheDocument();
    expect(actionTitle.compareDocumentPosition(weekHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

    const weeklySchedule = await screen.findByRole("region", { name: "ตารางรายสัปดาห์" });
    expect(within(weeklySchedule).getAllByRole("group")).toHaveLength(7);
    expect(within(weeklySchedule).getAllByText("พร้อมจอง")).not.toHaveLength(0);
    expect(within(weeklySchedule).getAllByText("ล็อกชั่วคราว")).not.toHaveLength(0);
    expect(within(weeklySchedule).getByText("สมาชิกทดสอบ")).toBeInTheDocument();
    expect(within(weeklySchedule).getByText("นัดยืนยันแล้ว")).toBeInTheDocument();
    expect(within(weeklySchedule).getByRole("button", { name: /ลบช่วงว่าง/ })).toBeInTheDocument();
    expect(within(weeklySchedule).getByRole("button", { name: "สัปดาห์ก่อนหน้า" })).toBeInTheDocument();
    expect(within(weeklySchedule).getByRole("button", { name: "สัปดาห์ถัดไป" })).toBeInTheDocument();

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

  it("shows only the next two appointments beside the urgent action until expanded", async () => {
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
      .mockResolvedValueOnce(bookings);

    const { container } = render(<TrainerWorkbench />);

    expect(await screen.findByRole("heading", { name: "บันทึกผลการฝึก" })).toBeInTheDocument();
    expect(Array.from(container.querySelectorAll(".trainer-booking-preview .trainer-appointment-row")).map((card) => card.id)).toEqual([
      "booking-BK-NEXT-1",
      "booking-BK-NEXT-2",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "ดูนัดหมายทั้งหมด" }));
    expect(container.querySelectorAll(".trainer-booking-preview .trainer-appointment-row")).toHaveLength(4);
    fireEvent.change(screen.getByLabelText("ค้นหานัดหมาย"), { target: { value: "BK-LATER" } });
    expect(container.querySelectorAll(".trainer-booking-preview .trainer-appointment-row")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "ดูรายละเอียด" }));
    expect(screen.getByRole("dialog", { name: "รายละเอียดนัดหมาย" })).toBeInTheDocument();
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

    const schedule = await screen.findByRole("region", { name: "ตารางรายสัปดาห์" });
    expect(within(schedule).getByText("ถูกจองแล้ว")).toBeInTheDocument();
    expect(within(schedule).getAllByText("ปิดช่วงเวลา")).not.toHaveLength(0);
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
    expect(screen.queryByRole("button", { name: /บันทึกว่าฝึกเสร็จ BK-BAD-TIME/ })).not.toBeInTheDocument();
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
    const availabilitySummary = (await screen.findByText("จัดการช่วงเวลาว่าง")).closest("summary");
    if (!availabilitySummary) throw new Error("availability disclosure is missing");
    fireEvent.click(availabilitySummary);
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

    const weeklySchedule = await screen.findByRole("region", { name: "ตารางรายสัปดาห์" });
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

    expect(await screen.findAllByText("ล็อกชั่วคราว")).not.toHaveLength(0);
    expect(screen.queryByRole("button", { name: /ตอบรับคำขอ|ปฏิเสธคำขอ/ })).not.toBeInTheDocument();
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
    const deleteButton = await screen.findByRole("button", { name: /ลบช่วงเวลา/ });
    fireEvent.click(deleteButton);

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
      .mockResolvedValueOnce(approvedWorkspace);

    render(<TrainerWorkbench />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("โหลดสถานะเทรนเนอร์ไม่ได้");
    expect(screen.queryByTestId("next-action")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /สมัครเป็นเทรนเนอร์|เพิ่มช่วงเวลาว่าง|ตรวจคำขอ/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับคำขอ|ปฏิเสธคำขอ|ฝึกเสร็จแล้ว/ })).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));

    expect(await screen.findByRole("heading", { name: "เพิ่มช่วงเวลาว่าง" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับคำขอ|ปฏิเสธคำขอ/ })).not.toBeInTheDocument();
  });

  it("withholds combined advice and booking controls when bookings loading fails", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approvedWorkspace)
      .mockRejectedValueOnce(new Error("โหลดคำขอจองไม่ได้"))
      .mockResolvedValueOnce([bookingFixture()]);

    render(<TrainerWorkbench />);

    expect(await screen.findByRole("region", { name: "สถานะโปรไฟล์" })).toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("โหลดคำขอจองไม่ได้");
    expect(screen.queryByTestId("next-action")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับคำขอ|ปฏิเสธคำขอ|ฝึกเสร็จแล้ว/ })).not.toBeInTheDocument();
    expect(screen.queryByText("ยังไม่มีนัดที่ยืนยันแล้ว")).not.toBeInTheDocument();

    fireEvent.click(within(alert).getByRole("button", { name: "ลองใหม่" }));

    expect(await screen.findByRole("heading", { name: "เพิ่มช่วงเวลาว่าง" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ตอบรับคำขอ|ปฏิเสธคำขอ/ })).not.toBeInTheDocument();
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
      .mockResolvedValueOnce({ id: "BK-DONE", status: "completed" })
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกว่าฝึกเสร็จ BK-DONE" }));
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
    expect(screen.queryByRole("button", { name: "บันทึกว่าฝึกเสร็จ BK-WAIT" })).not.toBeInTheDocument();
    expect(screen.getByText("บันทึกผลได้หลัง จันทร์ 10 ส.ค. · 10:00 น.")).toBeInTheDocument();
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
      .mockResolvedValueOnce({ id: "BK-REFRESH", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"));

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกว่าฝึกเสร็จ BK-REFRESH" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลการฝึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "บันทึกว่าฝึกเสร็จ?" })).not.toBeInTheDocument());

    const confirmedSection = screen.getByRole("region", { name: "นัดถัดไปของสมาชิก" });
    const refreshError = await within(confirmedSection).findByRole("alert");
    expect(refreshError).toHaveTextContent("บันทึกผลแล้ว แต่โหลดรายการล่าสุดไม่สำเร็จ");
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(screen.queryByText("บันทึกผลการฝึกสำหรับคำขอ BK-REFRESH แล้ว")).not.toBeInTheDocument();
    expect(within(confirmedSection).queryByRole("button", { name: "บันทึกว่าฝึกเสร็จ BK-REFRESH" })).not.toBeInTheDocument();
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
      .mockResolvedValueOnce({ id: "BK-RETRY-OK", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"))
      .mockImplementationOnce(() => pendingRetry);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกว่าฝึกเสร็จ BK-RETRY-OK" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลการฝึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "บันทึกว่าฝึกเสร็จ?" })).not.toBeInTheDocument());

    const confirmedSection = screen.getByRole("region", { name: "นัดถัดไปของสมาชิก" });
    const refreshError = await within(confirmedSection).findByRole("alert");
    const retryButton = within(refreshError).getByRole("button", { name: "ลองโหลดใหม่" });
    retryButton.focus();
    fireEvent.click(retryButton);

    expect(refreshError).toBeInTheDocument();
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(within(refreshError).getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();

    await act(async () => { resolveRetry([]); });

    const successNotice = await screen.findByRole("status");
    expect(successNotice).toHaveTextContent("โหลดรายการนัดหมายล่าสุดแล้ว");
    await waitFor(() => expect(successNotice).toHaveFocus());
    expect(within(confirmedSection).queryByRole("alert")).not.toBeInTheDocument();
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
      .mockResolvedValueOnce({ id: "BK-RETRY-FAIL", status: "completed" })
      .mockRejectedValueOnce(new Error("โหลดรายการนัดล่าสุดไม่ได้"))
      .mockImplementationOnce(() => pendingRetry);

    render(<TrainerWorkbench />);
    fireEvent.click(await screen.findByRole("button", { name: "ดูรายละเอียด" }));
    fireEvent.click(await screen.findByRole("button", { name: "บันทึกว่าฝึกเสร็จ BK-RETRY-FAIL" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกผลการฝึก" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "บันทึกว่าฝึกเสร็จ?" })).not.toBeInTheDocument());

    const confirmedSection = screen.getByRole("region", { name: "นัดถัดไปของสมาชิก" });
    const refreshError = await within(confirmedSection).findByRole("alert");
    fireEvent.click(within(refreshError).getByRole("button", { name: "ลองโหลดใหม่" }));

    expect(refreshError).toBeInTheDocument();
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(within(refreshError).getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();

    await act(async () => { rejectRetry(new Error("เครือข่ายขัดข้อง")); });

    expect(await within(confirmedSection).findByRole("alert")).toHaveTextContent("ยังโหลดรายการนัดหมายล่าสุดไม่สำเร็จ กรุณาลองใหม่");
    await waitFor(() => expect(refreshError).toHaveFocus());
    expect(within(refreshError).getByRole("button", { name: "ลองโหลดใหม่" })).toBeEnabled();
  });
});
