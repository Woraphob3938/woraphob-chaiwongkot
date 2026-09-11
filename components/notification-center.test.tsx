import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { NotificationCenter } from "@/components/notification-center";
import type { NotificationDetail, NotificationItem, NotificationListResponse } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, authenticatedRequest: vi.fn() };
});

const mockedRequest = vi.mocked(authenticatedRequest);

const bookingStatusLabel = {
  awaiting_payment: "รอชำระเงิน",
  confirmed: "ยืนยันการชำระแล้ว",
  completed: "ฝึกเสร็จแล้ว",
} as const;

const paymentStatusLabel = {
  not_submitted: "ยังไม่ส่งหลักฐาน",
  approved: "อนุมัติแล้ว",
} as const;

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

function detail(
  entry = item(1),
  bookingOverrides: Partial<NotificationDetail["booking"]> = {},
): NotificationDetail {
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
      ...bookingOverrides,
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

  it("opens the administrator payment review from a notification", async () => {
    const entry = item(1, { actionPath: "/admin", title: "มีสลิปรอตรวจ" });
    mockedRequest.mockImplementation(async (path) => {
      if (path === "/v1/notifications/1") return detail(entry, { status: "payment_review" });
      if (String(path).endsWith("/read")) return { id: 1, read: true };
      return list([entry]);
    });
    render(<NotificationCenter />);
    fireEvent.click(await screen.findByText("มีสลิปรอตรวจ"));
    expect(await screen.findByRole("link", { name: "ตรวจสอบการชำระเงิน" })).toHaveAttribute("href", "/admin");
  });

  it("keeps the repeated page heading available only to assistive technology", async () => {
    mockedRequest.mockResolvedValue(list([]));
    render(<NotificationCenter />);

    expect(screen.getByRole("heading", { name: "การแจ้งเตือน" })).toHaveClass("sr-only");
    expect(screen.queryByText("ติดตามการจอง การชำระเงิน และนัดหมายล่าสุด")).not.toBeInTheDocument();
    await screen.findByText("ยังไม่มีการแจ้งเตือนในหมวดนี้");
    expect(screen.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านแล้วทั้งหมด" })).toBeInTheDocument();
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
    mockedRequest.mockRejectedValueOnce(new ApiError("offline", 503)).mockResolvedValueOnce(list([]));
    render(<NotificationCenter />);

    expect(await screen.findByRole("alert")).toHaveTextContent("เชื่อมต่อ FitConnect ไม่ได้");
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(2));
    expect(mockedRequest).toHaveBeenNthCalledWith(2, "/v1/notifications?page=0&category=all&unread=false");
  });

  it("sends an expired session to login without server troubleshooting advice", async () => {
    mockedRequest.mockImplementation((path) => path === undefined
      ? Promise.resolve(list([]))
      : Promise.reject(new ApiError("Unauthorized", 401, "AUTH_REQUIRED")));
    render(<NotificationCenter />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("กรุณาเข้าสู่ระบบอีกครั้ง");
    expect(alert).not.toHaveTextContent(/Apache|MySQL/);
    expect(within(alert).getByRole("link", { name: "เข้าสู่ระบบ" })).toHaveAttribute("href", "/login");
  });

  it("keeps filters mounted and focused while a refreshed list is loading", async () => {
    const refreshed = deferred<NotificationListResponse>();
    mockedRequest
      .mockResolvedValueOnce(list([item(1)], {
        pagination: { page: 0, pageSize: 10, total: 11, totalPages: 2 },
      }))
      .mockImplementationOnce(() => refreshed.promise);
    render(<NotificationCenter />);
    await screen.findByText("ยืนยันการจอง 1");

    const paymentCategory = screen.getByRole("button", { name: /การชำระเงิน/ });
    paymentCategory.focus();
    fireEvent.click(paymentCategory);

    expect(paymentCategory).toHaveFocus();
    expect(screen.getByRole("region", { name: "กล่องข้อความแจ้งเตือน" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "กำลังโหลดรายการแจ้งเตือน" })).toBeInTheDocument();

    refreshed.resolve(list([]));
    await waitFor(() => expect(screen.getByRole("region", { name: "กล่องข้อความแจ้งเตือน" })).toHaveAttribute("aria-busy", "false"));
  });

  it("requests the chosen category, unread filter, and next page", async () => {
    mockedRequest.mockResolvedValue(list([item(1)], {
      pagination: { page: 0, pageSize: 10, total: 11, totalPages: 2 },
    }));
    render(<NotificationCenter />);
    await screen.findByText("ยืนยันการจอง 1");

    fireEvent.click(screen.getByRole("button", { name: /การชำระเงิน/ }));
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

  it("shows a visible recovery message when marking all notifications fails", async () => {
    mockedRequest.mockImplementation((path, init) => {
      if (path === undefined) return Promise.resolve({ updated: 0 });
      if (path.startsWith("/v1/notifications?")) {
        return Promise.resolve(list([item(1)], {
          unread: { all: 1, booking: 0, payment: 1, appointment: 0 },
        }));
      }
      if (path === "/v1/notifications/read-all" && init?.method === "POST") {
        return Promise.reject(new ApiError("failed", 500));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<NotificationCenter />);
    await screen.findByText("ยืนยันการจอง 1");

    fireEvent.click(screen.getByRole("button", { name: "ทำเครื่องหมายว่าอ่านแล้วทั้งหมด" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ยังทำเครื่องหมายว่าอ่านแล้วทั้งหมดไม่ได้");
  });

  it("clears both category and unread filters from a filtered empty state", async () => {
    mockedRequest.mockResolvedValue(list([]));
    render(<NotificationCenter />);

    expect(await screen.findByText("ยังไม่มีการแจ้งเตือนในหมวดนี้")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เฉพาะที่ยังไม่ได้อ่าน" }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications?page=0&category=all&unread=true"));
    fireEvent.click(screen.getByRole("button", { name: /การชำระเงิน/ }));
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications?page=0&category=payment&unread=true"));

    fireEvent.click(screen.getByRole("button", { name: "ดูทั้งหมด" }));

    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith("/v1/notifications?page=0&category=all&unread=false"));
    expect(screen.getByRole("button", { name: "ทั้งหมด ไม่มีรายการที่ยังไม่ได้อ่าน" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "เฉพาะที่ยังไม่ได้อ่าน" })).toHaveAttribute("aria-pressed", "false");
  });

  it("includes unread counts in category names and provides a compact mobile category control", async () => {
    mockedRequest.mockResolvedValue(list([item(1)], {
      unread: { all: 7, booking: 1, payment: 5, appointment: 1 },
    }));
    render(<NotificationCenter />);

    expect(await screen.findByRole("button", { name: "การชำระเงิน มี 5 รายการที่ยังไม่ได้อ่าน" })).toBeInTheDocument();
    const categorySelect = screen.getByRole("combobox", { name: "หมวดการแจ้งเตือน" });
    expect(categorySelect).toHaveValue("all");
    expect(within(categorySelect).getByRole("option", { name: "นัดหมาย (1)" })).toBeInTheDocument();
  });

  it.each([
    ["awaiting_payment", "not_submitted", "/member", "ส่งหลักฐานการชำระเงิน"],
    ["confirmed", "approved", "/trainer", "ดูตารางนัดหมาย"],
    ["completed", "approved", "/member", "เขียนรีวิว"],
  ] as const)("shows semantic statuses and the next action for %s", async (status, paymentState, actionPath, actionLabel) => {
    const entry = item(1, { actionPath, readAt: "2026-08-12T10:00:00.000Z" });
    mockedRequest.mockImplementation((path) => {
      if (path === undefined) return Promise.resolve(list([]));
      if (path.startsWith("/v1/notifications?")) return Promise.resolve(list([entry]));
      if (path === "/v1/notifications/1") {
        return Promise.resolve(detail(entry, { status, paymentStatus: paymentState }));
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<NotificationCenter />);
    fireEvent.click(await screen.findByRole("button", { name: /ยืนยันการจอง 1/ }));

    expect(await screen.findByRole("link", { name: actionLabel })).toHaveAttribute("href", actionPath);
    expect(screen.getByText(bookingStatusLabel[status])).toHaveClass("status-badge");
    expect(screen.getByText(paymentStatusLabel[paymentState])).toHaveClass("status-badge");
  });

  it("retries a failed detail request in place", async () => {
    const entry = item(1, { readAt: "2026-08-12T10:00:00.000Z" });
    mockedRequest
      .mockResolvedValueOnce(list([entry]))
      .mockRejectedValueOnce(new ApiError("failed", 500))
      .mockResolvedValueOnce(detail(entry));
    render(<NotificationCenter />);
    fireEvent.click(await screen.findByRole("button", { name: /ยืนยันการจอง 1/ }));

    const detailAlert = await screen.findByRole("alert");
    fireEvent.click(within(detailAlert).getByRole("button", { name: "ลองเปิดรายละเอียดอีกครั้ง" }));

    expect(await screen.findByRole("heading", { name: "ยืนยันการจอง 1" })).toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledTimes(3);
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

    const action = screen.queryByRole("link", { name: "ดูตารางนัดหมาย" });
    if (visible) expect(action).toHaveAttribute("href", "/member");
    else expect(action).not.toBeInTheDocument();
    expect(mockedRequest.mock.calls.map(([path]) => path)).not.toContain(undefined);
  });

  it("filters notifications by search query in the toolbar", async () => {
    const first = item(1, { title: "การจองคอร์สฟิตเนส", bookingId: "BK-00000001" });
    const second = item(2, { title: "แจ้งเตือนการชำระเงิน", bookingId: "BK-00000002" });
    mockedRequest.mockResolvedValue(list([first, second]));
    render(<NotificationCenter />);

    await screen.findByText("การจองคอร์สฟิตเนส");
    expect(screen.getByText("แจ้งเตือนการชำระเงิน")).toBeInTheDocument();

    const searchInput = screen.getByLabelText("ค้นหาการแจ้งเตือน");
    fireEvent.change(searchInput, { target: { value: "BK-00000002" } });

    expect(screen.queryByText("การจองคอร์สฟิตเนส")).not.toBeInTheDocument();
    expect(screen.getByText("แจ้งเตือนการชำระเงิน")).toBeInTheDocument();
  });

  it("displays urgency badge for payment notifications needing action", async () => {
    const urgentItem = item(1, {
      title: "รอการชำระเงิน",
      message: "กรุณาแนบหลักฐานการชำระเงินภายใน 10 นาที",
    });
    mockedRequest.mockResolvedValue(list([urgentItem]));
    render(<NotificationCenter />);

    expect(await screen.findByText("⚠️ ต้องดำเนินการ")).toBeInTheDocument();
  });
});
