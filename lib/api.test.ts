import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, authHeaders } from "@/lib/api";

afterEach(() => {
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
