import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatWorkbench } from "@/components/chat-workbench";
import { authenticatedRequest, openProtectedFile } from "@/lib/api";
import type { Booking, ChatMessage } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  authenticatedRequest: vi.fn(),
  openProtectedFile: vi.fn(),
}));

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "BK-CHAT-001",
    trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
    member: { displayName: "สมาชิกทดสอบ" },
    startsAt: "2026-08-10T02:00:00.000Z",
    endsAt: "2026-08-10T03:00:00.000Z",
    note: "เน้นฝึกท่าพื้นฐาน",
    status: "confirmed",
    paymentStatus: "approved",
    paymentDeadlineAt: null,
    quotedPrice: 1_200,
    chatRoomId: 11,
    payment: null,
    review: null,
    actions: {
      canPay: false,
      canReadChat: true,
      canSendChat: true,
      canComplete: false,
      canReview: false,
      canCancel: false,
    },
    createdAt: "2026-08-01T00:00:00.000Z",
    demo: false,
    ...overrides,
  };
}

function messageFixture(id: number, text = `ข้อความ ${id}`, overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    message: text,
    attachment: null,
    createdAt: `2026-08-01T00:0${Math.min(id, 9)}:00.000Z`,
    readAt: null,
    sender: { id: 9, displayName: "สมาชิกทดสอบ" },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
}

function stubDesktopFacts(matches: boolean) {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches,
    media: "(min-width: 58.001rem)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function max58RuleBody(selector: string): string | undefined {
  const styles = readFileSync("app/globals.css", "utf8");
  const mediaStart = styles.lastIndexOf("@media (max-width: 58rem)");
  const mediaEnd = styles.indexOf("@media", mediaStart + 1);
  const compactStyles = styles.slice(mediaStart, mediaEnd);
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return compactStyles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1];
}

function declarationValue(ruleBody: string, property: string): string {
  const styles = document.createElement("style");
  styles.textContent = `.probe { ${ruleBody} }`;
  document.head.append(styles);
  const rule = styles.sheet?.cssRules[0] as CSSStyleRule | undefined;
  const value = rule?.style.getPropertyValue(property) ?? "";
  styles.remove();
  return value;
}

