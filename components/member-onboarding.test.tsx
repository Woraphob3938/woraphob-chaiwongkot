import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberOnboarding } from "@/components/member-onboarding";
import { authenticatedRequest } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ authenticatedRequest: vi.fn() }));

const profile = {
  role: "member",
  user: { displayName: "มิ้นท์" },
  member: { firstName: "มิ้นท์", lastName: "", nameFromDisplayName: true, phone: "", experienceLevel: "", weight: null, height: null, fitnessGoal: "" },
};

describe("MemberOnboarding", () => {
  beforeEach(() => {
    push.mockReset();
    vi.mocked(authenticatedRequest).mockReset();
    vi.mocked(authenticatedRequest).mockResolvedValue(profile);
  });

  it("asks for a name before the goal step, then saves and continues", async () => {
    render(<MemberOnboarding next="/booking?trainer=a" />);
    const next = await screen.findByRole("button", { name: /ถัดไป/ });
    await waitFor(() => expect(next).toBeEnabled());

    fireEvent.click(next);
    expect(await screen.findByText("กรุณากรอกชื่อ")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "มิ้นท์" } });
    fireEvent.change(screen.getByLabelText("นามสกุล"), { target: { value: "ใจดี" } });
    fireEvent.click(next);
    fireEvent.click(screen.getByRole("button", { name: "ลดน้ำหนัก" }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกและเริ่มหาเทรนเนอร์" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/booking?trainer=a"));
    const [, init] = vi.mocked(authenticatedRequest).mock.calls.find(([, options]) => options?.method === "PATCH") ?? [];
    expect(JSON.parse(String(init?.body))).toMatchObject({ firstName: "มิ้นท์", lastName: "ใจดี", fitnessGoal: "ลดน้ำหนัก" });
  });

  it("lets the member skip, and never follows an outside link", async () => {
    render(<MemberOnboarding next="//evil.example" />);
    expect(await screen.findByRole("link", { name: "ข้ามไปก่อน" })).toHaveAttribute("href", "/trainers");
  });
});
