import { afterEach, describe, expect, it, vi } from "vitest";
import { API_URL, apiRequest, authHeaders, authenticatedRequest, openProtectedFile } from "@/lib/api";
import type { Booking } from "@/lib/types";

const expandedBooking: Booking = {
  id: "BK-EXPANDED",
  trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
  member: { displayName: "สมาชิกทดสอบ" },
  startsAt: "2026-08-10T02:00:00.000Z",
  endsAt: "2026-08-10T03:00:00.000Z",
  location: "ฟิตเนสทดสอบ",
  note: "มีอาการเจ็บเข่า",
  status: "payment_review",
  paymentStatus: "reviewing",
  quotedPrice: 1_200,
  chatRoomId: 8,
  payment: {
    id: 21,
    amount: null,
    status: "reviewing",
    reviewNote: null,
    submittedAt: "2026-08-01T01:00:00.000Z",
  },
  review: null,
  actions: {
    canPay: false,
    canReadChat: true,
    canSendChat: true,
    canComplete: false,
    canReview: false,
  },
  createdAt: "2026-08-01T00:00:00.000Z",
  demo: false,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("apiRequest", () => {
  it("keeps the API code and field errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({
        error: { code: "VALIDATION_FAILED", message: "แก้ไขข้อมูล", fields: { note: "จำเป็นต้องระบุเหตุผล" } },
      }),
    }));

    await expect(apiRequest("/test")).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: { note: "จำเป็นต้องระบุเหตุผล" },
    });
  });
});

describe("authHeaders", () => {
  it("uses the saved bearer token", () => {
    localStorage.setItem("fitconnect_token", "abc123");
    expect(authHeaders()).toEqual({ Authorization: "Bearer abc123" });
  });
});

describe("authenticatedRequest", () => {
  it("keeps the browser FormData boundary while adding bearer auth", async () => {
    localStorage.setItem("fitconnect_token", "abc123");
    const body = new FormData();
    body.set("bookingId", "BK-EXPANDED");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ data: { saved: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await authenticatedRequest("/v1/payments", { method: "POST", body });

    expect(fetchMock).toHaveBeenCalledWith(`${API_URL}/v1/payments`, expect.objectContaining({
      method: "POST",
      body,
      headers: expect.objectContaining({
        Accept: "application/json",
        Authorization: "Bearer abc123",
      }),
    }));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).not.toHaveProperty("Content-Type");
  });
});

describe("openProtectedFile", () => {
  it("fetches with bearer auth and revokes the temporary object URL", async () => {
    vi.useFakeTimers();
    localStorage.setItem("fitconnect_token", "secret-token");
    const file = new Blob(["slip"], { type: "image/png" });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: vi.fn().mockResolvedValue(file),
    });
    const createObjectURL = vi.fn().mockReturnValue("blob:fitconnect-slip");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    await openProtectedFile("/v1/admin/files/payment/21");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_URL}/v1/admin/files/payment/21`,
      { headers: { Authorization: "Bearer secret-token" } },
    );
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain("secret-token");
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(open).toHaveBeenCalledWith("blob:fitconnect-slip", "_blank", "noopener,noreferrer");
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fitconnect-slip");
  });

  it("preserves the protected-file API error details", async () => {
    localStorage.setItem("fitconnect_token", "secret-token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: vi.fn().mockResolvedValue({
        error: { code: "FILE_FORBIDDEN", message: "ไม่มีสิทธิ์เปิดไฟล์", fields: { path: "ถูกปฏิเสธ" } },
      }),
    }));

    await expect(openProtectedFile("/v1/admin/files/payment/21")).rejects.toMatchObject({
      status: 403,
      code: "FILE_FORBIDDEN",
      message: "ไม่มีสิทธิ์เปิดไฟล์",
      fields: { path: "ถูกปฏิเสธ" },
    });
  });
});

describe("Booking contract", () => {
  it("keeps unknown legacy payment amounts nullable", () => {
    expect(expandedBooking.payment?.amount).toBeNull();
    expect(expandedBooking.actions.canReadChat).toBe(true);
  });
});
