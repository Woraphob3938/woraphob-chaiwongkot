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

function expectIconAndText(link: HTMLElement, label: string) {
  expect(within(link).getByText(label)).toBeInTheDocument();
  expect(link.querySelector('.mobile-role-nav__icon[aria-hidden="true"]')).not.toBeNull();
}

describe("MobileRoleNav", () => {
  beforeEach(() => {
    mockedPathname.mockReturnValue("/");
  });

  it("keeps member-only discovery out of guest navigation", () => {
    render(<MobileRoleNav user={null} />);

    const nav = screen.getByRole("navigation", { name: "เมนูหลักบนมือถือ" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(3);
    expect(within(nav).getByRole("link", { name: "หน้าแรก" })).toHaveAttribute("href", "/");
    expect(within(nav).queryByRole("link", { name: "ค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "เข้าสู่ระบบ" })).toHaveAttribute("href", "/login");
    expect(within(nav).getByRole("link", { name: "สมัครสมาชิก" })).toHaveAttribute("href", "/register");
    for (const link of links) expectIconAndText(link, link.textContent ?? "");
  });

  it.each([
    ["member", "/member", "การจองของฉัน", ["หน้าแรก", "ค้นหาเทรนเนอร์", "การจองของฉัน", "แชต"]],
    ["trainer", "/trainer", "พื้นที่เทรนเนอร์", ["หน้าแรก", "พื้นที่เทรนเนอร์", "แชต"]],
    ["admin", "/admin", "พื้นที่แอดมิน", ["หน้าแรก", "พื้นที่แอดมิน"]],
  ] as const)("routes %s users to their role workspace", (role, workspaceHref, workspaceLabel, expectedLabels) => {
    mockedPathname.mockReturnValue(workspaceHref);
    render(<MobileRoleNav user={user(role)} />);

    const nav = screen.getByRole("navigation", { name: "เมนูหลักบนมือถือ" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(expectedLabels.length);
    expect(links.map((link) => link.textContent)).toEqual(expectedLabels);
    expect(within(nav).getByRole("link", { name: "หน้าแรก" })).toHaveAttribute("href", "/");
    expect(within(nav).getByRole("link", { name: workspaceLabel })).toHaveAttribute("href", workspaceHref);
    expect(within(nav).getByRole("link", { name: workspaceLabel })).toHaveAttribute("aria-current", "page");
    if (role !== "admin") expect(within(nav).getByRole("link", { name: "แชต" })).toHaveAttribute("href", "/chat");
    expect(within(nav).queryByRole("link", { name: "สมัครเป็นเทรนเนอร์" })).not.toBeInTheDocument();
    expect(links.length).toBeLessThanOrEqual(4);
    for (const link of links) expectIconAndText(link, link.textContent ?? "");
  });

  it("marks a nested role route as part of its current destination", () => {
    mockedPathname.mockReturnValue("/trainer/apply");
    render(<MobileRoleNav user={user("trainer")} />);

    expect(screen.getByRole("link", { name: "พื้นที่เทรนเนอร์" })).toHaveAttribute("aria-current", "page");
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

  it.each(["trainer", "admin"] as const)("hides member-only navigation from %s", async (role) => {
    const signedInUser = user(role);
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(signedInUser));
    mockedApiRequest.mockResolvedValue(signedInUser);

    render(<SiteHeader />);

    await screen.findByRole("button", { name: `เปิดเมนูบัญชีของ ${signedInUser.displayName}` });
    expect(screen.queryByRole("link", { name: "ค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "การจองของฉัน" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เปิดค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
  });

  it("hides trainer discovery controls from guests", () => {
    render(<SiteHeader />);

    expect(screen.queryByRole("link", { name: "ค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เปิดค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
  });

  it("opens the global search dialog from the member header control", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);
    const showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });

    render(<SiteHeader />);
    fireEvent.click(await screen.findByRole("button", { name: "เปิดค้นหาเทรนเนอร์" }));

    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  });

  it("keeps the global search dialog available to members from the desktop keyboard shortcut", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);
    const showModal = vi.fn(function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: showModal,
    });

    render(<SiteHeader />);
    await screen.findByRole("button", { name: "เปิดค้นหาเทรนเนอร์" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  });
});
