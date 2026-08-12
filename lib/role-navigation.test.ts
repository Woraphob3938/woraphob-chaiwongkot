import { describe, expect, it } from "vitest";
import { navigationFor } from "@/lib/role-navigation";
import type { UserRole } from "@/lib/types";

function labels(role: UserRole | null) {
  return navigationFor(role).map((item) => item.label);
}

describe("navigationFor", () => {
  it("reserves trainer discovery and member bookings for members", () => {
    expect(labels("member")).toEqual(expect.arrayContaining(["ค้นหาเทรนเนอร์", "การจองของฉัน"]));

    for (const role of [null, "trainer", "admin"] as const) {
      expect(labels(role)).not.toContain("ค้นหาเทรนเนอร์");
      expect(labels(role)).not.toContain("การจองของฉัน");
    }
  });

  it("gives every signed-in role its own workspace destination", () => {
    expect(navigationFor("member")).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/member", label: "การจองของฉัน" }),
    ]));
    expect(navigationFor("trainer")).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/trainer", label: "พื้นที่เทรนเนอร์" }),
    ]));
    expect(navigationFor("admin")).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/admin", label: "พื้นที่ผู้ดูแลระบบ" }),
    ]));
  });

  it("adds the shared profile destination only for members and trainers", () => {
    expect(navigationFor("member")).toContainEqual(expect.objectContaining({
      href: "/profile", label: "โปรไฟล์", icon: "profile",
    }));
    expect(navigationFor("trainer")).toContainEqual(expect.objectContaining({
      href: "/profile", label: "โปรไฟล์", icon: "profile",
    }));
    expect(navigationFor("admin")).not.toContainEqual(expect.objectContaining({ href: "/profile" }));
  });
});
