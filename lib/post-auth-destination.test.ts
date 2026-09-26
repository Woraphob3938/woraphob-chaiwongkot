import { describe, expect, it, vi } from "vitest";
import { resolveAuthRedirect, resolvePostAuthDestination, sanitizeRedirectPath } from "@/lib/post-auth-destination";
import type { AuthenticatedUser, TrainerWorkspace } from "@/lib/types";

const user = (role: AuthenticatedUser["role"]): AuthenticatedUser => ({
  id: 7,
  email: `${role}@fitconnect.test`,
  displayName: `ผู้ใช้ ${role}`,
  role,
  status: "active",
});

const workspace = (approvalStatus: "pending" | "approved" | "rejected"): TrainerWorkspace => ({
  profile: {
    id: 7,
    slug: "trainer-7",
    displayName: "เทรนเนอร์ทดสอบ",
    approvalStatus,
    approvalNote: approvalStatus === "rejected" ? "กรุณาแก้ไขเอกสาร" : null,
  },
  certificates: [],
  slots: [],
});

describe("resolvePostAuthDestination", () => {
  it.each([
    ["member", "/member"],
    ["admin", "/admin"],
  ] as const)("routes %s without loading a trainer workspace", async (role, expected) => {
    const loadTrainerWorkspace = vi.fn<() => Promise<TrainerWorkspace>>();

    await expect(resolvePostAuthDestination(user(role), loadTrainerWorkspace)).resolves.toBe(expected);
    expect(loadTrainerWorkspace).not.toHaveBeenCalled();
  });

  it("routes an incomplete trainer to professional profile setup", async () => {
    const destination = await resolvePostAuthDestination(user("trainer"), async () => ({
      profile: null,
      certificates: [],
      slots: [],
    }));

    expect(destination).toBe("/trainer/apply");
  });

  it.each(["pending", "approved", "rejected"] as const)(
    "routes a trainer with a %s profile to the trainer workspace",
    async (status) => {
      const destination = await resolvePostAuthDestination(user("trainer"), async () => workspace(status));
      expect(destination).toBe("/trainer");
    },
  );
});

describe("sanitizeRedirectPath", () => {
  it("keeps an internal path so a booking survives the sign-in detour", () => {
    expect(sanitizeRedirectPath("/booking?trainer=demo-trainer-a&slot=101"))
      .toBe("/booking?trainer=demo-trainer-a&slot=101");
    expect(sanitizeRedirectPath("/member#booking-BK-1")).toBe("/member#booking-BK-1");
  });

  it.each([
    ["//evil.example.com", "protocol-relative host"],
    ["https://evil.example.com", "absolute URL"],
    ["/\\evil.example.com", "backslash escape"],
    ["javascript:alert(1)", "non-path scheme"],
    ["relative/path", "path without a leading slash"],
    ["", "empty value"],
  ])("rejects %s (%s)", (value) => {
    expect(sanitizeRedirectPath(value)).toBeNull();
  });

  it("rejects non-string input", () => {
    expect(sanitizeRedirectPath(undefined)).toBeNull();
    expect(sanitizeRedirectPath(["a", "b"])).toBeNull();
  });
});

describe("resolveAuthRedirect", () => {
  it("lets an explicit destination win for every role, not only members", () => {
    expect(resolveAuthRedirect("/booking?slot=101", "/member")).toBe("/booking?slot=101");
    expect(resolveAuthRedirect("/booking?slot=101", "/trainer/apply")).toBe("/booking?slot=101");
    expect(resolveAuthRedirect("/booking?slot=101", "/admin")).toBe("/booking?slot=101");
  });

  it("falls back to the role destination when nothing was requested", () => {
    expect(resolveAuthRedirect(null, "/trainer")).toBe("/trainer");
    expect(resolveAuthRedirect(undefined, "/member")).toBe("/member");
  });
});
