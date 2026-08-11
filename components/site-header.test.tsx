import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePathname, useRouter } from "next/navigation";
import { apiRequest } from "@/lib/api";
import { MobileRoleNav } from "@/components/mobile-role-nav";
import { SiteHeader } from "@/components/site-header";
import type { AuthenticatedUser, UserRole } from "@/lib/types";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiRequest: vi.fn() };
});

const mockedPathname = vi.mocked(usePathname);
const push = vi.fn();
vi.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
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
    ["member", "/member", "การจองของฉัน", ["ค้นหาเทรนเนอร์", "การจองของฉัน", "แชต", "โปรไฟล์"]],
    ["trainer", "/trainer", "พื้นที่เทรนเนอร์", ["พื้นที่เทรนเนอร์", "แชต", "โปรไฟล์"]],
    ["admin", "/admin", "พื้นที่แอดมิน", ["พื้นที่แอดมิน"]],
  ] as const)("routes %s users to their role workspace", (role, workspaceHref, workspaceLabel, expectedLabels) => {
    mockedPathname.mockReturnValue(workspaceHref);
    render(<MobileRoleNav user={user(role)} />);

    const nav = screen.getByRole("navigation", { name: "เมนูหลักบนมือถือ" });
    const links = within(nav).getAllByRole("link");

    expect(links).toHaveLength(expectedLabels.length);
    expect(links.map((link) => link.textContent)).toEqual(expectedLabels);
    expect(within(nav).queryByRole("link", { name: "หน้าแรก" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("link", { name: "หน้าแรก" })).not.toBeInTheDocument();
  });
});

describe("SiteHeader", () => {
  beforeEach(() => {
    localStorage.clear();
    mockedPathname.mockReturnValue("/");
    mockedApiRequest.mockReset();
    push.mockReset();
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
    expect(screen.queryByRole("link", { name: /พื้นที่ใช้งานของฉัน/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์" })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: /ออกจากระบบ/ })).toBeInTheDocument();
    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalled());
  });

  it.each([
    ["member", "/member", ["ค้นหาเทรนเนอร์", "การจองของฉัน", "แชต", "โปรไฟล์"]],
    ["trainer", "/trainer", ["พื้นที่เทรนเนอร์", "แชต", "โปรไฟล์"]],
    ["admin", "/admin", ["พื้นที่แอดมิน"]],
  ] as const)("moves %s navigation into the authenticated side rail", async (role, pathname, labels) => {
    const signedInUser = user(role);
    mockedPathname.mockReturnValue(pathname);
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(signedInUser));
    mockedApiRequest.mockResolvedValue(signedInUser);

    render(<SiteHeader />);

    const nav = await screen.findByRole("navigation", { name: "เมนูหลักด้านข้าง" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(labels);
    expect(within(nav).queryByRole("link", { name: "หน้าแรก" })).not.toBeInTheDocument();
    expect(links.find((link) => link.getAttribute("href") === pathname)).toHaveAttribute("aria-current", "page");
    for (const link of links) {
      expect(link.querySelector('.app-sidebar__nav-icon[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("keeps guest actions in the top header instead of the authenticated side rail", () => {
    render(<SiteHeader />);

    expect(screen.queryByRole("navigation", { name: "เมนูหลักด้านข้าง" })).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toHaveClass("site-header");
  });

  it("server-renders a stable sidebar shell while the stored session hydrates", () => {
    const markup = renderToStaticMarkup(<SiteHeader />);
    const document = new DOMParser().parseFromString(markup, "text/html");

    expect(document.querySelector(".session-sidebar-placeholder")).not.toBeNull();
    expect(document.querySelector(".site-header--pending")).not.toBeNull();
  });

  it("collapses and restores the authenticated side rail without removing its destinations", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);

    render(<SiteHeader />);

    const sidebar = await screen.findByRole("complementary", { name: "แถบนำทาง FitConnect" });
    fireEvent.click(within(sidebar).getByRole("button", { name: "ย่อแถบเมนู" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(within(sidebar).getByRole("button", { name: "ขยายแถบเมนู" })).toHaveAttribute("aria-expanded", "false");
    expect(within(sidebar).getByRole("link", { name: "การจองของฉัน" })).toHaveAttribute("href", "/member");

    fireEvent.click(within(sidebar).getByRole("button", { name: "ขยายแถบเมนู" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(within(sidebar).getByRole("button", { name: "ย่อแถบเมนู" })).toHaveAttribute("aria-expanded", "true");
  });

  it("returns the side rail to its expanded state after a page refresh", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);

    render(<SiteHeader />);

    const sidebar = await screen.findByRole("complementary", { name: "แถบนำทาง FitConnect" });
    fireEvent.click(within(sidebar).getByRole("button", { name: "ย่อแถบเมนู" }));
    expect(sidebar).toHaveAttribute("data-collapsed", "true");

    fireEvent(window, new Event("pageshow"));

    expect(sidebar).toHaveAttribute("data-collapsed", "false");
    expect(within(sidebar).getByRole("button", { name: "ย่อแถบเมนู" })).toHaveAttribute("aria-expanded", "true");
  });

  it("revokes the server session before signing out locally", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);

    render(<SiteHeader />);
    fireEvent.click(await screen.findByRole("button", { name: `เปิดเมนูบัญชีของ ${member.displayName}` }));
    fireEvent.click(screen.getByRole("button", { name: /ออกจากระบบ/ }));

    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalledWith("/v1/auth/logout", {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
    }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("fitconnect_token")).toBeNull();
  });

  it("still clears the browser session when server logout is unavailable", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValueOnce(member).mockRejectedValueOnce(new Error("offline"));

    render(<SiteHeader />);
    fireEvent.click(await screen.findByRole("button", { name: `เปิดเมนูบัญชีของ ${member.displayName}` }));
    fireEvent.click(screen.getByRole("button", { name: /ออกจากระบบ/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(localStorage.getItem("fitconnect_token")).toBeNull();
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

  it("removes the quick-search control from the side rail", async () => {
    const member = user("member");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);

    render(<SiteHeader />);
    await screen.findByRole("complementary", { name: "แถบนำทาง FitConnect" });

    expect(screen.queryByText("ค้นหาแบบด่วน")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เปิดค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
  });

  it("keeps only the page search on the trainer discovery route", async () => {
    const member = user("member");
    mockedPathname.mockReturnValue("/trainers");
    localStorage.setItem("fitconnect_token", "test-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));
    mockedApiRequest.mockResolvedValue(member);

    render(<SiteHeader />);

    await screen.findByRole("button", { name: `เปิดเมนูบัญชีของ ${member.displayName}` });
    expect(screen.queryByRole("button", { name: "เปิดค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
    expect(screen.queryByText("ค้นหาความเชี่ยวชาญหรือชื่อเทรนเนอร์")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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
    await screen.findByRole("complementary", { name: "แถบนำทาง FitConnect" });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });

    expect(showModal).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog")).toHaveAttribute("open");
    delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal;
  });
});
