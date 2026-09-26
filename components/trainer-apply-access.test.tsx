import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerApplyAccess } from "@/components/trainer-apply-access";

vi.mock("@/components/trainer-apply-form", () => ({
  TrainerApplyForm: () => <form aria-label="แบบฟอร์มข้อมูลวิชาชีพ"><input aria-label="ชื่อที่แสดง" /></form>,
}));

function signIn(role: "member" | "trainer" | "admin") {
  localStorage.setItem("fitconnect_token", "test-token");
  localStorage.setItem("fitconnect_user", JSON.stringify({
    id: 1,
    email: `${role}@fitconnect.local`,
    displayName: "ผู้ใช้ทดสอบ",
    role,
  }));
}

describe("TrainerApplyAccess", () => {
  beforeEach(() => localStorage.clear());

  it("refuses to show the professional form to a signed-in member", async () => {
    signIn("member");
    render(<TrainerApplyAccess />);

    expect(await screen.findByRole("heading", { name: "หน้านี้เป็นของบัญชีเทรนเนอร์" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "แบบฟอร์มข้อมูลวิชาชีพ" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ไปที่การฝึกของฉัน" })).toHaveAttribute("href", "/member");
  });

  it("sends an administrator to the administrator surface instead", async () => {
    signIn("admin");
    render(<TrainerApplyAccess />);

    expect(await screen.findByRole("link", { name: "ไปที่พื้นที่ผู้ดูแลระบบ" })).toHaveAttribute("href", "/admin");
    expect(screen.queryByRole("form", { name: "แบบฟอร์มข้อมูลวิชาชีพ" })).not.toBeInTheDocument();
  });

  it("keeps the application form for a trainer", async () => {
    signIn("trainer");
    render(<TrainerApplyAccess />);

    expect(await screen.findByRole("form", { name: "แบบฟอร์มข้อมูลวิชาชีพ" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "หน้านี้เป็นของบัญชีเทรนเนอร์" })).not.toBeInTheDocument();
  });

  it("keeps the application form for a guest", () => {
    render(<TrainerApplyAccess />);

    expect(screen.getByRole("form", { name: "แบบฟอร์มข้อมูลวิชาชีพ" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "กรอกข้อมูลวิชาชีพให้ครบในที่เดียว" })).toBeInTheDocument();
  });
});
