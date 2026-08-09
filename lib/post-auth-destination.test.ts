import { describe, expect, it, vi } from "vitest";
import { resolvePostAuthDestination } from "@/lib/post-auth-destination";
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
