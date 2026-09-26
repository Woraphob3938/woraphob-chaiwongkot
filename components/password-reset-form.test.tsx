import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordResetForm } from "@/components/password-reset-form";
import { ApiError, apiRequest } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      public readonly status = 500,
      public readonly code = "REQUEST_FAILED",
      public readonly fields: Record<string, string> = {},
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return { ApiError: MockApiError, apiRequest: vi.fn() };
});

describe("PasswordResetForm", () => {
  beforeEach(() => {
    push.mockReset();
    vi.mocked(apiRequest).mockReset();
  });

  it("asks for a code and moves on without revealing whether the account exists", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      message: "หากอีเมลนี้มีบัญชีอยู่ ระบบได้ส่งรหัสตั้งรหัสผ่านใหม่ให้แล้ว",
    });
    render(<PasswordResetForm />);

    fireEvent.change(screen.getByLabelText("อีเมลที่ใช้สมัคร"), { target: { value: "member@fitconnect.local" } });
    fireEvent.click(screen.getByRole("button", { name: /ส่งรหัสตั้งรหัสผ่านใหม่/ }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/v1/auth/forgot-password", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "member@fitconnect.local" }),
    })));
    expect(await screen.findByText(/หากอีเมลนี้มีบัญชีอยู่/)).toBeInTheDocument();
    expect(screen.getByLabelText("รหัสยืนยัน")).toBeInTheDocument();
  });

  it("validates the code, the length and the confirmation before sending", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ message: "ok" });
    render(<PasswordResetForm initialEmail="member@fitconnect.local" />);
    fireEvent.click(screen.getByRole("button", { name: /ส่งรหัสตั้งรหัสผ่านใหม่/ }));
    await screen.findByLabelText("รหัสยืนยัน");

    fireEvent.change(screen.getByLabelText("รหัสยืนยัน"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่านใหม่"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), { target: { value: "different" } });
    fireEvent.click(screen.getByRole("button", { name: /ตั้งรหัสผ่านใหม่/ }));

    expect(await screen.findByText("กรอกรหัส 6 หลักจากอีเมล")).toBeInTheDocument();
    expect(screen.getByText("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")).toBeInTheDocument();
    expect(screen.getByText("รหัสผ่านทั้งสองช่องไม่ตรงกัน")).toBeInTheDocument();
    expect(vi.mocked(apiRequest).mock.calls.some(([path]) => path === "/v1/auth/reset-password")).toBe(false);
  });

  it("strips formatting from the code and returns to sign-in when the reset succeeds", async () => {
    vi.mocked(apiRequest).mockImplementation((path: string) => Promise.resolve(
      path === "/v1/auth/forgot-password" ? { message: "ok" } : { reset: true },
    ) as never);
    render(<PasswordResetForm initialEmail="member@fitconnect.local" />);
    fireEvent.click(screen.getByRole("button", { name: /ส่งรหัสตั้งรหัสผ่านใหม่/ }));
    await screen.findByLabelText("รหัสยืนยัน");

    fireEvent.change(screen.getByLabelText("รหัสยืนยัน"), { target: { value: "12-34-56" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่านใหม่"), { target: { value: "brand-new-password" } });
    fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), { target: { value: "brand-new-password" } });
    fireEvent.click(screen.getByRole("button", { name: /ตั้งรหัสผ่านใหม่/ }));

    await waitFor(() => expect(apiRequest).toHaveBeenCalledWith("/v1/auth/reset-password", expect.objectContaining({
      body: JSON.stringify({
        email: "member@fitconnect.local",
        code: "123456",
        newPassword: "brand-new-password",
      }),
    })));
    await waitFor(() => expect(push).toHaveBeenCalledWith(
      "/login?reset=done&email=member%40fitconnect.local",
    ));
  });

  it("shows the server message when the code is rejected", async () => {
    vi.mocked(apiRequest).mockImplementation((path: string) => {
      if (path === "/v1/auth/forgot-password") return Promise.resolve({ message: "ok" }) as never;
      return Promise.reject(new ApiError(
        "รหัสยืนยันไม่ถูกต้องหรือหมดอายุ",
        422,
        "INVALID_RESET_CODE",
        { code: "ขอรหัสใหม่แล้วลองอีกครั้ง" },
      )) as never;
    });
    render(<PasswordResetForm initialEmail="member@fitconnect.local" />);
    fireEvent.click(screen.getByRole("button", { name: /ส่งรหัสตั้งรหัสผ่านใหม่/ }));
    await screen.findByLabelText("รหัสยืนยัน");

    fireEvent.change(screen.getByLabelText("รหัสยืนยัน"), { target: { value: "000000" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่านใหม่"), { target: { value: "brand-new-password" } });
    fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), { target: { value: "brand-new-password" } });
    fireEvent.click(screen.getByRole("button", { name: /ตั้งรหัสผ่านใหม่/ }));

    expect(await screen.findByText("รหัสยืนยันไม่ถูกต้องหรือหมดอายุ")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
