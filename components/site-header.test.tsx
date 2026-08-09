import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePathname } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { MobileRoleNav } from "@/components/mobile-role-nav";
import { SiteHeader } from "@/components/site-header";
import type { AuthenticatedUser, UserRole } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiRequest: vi.fn() };
});

const mockedPathname = vi.mocked(usePathname);
const mockedApiRequest = vi.mocked(apiRequest);

function user(role: UserRole): AuthenticatedUser {
  return {
    id: role === "member" ? 1 : role === "trainer" ? 2 : 3,
    email: `${role}@example.test`,
    displayName: `บัญชี ${role}`,
    role,
    status: "active",
  };
}

describe("MobileRoleNav", () => {
  beforeEach(() => {
    mockedPathname.mockReturnValue("/");
  });

  it("gives guests four direct destinations", () => {
    render(<MobileRoleNav user={null} />);

    const nav = screen.getByRole("navigation", { name: "เมนูหลักบนมือถือ" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(4);
    expect(within(nav).getByRole("link", { name: "หน้าแรก" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: "ค้นหาเทรนเนอร์" })).toHaveAttribute("href", "/trainers");
    expect(within(nav).getByRole("link", { name: "เข้าสู่ระบบ" })).toHaveAttribute("href", "/login");
    expect(within(nav).getByRole("link", { name: "สมัครสมาชิก" })).toHaveAttribute("href", "/register");
  });

  it.each([
    ["member", "/member", "การจอง"],
    ["trainer", "/trainer", "งานของฉัน"],
    ["admin", "/admin", "คิวตรวจ"],
  ] as const)("routes %s users to their role workspace", (role, workspaceHref, workspaceLabel) => {
    mockedPathname.mockReturnValue(workspaceHref);
    render(<MobileRoleNav user={user(role)} />);

    const nav = screen.getByRole("navigation", { name: "เมนูหลักบนมือถือ" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(3);
    expect(within(nav).getByRole("link", { name: "หน้าแรก" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: workspaceLabel })).toHaveAttribute("href", workspaceHref);
    expect(within(nav).getByRole("link", { name: workspaceLabel })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "แชต" })).toHaveAttribute("href", "/chat");
    expect(within(nav).queryByRole("link", { name: "สมัครเป็นเทรนเนอร์" })).not.toBeInTheDocument();
    expect(links.length).toBeLessThanOrEqual(4);
  });

  it("marks a nested role route as part of its current destination", () => {
    mockedPathname.mockReturnValue("/trainer/apply");
    render(<MobileRoleNav user={user("trainer")} />);

    expect(screen.getByRole("link", { name: "งานของฉัน" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "หน้าแรก" })).not.toHaveAttribute("aria-current");
  });
});

describe("SiteHeader", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedPathname.mockReturnValue("/");
    mockedApiRequest.mockReset();
  });

  it("keeps the authenticated account control and role workspace available", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);

    render(<SiteHeader />);

    const accountButton = await screen.findByRole("button", { name: `เปิดเมนูบัญชีของ ${member.displayName}` });
    fireEvent.click(accountButton);

    expect(screen.getByText(member.email)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /พื้นที่ใช้งานของฉัน/ })).toHaveAttribute("href", "/member");
    expect(screen.getByRole("button", { name: /ออกจากระบบ/ })).toBeInTheDocument();
    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalled());
  });

  it("keeps the global search dialog available from the desktop keyboard shortcut", () => {
    const showModal = vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });

    render(<SiteHeader />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  });
});
