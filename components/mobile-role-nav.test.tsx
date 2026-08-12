import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { MobileRoleNav } from "@/components/mobile-role-nav";
import type { AuthenticatedUser } from "@/lib/types";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));
vi.mocked(usePathname).mockReturnValue("/notifications");

const member: AuthenticatedUser = {
  id: 1,
  email: "member@example.test",
  displayName: "สมาชิกหนึ่ง",
  role: "member",
  status: "active",
};

describe("MobileRoleNav notification badge", () => {
  it("shows the full accessible unread count and a compact visible count", () => {
    render(<MobileRoleNav user={member} notificationUnreadCount={3} />);

    const link = screen.getByRole("link", { name: "การแจ้งเตือน" });
    expect(link).toHaveAttribute("href", "/notifications");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(within(link).getByText("3")).toBeInTheDocument();
    expect(within(link).getByText("มีการแจ้งเตือนที่ยังไม่ได้อ่าน 3 รายการ")).toHaveClass("sr-only");
  });

  it("caps only the visible count", () => {
    render(<MobileRoleNav user={member} notificationUnreadCount={125} />);
    const link = screen.getByRole("link", { name: "การแจ้งเตือน" });

    expect(within(link).getByText("99+")).toBeInTheDocument();
    expect(within(link).getByText("มีการแจ้งเตือนที่ยังไม่ได้อ่าน 125 รายการ")).toHaveClass("sr-only");
  });
});
