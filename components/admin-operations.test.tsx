import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminOperations } from "@/components/admin-operations";
import { authenticatedRequest } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, authenticatedRequest: vi.fn() };
});
vi.mock("@/components/admin-review-queue", () => ({
  AdminReviewQueue: () => <div>คิวตรวจสอบจริง</div>,
}));

const operations = {
  currentUserId: 5,
  permissions: { manageUsers: true, reviewTrainers: true, manageBookings: true, reviewPayments: true },
  summary: { activeMembers: 1, activeTrainers: 1, totalBookings: 1, approvedRevenue: 1200 },
  users: [
    { id: 7, email: "member@example.com", displayName: "สมาชิกหนึ่ง", role: "member", status: "active", createdAt: "2026-08-01T00:00:00.000Z", approvalStatus: null },
    { id: 8, email: "trainer@example.com", displayName: "เทรนเนอร์หนึ่ง", role: "trainer", status: "active", createdAt: "2026-08-01T00:00:00.000Z", approvalStatus: "approved" },
  ],
  administrators: [
    { id: 5, email: "admin@example.com", displayName: "ผู้ดูแลระบบหลัก", role: "admin", status: "active", createdAt: "2026-08-01T00:00:00.000Z", approvalStatus: null,
      permissions: { manageUsers: true, reviewTrainers: true, manageBookings: true, reviewPayments: true } },
  ],
  bookings: [{
    id: "BK-ONE", memberName: "สมาชิกหนึ่ง", trainerName: "เทรนเนอร์หนึ่ง",
    startsAt: "2026-08-15T02:00:00.000Z", endsAt: "2026-08-15T03:00:00.000Z",
    status: "confirmed", paymentStatus: "approved", quotedPrice: 1200, createdAt: "2026-08-01T00:00:00.000Z",
    history: [{ fromStatus: "payment_review", toStatus: "confirmed", changedBy: "ผู้ดูแลระบบหลัก", note: "ตรวจแล้ว", createdAt: "2026-08-02T00:00:00.000Z" }],
  }],
  payments: [{ id: 21, bookingId: "BK-ONE", memberName: "สมาชิกหนึ่ง", trainerName: "เทรนเนอร์หนึ่ง", amount: 1200, quotedPrice: 1200, status: "approved", submittedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z", reviewedBy: "ผู้ดูแลระบบหลัก" }],
  trainerIncome: [{ trainerId: 3, trainerName: "เทรนเนอร์หนึ่ง", paidSessions: 1, revenue: 1200 }],
  pagination: {
    pageSize: 10,
    users: { page: 0, total: 2 }, administrators: { page: 0, total: 1 },
    bookings: { page: 0, total: 1 }, payments: { page: 0, total: 1 }, trainerIncome: { page: 0, total: 1 },
  },
};

const isOperationsRequest = (path: string) => path.startsWith("/v1/admin/operations?");

describe("AdminOperations", () => {
  beforeEach(() => { push.mockReset(); vi.mocked(authenticatedRequest).mockReset(); });

  it("shows the five administrator duties without mixing their records", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path) => isOperationsRequest(path)
      ? Promise.resolve(operations)
      : Promise.resolve({ trainers: [], payments: [] }));
    render(<AdminOperations />);

    const reviewTab = await screen.findByRole("tab", { name: "คิวตรวจสอบ" });
    expect(reviewTab).toHaveAttribute("aria-selected", "true");
    for (const name of ["บัญชีผู้ใช้", "การจองทั้งหมด", "การเงิน", "ผู้ดูแลระบบ"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }

    fireEvent.keyDown(reviewTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "บัญชีผู้ใช้" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("สมาชิกหนึ่ง")).toBeInTheDocument();
    expect(screen.getByText("เทรนเนอร์หนึ่ง")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "การจองทั้งหมด" }));
    const bookingDetails = screen.getByText("BK-ONE").closest("details");
    expect(bookingDetails).not.toBeNull();
    fireEvent.click(within(bookingDetails!).getByText("BK-ONE"));
    expect(screen.getByText("ตรวจแล้ว")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "การเงิน" }));
    expect(screen.getAllByText("฿1,200").length).toBeGreaterThan(0);
  });

  it("suspends an account only after confirmation and reloads current data", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(operations)
      .mockResolvedValueOnce({ id: 7, status: "suspended" })
      .mockResolvedValueOnce({ ...operations, users: operations.users.map((user) => user.id === 7 ? { ...user, status: "suspended" } : user) });
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "บัญชีผู้ใช้" }));
    fireEvent.click(screen.getByRole("button", { name: "ระงับบัญชี สมาชิกหนึ่ง" }));
    expect(screen.getByRole("dialog", { name: "ระงับบัญชี" })).toHaveTextContent("member@example.com");
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันการเปลี่ยนสถานะ" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/admin/users/7", {
      method: "PATCH",
      body: JSON.stringify({ status: "suspended" }),
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("ระงับบัญชี “สมาชิกหนึ่ง” แล้ว");
  });

  it("cancels a booking from a dialog with an explicit reason", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(operations)
      .mockResolvedValueOnce({ id: "BK-ONE", status: "cancelled" })
      .mockResolvedValueOnce(operations);
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "การจองทั้งหมด" }));
    fireEvent.click(screen.getByText("BK-ONE"));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกคำขอจองนี้" }));

    const dialog = screen.getByRole("dialog", { name: "ยกเลิกคำขอจอง" });
    fireEvent.change(within(dialog).getByLabelText("เหตุผลในการยกเลิก"), { target: { value: "สมาชิกแจ้งยกเลิก" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันการยกเลิก" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings/BK-ONE/status", {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled", note: "สมาชิกแจ้งยกเลิก" }),
    }));
  });

  it("creates a system administrator with explicit permissions", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path, init) => {
      if (isOperationsRequest(path)) return Promise.resolve(operations);
      if (path === "/v1/admin/payment-routing") return Promise.resolve({ unresolved: [] });
      if (path === "/v1/admin/users" && init?.method === "POST") return Promise.resolve({ id: 11, role: "admin", status: "active" });
      throw new Error(`Unexpected request: ${path}`);
    });
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "ผู้ดูแลระบบ" }));
    const form = screen.getByRole("form", { name: "เพิ่มผู้ดูแลระบบ" });
    fireEvent.change(within(form).getByLabelText("ชื่อที่แสดง"), { target: { value: "ผู้ดูแลการเงิน" } });
    fireEvent.change(within(form).getByLabelText("อีเมล"), { target: { value: "finance@example.com" } });
    fireEvent.change(within(form).getByLabelText(/รหัสผ่านเริ่มต้น/), { target: { value: "password123" } });
    fireEvent.click(within(form).getByLabelText("ตรวจการชำระเงินและรายได้"));
    fireEvent.submit(form);

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/admin/users", expect.objectContaining({ method: "POST" })));
    expect(await screen.findByRole("status")).toHaveTextContent("เพิ่มผู้ดูแลระบบแล้ว");
  });

  it("does not let an administrator delegate permissions they do not have", async () => {
    const limited = {
      ...operations,
      permissions: { manageUsers: true, reviewTrainers: false, manageBookings: false, reviewPayments: false },
      summary: { activeMembers: 1, activeTrainers: 1, totalBookings: null, approvedRevenue: null },
    };
    vi.mocked(authenticatedRequest).mockResolvedValue(limited);
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "ผู้ดูแลระบบ" }));
    const form = screen.getByRole("form", { name: "เพิ่มผู้ดูแลระบบ" });

    expect(within(form).getByLabelText("จัดการบัญชีผู้ใช้และผู้ดูแลระบบ")).toBeEnabled();
    expect(within(form).getByLabelText("ตรวจการชำระเงินและรายได้")).toBeDisabled();
  });

  it("keeps password rotation available without user-management access", async () => {
    const paymentOnly = {
      ...operations,
      permissions: { manageUsers: false, reviewTrainers: false, manageBookings: false, reviewPayments: true },
      summary: { activeMembers: null, activeTrainers: null, totalBookings: null, approvedRevenue: 1200 },
      users: [], administrators: [], bookings: [],
      pagination: { ...operations.pagination, users: { page: 0, total: 0 }, administrators: { page: 0, total: 0 }, bookings: { page: 0, total: 0 } },
    };
    vi.mocked(authenticatedRequest).mockResolvedValue(paymentOnly);
    render(<AdminOperations />);

    expect(await screen.findByRole("tab", { name: "บัญชีของฉัน" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "ผู้ดูแลระบบ" })).not.toBeInTheDocument();
  });

  it("edits member details from the account disclosure", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(operations)
      .mockResolvedValueOnce({ id: 7, displayName: "สมาชิกแก้ไขแล้ว" })
      .mockResolvedValueOnce(operations);
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "บัญชีผู้ใช้" }));
    const details = screen.getByText("สมาชิกหนึ่ง").closest("details");
    expect(details).not.toBeNull();
    fireEvent.click(within(details!).getByText("สมาชิกหนึ่ง"));
    fireEvent.change(within(details!).getByLabelText("ชื่อที่แสดง"), { target: { value: "สมาชิกแก้ไขแล้ว" } });
    fireEvent.submit(within(details!).getByRole("button", { name: "บันทึกข้อมูลบัญชี" }).closest("form")!);

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/admin/users/7", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "สมาชิกแก้ไขแล้ว", email: "member@example.com" }),
    }));
  });

  it("lets the current administrator edit identity without sending locked permissions", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(operations)
      .mockResolvedValueOnce({ id: 5, displayName: "ผู้ดูแลระบบคนปัจจุบัน" })
      .mockResolvedValueOnce(operations);
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "ผู้ดูแลระบบ" }));
    const details = screen.getByText("ผู้ดูแลระบบหลัก").closest("details");
    expect(details).not.toBeNull();
    fireEvent.click(within(details!).getByText("ผู้ดูแลระบบหลัก"));
    fireEvent.change(within(details!).getByLabelText("ชื่อที่แสดง"), { target: { value: "ผู้ดูแลระบบคนปัจจุบัน" } });
    fireEvent.submit(within(details!).getByRole("button", { name: "บันทึกบัญชีผู้ดูแลระบบ" }).closest("form")!);

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/admin/users/5", {
      method: "PATCH",
      body: JSON.stringify({ displayName: "ผู้ดูแลระบบคนปัจจุบัน", email: "admin@example.com" }),
    }));
  });

  it("lets the current administrator replace the initial password", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce(operations).mockResolvedValueOnce({ changed: true });
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "บัญชีของฉัน" }));
    fireEvent.click(screen.getByText("รหัสผ่านของบัญชีนี้"));
    const form = screen.getByRole("form", { name: "เปลี่ยนรหัสผ่านผู้ดูแลระบบ" });
    fireEvent.change(within(form).getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "password" } });
    fireEvent.change(within(form).getByLabelText(/รหัสผ่านใหม่ อย่างน้อย/), { target: { value: "new-password" } });
    fireEvent.change(within(form).getByLabelText("ยืนยันรหัสผ่านใหม่"), { target: { value: "new-password" } });
    fireEvent.submit(form);

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword: "password", newPassword: "new-password" }),
    }));
  });

  it("keeps long account lists compact with ten records per page", async () => {
    const manyUsers = Array.from({ length: 12 }, (_, index) => ({
      id: 100 + index,
      email: `member-${index + 1}@example.com`,
      displayName: `สมาชิกลำดับ ${index + 1}`,
      role: "member" as const,
      status: "active" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
      approvalStatus: null,
    }));
    vi.mocked(authenticatedRequest).mockImplementation((path) => {
      const requestedPage = new URL(`http://local${path}`).searchParams.get("userPage");
      if (requestedPage === "1") return Promise.resolve({
        ...operations,
        users: manyUsers.slice(10),
        pagination: { ...operations.pagination, users: { page: 1, total: 12 } },
      });
      return Promise.resolve({
        ...operations,
        users: manyUsers.slice(0, 10),
        pagination: { ...operations.pagination, users: { page: 0, total: 12 } },
      });
    });
    render(<AdminOperations />);
    fireEvent.click(await screen.findByRole("tab", { name: "บัญชีผู้ใช้" }));

    expect(screen.getByText("สมาชิกลำดับ 10")).toBeInTheDocument();
    expect(screen.queryByText("สมาชิกลำดับ 11")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "หน้าบัญชีถัดไป" }));
    expect(await screen.findByText("สมาชิกลำดับ 11")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("สมาชิกลำดับ 1")).not.toBeInTheDocument());
  });
});
