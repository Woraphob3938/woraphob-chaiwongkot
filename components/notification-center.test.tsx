import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticatedRequest } from "@/lib/api";
import { NotificationCenter } from "@/components/notification-center";
import type { NotificationDetail, NotificationItem, NotificationListResponse } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, authenticatedRequest: vi.fn() };
});

const mockedRequest = vi.mocked(authenticatedRequest);

function item(id: number, overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id,
    type: "payment_approved_member",
    category: "payment",
    title: `ยืนยันการจอง ${id}`,
    message: "ผู้ดูแลระบบตรวจสอบการชำระเงินแล้ว",
    bookingId: `BK-${String(id).padStart(8, "0")}`,
    actionPath: "/member",
    readAt: null,
    createdAt: `2026-08-12T0${id % 9}:00:00.000Z`,
    ...overrides,
  };
}

function list(items: NotificationItem[] = [item(1)], overrides: Partial<NotificationListResponse> = {}): NotificationListResponse {
  return {
    items,
    unread: { all: items.filter((entry) => !entry.readAt).length, booking: 0, payment: items.length, appointment: 0 },
    pagination: { page: 0, pageSize: 10, total: items.length, totalPages: items.length ? 1 : 0 },
    ...overrides,
  };
}

function detail(entry = item(1)): NotificationDetail {
  return {
    ...entry,
    booking: {
      id: entry.bookingId,
      memberName: "สมาชิกหนึ่ง",
      trainerName: "เทรนเนอร์หนึ่ง",
      startsAt: "2026-08-13T03:00:00.000Z",
      endsAt: "2026-08-13T04:00:00.000Z",
      status: "confirmed",
      paymentStatus: "approved",
      quotedPrice: 650,
      history: [{ fromStatus: "payment_review", toStatus: "confirmed", note: null, createdAt: entry.createdAt }],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("NotificationCenter", () => {
  beforeEach(() => mockedRequest.mockReset());

  it("starts with notification controls instead of a repeated page intro", async () => {
    mockedRequest.mockResolvedValue(list([]));
    render(<NotificationCenter />);

    expect(screen.queryByRole("heading", { name: "การแจ้งเตือน" })).not.toBeInTheDocument();
    expect(screen.queryByText("ติดตามการจอง การชำระเงิน และนัดหมายล่าสุด")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านแล้วทั้งหมด" })).toBeInTheDocument();
    await screen.findByText("ยังไม่มีการแจ้งเตือนในหมวดนี้");
  });

  it("shows a polite skeleton while loading", async () => {
    mockedRequest.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return list([]);
    });
    render(<NotificationCenter />);

    expect(screen.getByRole("status", { name: "กำลังโหลดการแจ้งเตือน" })).toHaveAttribute("aria-live", "polite");
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    await screen.findByText("ยังไม่มีการแจ้งเตือนในหมวดนี้");
  });

  it("shows a useful error and retries the exact list request", async () => {
    mockedRequest.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(list([]));
    render(<NotificationCenter />);

    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดการแจ้งเตือนไม่สำเร็จ");
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "/v1/notifications?page=0&category=all&unread=false");
  });

  it("requests the chosen category, unread filter, and next page", async () => {
    mockedRequest.mockResolvedValue(list([item(1)], {
      pagination: { page: 0, pageSize: 10, total: 11, totalPages: 2 },
    }));
    render(<NotificationCenter />);
    await screen.findByText("ยืนยันการจอง 1");

    fireEvent.click(screen.getByRole("button", { name: "การชำระเงิน" }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications?page=0&category=payment&unread=false"));
    fireEvent.click(screen.getByRole("button", { name: "เฉพาะที่ยังไม่ได้อ่าน" }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications?page=0&category=payment&unread=true"));
    fireEvent.click(screen.getByRole("button", { name: "หน้าถัดไป" }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications?page=1&category=payment&unread=true"));
  });

  it("renders no more than the API page and uses semantic times", async () => {
    const pageItems = Array.from({ length: 10 }, (_, index) => item(index + 1));
    mockedRequest.mockResolvedValue(list(pageItems, {
      pagination: { page: 0, pageSize: 10, total: 24, totalPages: 3 },
    }));
    render(<NotificationCenter />);

    const notificationList = await screen.findByRole("list", { name: "รายการแจ้งเตือน" });
    expect(within(notificationList).getAllByRole("listitem")).toHaveLength(10);
    expect(notificationList.querySelectorAll("time")).toHaveLength(10);
  });

  it("opens an unread detail, marks it once, and announces the new count", async () => {
    const entry = item(1);
    mockedRequest.mockImplementation((path, init) => {
      if (path === undefined) return Promise.resolve(list([]));
      if (path === "/v1/notifications?page=0&category=all&unread=false") return Promise.resolve(list([entry], {
        unread: { all: 3, booking: 1, payment: 1, appointment: 1 },
      }));
      if (path === "/v1/notifications/1" && !init) return Promise.resolve(detail(entry));
      if (path === "/v1/notifications/1/read" && init?.method === "PATCH") return Promise.resolve({ read: true });
      throw new Error(`Unexpected request: ${path}`);
    });
    const changed = vi.fn();
    window.addEventListener("fitconnect:notifications-changed", changed);
    render(<NotificationCenter />);

    const unreadButton = await screen.findByRole("button", { name: /ยืนยันการจอง 1/ });
    expect(mockedRequest.mock.calls).toEqual([["/v1/notifications?page=0&category=all&unread=false"]]);
    fireEvent.click(unreadButton);

    expect(await screen.findByRole("heading", { name: "ยืนยันการจอง 1" })).toBeInTheDocument();
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications/1/read", { method: "PATCH" }));
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail).toEqual({ unreadTotal: 2 });
    expect(screen.getByRole("button", { name: /ยืนยันการจอง 1/ })).toHaveAttribute("data-read", "true");
    window.removeEventListener("fitconnect:notifications-changed", changed);
    expect(mockedRequest.mock.calls.map(([path]) => path)).not.toContain(undefined);
  });

  it("keeps the latest selected detail when an earlier request finishes later", async () => {
    const first = item(1, { readAt: "2026-08-12T10:00:00.000Z" });
    const second = item(2, { readAt: "2026-08-12T10:00:00.000Z" });
    const firstDetail = deferred<NotificationDetail>();
    const secondDetail = deferred<NotificationDetail>();
    mockedRequest.mockImplementation((path) => {
      if (path === undefined) return Promise.resolve(list([]));
      if (path.startsWith("/v1/notifications?")) return Promise.resolve(list([first, second]));
      if (path === "/v1/notifications/1") return firstDetail.promise;
      if (path === "/v1/notifications/2") return secondDetail.promise;
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<NotificationCenter />);
    fireEvent.click(await screen.findByRole("button", { name: /ยืนยันการจอง 1/ }));
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันการจอง 2/ }));

    secondDetail.resolve(detail(second));
    expect(await screen.findByRole("heading", { name: "ยืนยันการจอง 2" })).toBeInTheDocument();
    firstDetail.resolve(detail(first));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "ยืนยันการจอง 1" })).not.toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "ยืนยันการจอง 2" })).toBeInTheDocument();
  });

  it("removes a newly read item while the unread-only filter is active", async () => {
    const entry = item(1);
    mockedRequest.mockImplementation((path, init) => {
      if (path === undefined) return Promise.resolve(list([]));
      if (path.includes("unread=true")) return Promise.resolve(list([entry]));
      if (path.startsWith("/v1/notifications?")) return Promise.resolve(list([entry]));
      if (path === "/v1/notifications/1" && !init) return Promise.resolve(detail(entry));
      if (path === "/v1/notifications/1/read" && init?.method === "PATCH") return Promise.resolve({ read: true });
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<NotificationCenter />);
    await screen.findByRole("button", { name: /ยืนยันการจอง 1/ });
    fireEvent.click(screen.getByRole("button", { name: "เฉพาะที่ยังไม่ได้อ่าน" }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications?page=0&category=all&unread=true"));
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันการจอง 1/ }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /ยืนยันการจอง 1/ })).not.toBeInTheDocument());
  });

  it("marks every notification read", async () => {
    mockedRequest.mockImplementation((path, init) => {
      if (path === undefined) return Promise.resolve({ updated: 0 });
      if (path.startsWith("/v1/notifications?")) return Promise.resolve(list([item(1)]));
      if (path === "/v1/notifications/read-all" && init?.method === "POST") return Promise.resolve({ updated: 1 });
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<NotificationCenter />);
    await screen.findByText("ยืนยันการจอง 1");
    expect(mockedRequest.mock.calls).toEqual([["/v1/notifications?page=0&category=all&unread=false"]]);

    fireEvent.click(screen.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านแล้วทั้งหมด" }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications/read-all", { method: "POST" }));
    expect(mockedRequest.mock.calls.map(([path]) => path)).not.toContain(undefined);
  });

  it("explains an empty category and offers a return to all notifications", async () => {
    mockedRequest.mockResolvedValue(list([]));
    render(<NotificationCenter />);

    expect(await screen.findByText("ยังไม่มีการแจ้งเตือนในหมวดนี้")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดูทั้งหมด" })).toBeInTheDocument();
  });

  it.each([
    ["/member", true],
    ["https://phishing.example", false],
    ["//phishing.example", false],
    ["/\\phishing.example", false],
  ] as const)("renders the detail action only for a safe internal path: %s", async (actionPath, visible) => {
    const entry = item(1, { actionPath, readAt: "2026-08-12T10:00:00.000Z" });
    mockedRequest.mockImplementation((path) => {
      if (path === undefined) return Promise.resolve(list([]));
      if (path.startsWith("/v1/notifications?")) return Promise.resolve(list([entry]));
      if (path === "/v1/notifications/1") return Promise.resolve(detail(entry));
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<NotificationCenter />);
    const itemButton = await screen.findByRole("button", { name: /ยืนยันการจอง 1/ });
    expect(mockedRequest.mock.calls).toEqual([["/v1/notifications?page=0&category=all&unread=false"]]);
    fireEvent.click(itemButton);
    await screen.findByRole("heading", { name: "ยืนยันการจอง 1" });

    const action = screen.queryByRole("link", { name: "เปิดรายการที่เกี่ยวข้อง" });
    if (visible) expect(action).toHaveAttribute("href", "/member");
    else expect(action).not.toBeInTheDocument();
    expect(mockedRequest.mock.calls.map(([path]) => path)).not.toContain(undefined);
  });
});