describe("ChatWorkbench", () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(authenticatedRequest).mockReset();
    vi.mocked(openProtectedFile).mockReset();
    localStorage.setItem("fitconnect_user", JSON.stringify({
      id: 9,
      email: "member@example.test",
      displayName: "สมาชิกทดสอบ",
      role: "member",
      status: "active",
    }));
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
  });

  it("filters unreadable bookings, selects a valid requested room, and loads it from cursor zero", async () => {
    const first = bookingFixture();
    const selected = bookingFixture({
      id: "BK-CHAT-002",
      chatRoomId: 22,
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ด." },
    });
    const noRoom = bookingFixture({ id: "BK-NO-ROOM", chatRoomId: null });
    const forbidden = bookingFixture({
      id: "BK-FORBIDDEN",
      chatRoomId: 33,
      trainer: { id: 5, slug: "trainer-e", displayName: "เทรนเนอร์ จ." },
      actions: { ...bookingFixture().actions, canReadChat: false },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/bookings") return Promise.resolve([first, selected, noRoom, forbidden]);
      if (path === "/v1/chat-rooms/22/messages?afterId=0") return Promise.resolve([messageFixture(4, "ห้องที่เลือก")]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench initialBookingId="BK-CHAT-002" />);
    await flushPromises();

    expect(screen.getByRole("button", { name: /เทรนเนอร์ ด\./ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /เทรนเนอร์ ค\./ })).toBeInTheDocument();
    expect(screen.queryByText("เทรนเนอร์ จ.")).not.toBeInTheDocument();
    expect(screen.getByText("ห้องที่เลือก")).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/chat-rooms/22/messages?afterId=0");
  });

  it("keeps every compact room accessible in a capped scroll region and reveals the selected room", async () => {
    stubDesktopFacts(false);
    const rooms = Array.from({ length: 18 }, (_, index) => bookingFixture({
      id: `BK-ROOM-${String(index + 1).padStart(2, "0")}`,
      chatRoomId: index + 1,
      trainer: { id: index + 1, slug: `trainer-${index + 1}`, displayName: `เทรนเนอร์ ${index + 1}` },
    }));
    const selected = rooms.at(-1) as Booking;
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/bookings") return Promise.resolve(rooms);
      if (path === `/v1/chat-rooms/${selected.chatRoomId}/messages?afterId=0`) return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench initialBookingId={selected.id} />);
    await flushPromises();

    const roomList = screen.getByRole("complementary", { name: "ห้องตามคำขอจอง" });
    expect(roomList).toHaveClass("chat-room-list");
    expect(within(roomList).getAllByRole("button")).toHaveLength(18);
    expect(within(roomList).getByRole("button", { name: /เทรนเนอร์ 18/ })).toHaveAttribute("aria-pressed", "true");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });

    const compactRoomRule = max58RuleBody(".chat-room-list");
    expect(compactRoomRule).toBeDefined();
    expect(declarationValue(compactRoomRule ?? "", "max-block-size")).not.toBe("");
    expect(declarationValue(compactRoomRule ?? "", "overflow-y")).toBe("auto");

    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: originalScrollIntoView,
    });
  });

  it("gives tablet chat attachments a semantic full-width row without character-by-character filenames", async () => {
    stubDesktopFacts(false);
    const attachment = { name: "trainer-a.png", mime: "image/png", size: 2_048, url: "/protected/trainer-a" };
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([bookingFixture()])
      .mockResolvedValueOnce([messageFixture(3, "รูปสถานที่ฝึก", { attachment })]);

    render(<ChatWorkbench />);
    await flushPromises();
    expect(screen.queryByText("สถานที่")).not.toBeInTheDocument();

    const filename = screen.getByText("trainer-a.png");
    const attachmentRow = filename.closest("li");
    expect(attachmentRow).toHaveClass("chat-attachment-row");
    expect(within(attachmentRow as HTMLElement).getByRole("button", { name: "เปิดไฟล์ trainer-a.png" })).toBeEnabled();

    const compactAttachmentRule = max58RuleBody(".chat-attachment-row");
    expect(compactAttachmentRule).toBeDefined();
    expect(declarationValue(compactAttachmentRule ?? "", "grid-template-columns")).toContain("minmax(0, 1fr)");
    expect(declarationValue(compactAttachmentRule ?? "", "word-break")).not.toBe("break-all");
  });

  it.each([
    ["awaiting_payment", "รอชำระเงิน"],
    ["payment_review", "รอตรวจสลิป"],
    ["confirmed", "ยืนยันการชำระแล้ว"],
    ["completed", "ฝึกเสร็จแล้ว"],
  ] as const)("shows the exact %s workflow label in the active chat", async (status, label) => {
    const booking = bookingFixture({ status });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([]);

    render(<ChatWorkbench />);
    await flushPromises();

    expect(screen.getAllByText(label)).toHaveLength(2);
  });

  it("exposes booking facts as a closed disclosure outside desktop", async () => {
    stubDesktopFacts(false);
    const booking = bookingFixture();
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([]);

    const { container } = render(<ChatWorkbench />);
    await flushPromises();

    const summary = container.querySelector("summary") as HTMLElement;
    expect(summary).toHaveTextContent("รายละเอียดนัดหมาย");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");

    fireEvent.click(summary);
    await flushPromises();
    expect(disclosure).toHaveAttribute("open");
  });

  it("keeps desktop booking facts closed by default with a visible native disclosure control", async () => {
    stubDesktopFacts(true);
    const booking = bookingFixture();
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([]);

    const globalStyles = readFileSync("app/globals.css", "utf8");
    const summaryRule = globalStyles.match(/\.chat-booking-facts__summary\s*\{[^}]*\}/)?.[0];
    expect(summaryRule).toBeDefined();
    const styles = document.createElement("style");
    styles.textContent = summaryRule ?? "";
    document.head.append(styles);
    const appliedSummaryRule = styles.sheet?.cssRules[0] as CSSStyleRule | undefined;
    styles.remove();
    render(<ChatWorkbench />);
    await flushPromises();

    const summary = screen.getByText("รายละเอียดนัดหมาย", { selector: "summary" });
    const disclosure = summary.closest("details");
    expect(appliedSummaryRule?.style.display).not.toBe("none");
    expect(summary).toBeVisible();
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.tabIndex).toBeGreaterThanOrEqual(0);
    expect(disclosure).not.toHaveAttribute("open");

    summary.focus();
    expect(summary).toHaveFocus();
    fireEvent.click(summary);
    await flushPromises();
    expect(disclosure).toHaveAttribute("open");

    summary.focus();
    fireEvent.keyDown(summary, { key: "Enter", code: "Enter" });
    fireEvent.keyUp(summary, { key: "Enter", code: "Enter" });
    fireEvent.click(summary); // Native keyboard activation dispatches the same click action in browsers.
    await flushPromises();
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("collapses booking facts again when the member changes rooms", async () => {
    const second = bookingFixture({
      id: "BK-CHAT-002",
      chatRoomId: 22,
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ด." },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/bookings") return Promise.resolve([bookingFixture(), second]);
      if (path.includes("/messages?afterId=0")) return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench />);
    await flushPromises();
    const summary = screen.getByText("รายละเอียดนัดหมาย", { selector: "summary" });
    const disclosure = summary.closest("details");
    fireEvent.click(summary);
    await flushPromises();
    expect(disclosure).toHaveAttribute("open");

    fireEvent.click(screen.getByRole("button", { name: /เทรนเนอร์ ด\./ }));
    await flushPromises();
    const switchedDisclosure = screen.getByText("รายละเอียดนัดหมาย", { selector: "summary" }).closest("details");
    expect(switchedDisclosure).not.toHaveAttribute("open");
  });

  it("announces the active conversation before secondary facts and keeps the composer after the message log", async () => {
    stubDesktopFacts(false);
    const booking = bookingFixture();
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([messageFixture(1, "พร้อมเริ่มฝึกครับ")]);

    render(<ChatWorkbench />);
    await flushPromises();

    const heading = screen.getByRole("heading", { name: "สนทนากับ เทรนเนอร์ ค." });
    const facts = screen.getByText("รายละเอียดนัดหมาย", { selector: "summary" }).closest("details");
    const log = screen.getByRole("log", { name: "ข้อความกับ เทรนเนอร์ ค." });
    const composer = screen.getByRole("form", { name: "เขียนข้อความถึง เทรนเนอร์ ค." });

    expect(heading.compareDocumentPosition(facts as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(log.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(facts).not.toHaveAttribute("open");
    expect(within(composer).getByRole("button", { name: "ส่งข้อความ" })).toBeEnabled();
    expect(screen.getAllByRole("form", { name: /เขียนข้อความถึง/ })).toHaveLength(1);
  });

  it("uses a searchable room list and places booking facts inside the active conversation", async () => {
    stubDesktopFacts(true);
    const first = bookingFixture();
    const second = bookingFixture({
      id: "BK-CHAT-002",
      chatRoomId: 22,
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ด." },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([first, second])
      .mockResolvedValueOnce([]);

    render(<ChatWorkbench />);
    await flushPromises();

    const roomList = screen.getByRole("complementary", { name: "ห้องตามคำขอจอง" });
    const search = within(roomList).getByRole("searchbox", { name: "ค้นหาห้องสนทนา" });
    fireEvent.change(search, { target: { value: "เทรนเนอร์ ด." } });
    expect(within(roomList).queryByRole("button", { name: /เทรนเนอร์ ค\./ })).not.toBeInTheDocument();
    expect(within(roomList).getByRole("button", { name: /เทรนเนอร์ ด\./ })).toBeInTheDocument();

    const conversation = screen.getByRole("region", { name: "สนทนากับ เทรนเนอร์ ค." });
    const facts = screen.getByText("รายละเอียดนัดหมาย", { selector: "summary" }).closest("details");
    expect(conversation).toContainElement(facts as HTMLElement);
  });

  it("aligns the signed-in member message separately and keeps a compact accessible composer", async () => {
    const trainerMessage = messageFixture(1, "เตรียมรองเท้าสำหรับฝึกด้วยครับ", {
      sender: { id: 3, displayName: "เทรนเนอร์ ค." },
    });
    const memberMessage = messageFixture(2, "รับทราบครับ");
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([bookingFixture()])
      .mockResolvedValueOnce([trainerMessage, memberMessage]);

    render(<ChatWorkbench />);
    await flushPromises();

    const rows = screen.getAllByTestId("message-row");
    expect(rows[0]).toHaveClass("chat-message", "chat-message--other");
    expect(rows[1]).toHaveClass("chat-message", "chat-message--mine");
    expect(within(rows[0]).getByText("เตรียมรองเท้าสำหรับฝึกด้วยครับ")).toBeInTheDocument();
    expect(within(rows[1]).getByText("รับทราบครับ")).toBeInTheDocument();

    const composer = screen.getByRole("form", { name: "เขียนข้อความถึง เทรนเนอร์ ค." });
    expect(within(composer).getByPlaceholderText("พิมพ์ข้อความ…")).toBeInTheDocument();
    expect(within(composer).getByRole("button", { name: "แนบไฟล์" })).toBeEnabled();
    expect(within(composer).getByRole("button", { name: "ส่งข้อความ" })).toBeEnabled();
  });

  it("polls the latest cursor every five seconds only on a visible tab and cleans up", async () => {
    const booking = bookingFixture();
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([booking])
      .mockResolvedValueOnce([messageFixture(4)])
      .mockResolvedValueOnce([messageFixture(5)])
      .mockResolvedValueOnce([messageFixture(6)]);

    const { unmount } = render(<ChatWorkbench />);
    await flushPromises();

    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushPromises();
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/chat-rooms/11/messages?afterId=4");

    setVisibility("hidden");
    await act(async () => { vi.advanceTimersByTime(5_000); });
    expect(authenticatedRequest).toHaveBeenCalledTimes(3);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await flushPromises();
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/chat-rooms/11/messages?afterId=5");

    unmount();
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(authenticatedRequest).toHaveBeenCalledTimes(4);
  });

  it("merges overlapping and out-of-order responses by ID in ascending order", async () => {
    const initial = deferred<ChatMessage[]>();
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([bookingFixture()])
      .mockImplementationOnce(() => initial.promise)
      .mockResolvedValueOnce([messageFixture(3), messageFixture(2)]);

    render(<ChatWorkbench />);
    await flushPromises();
    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushPromises();
    await act(async () => { initial.resolve([messageFixture(2), messageFixture(1)]); });

    const rows = screen.getAllByTestId("message-row");
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("ข้อความ 1"),
      expect.stringContaining("ข้อความ 2"),
      expect.stringContaining("ข้อความ 3"),
    ]);
  });

  it("resets the thread on room change and ignores a late response from the previous room", async () => {
    const oldRoom = deferred<ChatMessage[]>();
    const second = bookingFixture({
      id: "BK-CHAT-002",
      chatRoomId: 22,
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ด." },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/bookings") return Promise.resolve([bookingFixture(), second]);
      if (path === "/v1/chat-rooms/11/messages?afterId=0") return oldRoom.promise;
      if (path === "/v1/chat-rooms/22/messages?afterId=0") return Promise.resolve([messageFixture(8, "ข้อความห้องใหม่")]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench />);
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: /เทรนเนอร์ ด\./ }));
    await flushPromises();
    expect(screen.getByText("ข้อความห้องใหม่")).toBeInTheDocument();

    await act(async () => { oldRoom.resolve([messageFixture(7, "ข้อความห้องเก่า")]); });
    expect(screen.queryByText("ข้อความห้องเก่า")).not.toBeInTheDocument();
    expect(screen.getByText("ข้อความห้องใหม่")).toBeInTheDocument();
  });

  it("resets a pending send on room change and ignores the old completion while the new send is pending", async () => {
    const oldPost = deferred<ChatMessage>();
    const newPost = deferred<ChatMessage>();
    const oldCreated = messageFixture(31, "ข้อความจากห้องเก่า");
    const newCreated = messageFixture(41, "ข้อความจากห้องใหม่");
    const second = bookingFixture({
      id: "BK-CHAT-002",
      chatRoomId: 22,
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ด." },
    });
    let newRoomLoads = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path, init) => {
      if (path === "/v1/bookings") return Promise.resolve([bookingFixture(), second]);
      if (path === "/v1/chat-rooms/11/messages?afterId=0") return Promise.resolve([]);
      if (path === "/v1/chat-rooms/22/messages?afterId=0") {
        newRoomLoads += 1;
        return Promise.resolve(newRoomLoads === 1 ? [] : [newCreated]);
      }
      if (path === "/v1/chat-rooms/11/messages" && init?.method === "POST") return oldPost.promise;
      if (path === "/v1/chat-rooms/22/messages" && init?.method === "POST") return newPost.promise;
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench />);
    await flushPromises();
    fireEvent.change(screen.getByLabelText("ข้อความ"), { target: { value: "ข้อความจากห้องเก่า" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งข้อความ" }));

    fireEvent.click(screen.getByRole("button", { name: /เทรนเนอร์ ด\./ }));
    await flushPromises();
    const newRoomTextarea = screen.getByLabelText("ข้อความ");
    expect(newRoomTextarea).toBeEnabled();
    fireEvent.change(newRoomTextarea, { target: { value: "ข้อความจากห้องใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งข้อความ" }));
    expect(screen.getByRole("button", { name: "กำลังส่ง…" })).toBeDisabled();

    await act(async () => { oldPost.resolve(oldCreated); });
    await flushPromises();
    expect(screen.getByRole("button", { name: "กำลังส่ง…" })).toBeDisabled();
    expect(screen.queryByText("ข้อความจากห้องเก่า")).not.toBeInTheDocument();

    await act(async () => { newPost.resolve(newCreated); });
    await flushPromises();
    expect(screen.getByRole("button", { name: "ส่งข้อความ" })).toBeEnabled();
    expect(screen.getAllByText("ข้อความจากห้องใหม่")).toHaveLength(1);
  });

  it("does not show an older same-room load failure after a newer load succeeds", async () => {
    const olderLoad = deferred<ChatMessage[]>();
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([bookingFixture()])
      .mockImplementationOnce(() => olderLoad.promise)
      .mockResolvedValueOnce([messageFixture(5, "ข้อความล่าสุด")]);

    render(<ChatWorkbench />);
    await flushPromises();
    await act(async () => { vi.advanceTimersByTime(5_000); });
    await flushPromises();
    expect(screen.getByText("ข้อความล่าสุด")).toBeInTheDocument();

    await act(async () => { olderLoad.reject(new Error("คำขอเก่าล้มเหลว")); });
    await flushPromises();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("ข้อความล่าสุด")).toBeInTheDocument();
  });

  it("resets retry state on room change and ignores the old retry completion", async () => {
    const oldRetry = deferred<ChatMessage[]>();
    const newRetry = deferred<ChatMessage[]>();
    const second = bookingFixture({
      id: "BK-CHAT-002",
      chatRoomId: 22,
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ด." },
    });
    let oldRoomLoads = 0;
    let newRoomLoads = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/bookings") return Promise.resolve([bookingFixture(), second]);
      if (path === "/v1/chat-rooms/11/messages?afterId=0") {
        oldRoomLoads += 1;
        return oldRoomLoads === 1 ? Promise.reject(new Error("โหลดห้องเก่าไม่สำเร็จ")) : oldRetry.promise;
      }
      if (path === "/v1/chat-rooms/22/messages?afterId=0") {
        newRoomLoads += 1;
        return newRoomLoads === 1 ? Promise.reject(new Error("โหลดห้องใหม่ไม่สำเร็จ")) : newRetry.promise;
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench />);
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "ลองโหลดข้อความใหม่" }));
    fireEvent.click(screen.getByRole("button", { name: /เทรนเนอร์ ด\./ }));
    await flushPromises();
    const newRetryButton = screen.getByRole("button", { name: "ลองโหลดข้อความใหม่" });
    expect(newRetryButton).toBeEnabled();
    fireEvent.click(newRetryButton);
    expect(screen.getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();

    await act(async () => { oldRetry.resolve([messageFixture(7, "ข้อความรีไทรห้องเก่า")]); });
    await flushPromises();
    expect(screen.getByRole("button", { name: "กำลังโหลด…" })).toBeDisabled();
    expect(screen.queryByText("ข้อความรีไทรห้องเก่า")).not.toBeInTheDocument();

    await act(async () => { newRetry.resolve([messageFixture(8, "ข้อความรีไทรห้องใหม่")]); });
    await flushPromises();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("ข้อความรีไทรห้องใหม่")).toBeInTheDocument();
  });

  it("resets attachment-opening state on room change and ignores the old completion", async () => {
    const oldOpen = deferred<void>();
    const newOpen = deferred<void>();
    const oldAttachment = { name: "old.pdf", mime: "application/pdf", size: 1_024, url: "/protected/old" };
    const newAttachment = { name: "new.pdf", mime: "application/pdf", size: 2_048, url: "/protected/new" };
    const second = bookingFixture({
      id: "BK-CHAT-002",
      chatRoomId: 22,
      trainer: { id: 4, slug: "trainer-d", displayName: "เทรนเนอร์ ด." },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      if (path === "/v1/bookings") return Promise.resolve([bookingFixture(), second]);
      if (path === "/v1/chat-rooms/11/messages?afterId=0") {
        return Promise.resolve([messageFixture(3, "ไฟล์ห้องเก่า", { attachment: oldAttachment })]);
      }
      if (path === "/v1/chat-rooms/22/messages?afterId=0") {
        return Promise.resolve([messageFixture(4, "ไฟล์ห้องใหม่", { attachment: newAttachment })]);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    vi.mocked(openProtectedFile).mockImplementation((url) => {
      if (url === "/protected/old") return oldOpen.promise;
      if (url === "/protected/new") return newOpen.promise;
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    render(<ChatWorkbench />);
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "เปิดไฟล์ old.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: /เทรนเนอร์ ด\./ }));
    await flushPromises();
    const newOpenButton = screen.getByRole("button", { name: "เปิดไฟล์ new.pdf" });
    expect(newOpenButton).toBeEnabled();
    fireEvent.click(newOpenButton);
    expect(screen.getByRole("button", { name: "เปิดไฟล์ new.pdf" })).toHaveTextContent("กำลังเปิด…");

    await act(async () => { oldOpen.resolve(); });
    await flushPromises();
    expect(screen.getByRole("button", { name: "เปิดไฟล์ new.pdf" })).toHaveTextContent("กำลังเปิด…");

    await act(async () => { newOpen.resolve(); });
    await flushPromises();
    expect(screen.getByRole("button", { name: "เปิดไฟล์ new.pdf" })).toHaveTextContent("เปิดไฟล์");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("sends trimmed text and an optional PDF once, then clears only after success", async () => {
    const post = deferred<ChatMessage>();
    const created = messageFixture(10, "พร้อมเจอกันครับ", {
      attachment: { name: "plan.pdf", mime: "application/pdf", size: 1_024, url: "/file/10" },
    });
    vi.mocked(authenticatedRequest).mockImplementation((path, init) => {
      if (path === "/v1/bookings") return Promise.resolve([bookingFixture()]);
      if (path === "/v1/chat-rooms/11/messages?afterId=0" && !init) return Promise.resolve([]);
      if (path === "/v1/chat-rooms/11/messages" && init?.method === "POST") return post.promise;
      if (path === "/v1/chat-rooms/11/messages?afterId=0") return Promise.resolve([created]);
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench />);
    await flushPromises();
    const textarea = screen.getByLabelText("ข้อความ");
    const fileInput = screen.getByLabelText("ไฟล์แนบ");
    const file = new File([new Uint8Array(1_024)], "plan.pdf", { type: "application/pdf" });
    fireEvent.change(textarea, { target: { value: "  พร้อมเจอกันครับ  " } });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(screen.getByText("plan.pdf")).toBeInTheDocument();
    expect(screen.getByText(/PDF · 1 KB/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "เอาไฟล์ plan.pdf ออก" }));
    expect(screen.queryByText("plan.pdf")).not.toBeInTheDocument();
    fireEvent.change(fileInput, { target: { files: [file] } });

    const send = screen.getByRole("button", { name: "ส่งข้อความ" });
    fireEvent.click(send);
    fireEvent.click(send);
    expect(textarea).toHaveValue("  พร้อมเจอกันครับ  ");
    expect(vi.mocked(authenticatedRequest).mock.calls.filter(([path]) => path === "/v1/chat-rooms/11/messages")).toHaveLength(1);
    const formData = vi.mocked(authenticatedRequest).mock.calls.find(([path]) => path === "/v1/chat-rooms/11/messages")?.[1]?.body as FormData;
    expect(formData.get("message")).toBe("พร้อมเจอกันครับ");
    expect(formData.get("attachment")).toBe(file);

    await act(async () => { post.resolve(created); });
    await flushPromises();
    expect(textarea).toHaveValue("");
    expect(screen.queryByRole("button", { name: "เอาไฟล์ plan.pdf ออก" })).not.toBeInTheDocument();
    expect(screen.getByText("พร้อมเจอกันครับ")).toBeInTheDocument();
  });

  it("blocks empty, unsupported, and oversized submissions before the request", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([bookingFixture()])
      .mockResolvedValueOnce([]);
    render(<ChatWorkbench />);
    await flushPromises();

    fireEvent.click(screen.getByRole("button", { name: "ส่งข้อความ" }));
    expect(screen.getByRole("alert")).toHaveTextContent("กรุณาพิมพ์ข้อความหรือแนบไฟล์");

    const fileInput = screen.getByLabelText("ไฟล์แนบ");
    fireEvent.change(fileInput, { target: { files: [new File(["x"], "note.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("รองรับเฉพาะ JPEG, PNG, WebP หรือ PDF");

    const oversized = new File(["x"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(oversized, "size", { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(fileInput, { target: { files: [oversized] } });
    expect(screen.getByRole("alert")).toHaveTextContent("ไฟล์ต้องมีขนาดไม่เกิน 5 MB");
    expect(vi.mocked(authenticatedRequest).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("retries only message refresh after a successful POST and does not duplicate the sent row", async () => {
    const created = messageFixture(12, "ส่งสำเร็จแต่โหลดต่อไม่ได้");
    let initialLoaded = false;
    let refreshAttempts = 0;
    vi.mocked(authenticatedRequest).mockImplementation((path, init) => {
      if (path === "/v1/bookings") return Promise.resolve([bookingFixture()]);
      if (path === "/v1/chat-rooms/11/messages" && init?.method === "POST") return Promise.resolve(created);
      if (path === "/v1/chat-rooms/11/messages?afterId=0") {
        if (!initialLoaded) {
          initialLoaded = true;
          return Promise.resolve([]);
        }
        refreshAttempts += 1;
        return refreshAttempts === 1 ? Promise.reject(new Error("โหลดข้อความล่าสุดไม่สำเร็จ")) : Promise.resolve([created]);
      }
      return Promise.reject(new Error(`unexpected ${path}`));
    });

    render(<ChatWorkbench />);
    await flushPromises();
    fireEvent.change(screen.getByLabelText("ข้อความ"), { target: { value: "ส่งสำเร็จแต่โหลดต่อไม่ได้" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งข้อความ" }));
    await flushPromises();

    expect(screen.getByLabelText("ข้อความ")).toHaveValue("");
    expect(screen.getByRole("alert")).toHaveTextContent("ส่งข้อความแล้ว แต่โหลดข้อความล่าสุดไม่สำเร็จ");
    expect(screen.getAllByText("ส่งสำเร็จแต่โหลดต่อไม่ได้")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "ลองโหลดข้อความใหม่" }));
    await flushPromises();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("ส่งสำเร็จแต่โหลดต่อไม่ได้")).toHaveLength(1);
    expect(vi.mocked(authenticatedRequest).mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("opens protected attachments and reports access errors", async () => {
    const attachment = { name: "schedule.pdf", mime: "application/pdf", size: 2_048, url: "/protected/3" };
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([bookingFixture()])
      .mockResolvedValueOnce([messageFixture(3, "ตารางฝึก", { attachment })]);
    vi.mocked(openProtectedFile).mockRejectedValue(new Error("ไม่มีสิทธิ์เปิดไฟล์นี้"));

    render(<ChatWorkbench />);
    await flushPromises();
    fireEvent.click(screen.getByRole("button", { name: "เปิดไฟล์ schedule.pdf" }));
    await flushPromises();

    expect(openProtectedFile).toHaveBeenCalledWith("/protected/3");
    expect(screen.getByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์เปิดไฟล์นี้");
  });

  it("keeps cancelled rooms readable and replaces the composer with a factual notice", async () => {
    const cancelled = bookingFixture({
      status: "cancelled",
      actions: { ...bookingFixture().actions, canSendChat: false },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([cancelled])
      .mockResolvedValueOnce([messageFixture(2, "ข้อความเดิมยังอ่านได้")]);

    render(<ChatWorkbench />);
    await flushPromises();

    expect(screen.getByText("ข้อความเดิมยังอ่านได้")).toBeInTheDocument();
    expect(screen.queryByLabelText("ข้อความ")).not.toBeInTheDocument();
    expect(screen.getByText("การจองนี้ถูกยกเลิกแล้ว จึงส่งข้อความเพิ่มไม่ได้")).toBeInTheDocument();
  });

  it("keeps an expired room readable but disables new messages", async () => {
    const expired = bookingFixture({
      status: "expired",
      actions: { ...bookingFixture().actions, canSendChat: false },
    });
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([expired])
      .mockResolvedValueOnce([messageFixture(3, "ประวัติยังอยู่")]);

    render(<ChatWorkbench />);
    await flushPromises();

    expect(screen.getAllByText("หมดเวลาแล้ว")).toHaveLength(2);
    expect(screen.getByText("ประวัติยังอยู่")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /เขียนข้อความถึง/ })).not.toBeInTheDocument();
    expect(screen.getByText("การจองหมดเวลาแล้ว ประวัติยังอ่านได้แต่ส่งข้อความเพิ่มไม่ได้")).toBeInTheDocument();
  });

  it("falls back from an unknown requested booking and shows a useful empty state when no room is available", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce([bookingFixture()])
      .mockResolvedValueOnce([]);
    const { unmount } = render(<ChatWorkbench initialBookingId="BK-NOT-ALLOWED" />);
    await flushPromises();
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/chat-rooms/11/messages?afterId=0");
    unmount();

    vi.mocked(authenticatedRequest).mockReset();
    vi.mocked(authenticatedRequest).mockResolvedValueOnce([
      bookingFixture({ chatRoomId: null }),
      bookingFixture({ id: "BK-HIDDEN", actions: { ...bookingFixture().actions, canReadChat: false } }),
    ]);
    render(<ChatWorkbench />);
    await flushPromises();

    const empty = screen.getByRole("region", { name: "ยังไม่มีห้องสนทนาที่เปิดอ่านได้" });
    expect(within(empty).getByText("ห้องสนทนาจะเปิดตามสถานะของคำขอจอง")).toBeInTheDocument();
    expect(within(empty).getByRole("link", { name: "กลับไปดูการจอง" })).toHaveAttribute("href", "/member");
  });
});
