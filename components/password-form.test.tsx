import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordForm, passwordFieldErrors } from "@/components/password-form";
import { ApiError, authenticatedRequest } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

function fillPasswords(current: string, next: string, confirm: string) {
  fireEvent.change(screen.getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: current } });
  fireEvent.change(screen.getByLabelText("รหัสผ่านใหม่"), { target: { value: next } });
  fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่านใหม่"), { target: { value: confirm } });
}

describe("PasswordForm", () => {
  it("shows the sticky save bar only after a password field changes", () => {
    render(<PasswordForm />);

    expect(screen.queryByRole("region", { name: "การเปลี่ยนแปลงที่ยังไม่บันทึก" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("รหัสผ่านปัจจุบัน"), { target: { value: "old-password" } });

    expect(screen.getByRole("region", { name: "การเปลี่ยนแปลงที่ยังไม่บันทึก" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" })).toBeInTheDocument();
  });

  it("uses the correct password autocomplete fields", () => {
    render(<PasswordForm />);
    expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.getByLabelText("รหัสผ่านใหม่")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("ยืนยันรหัสผ่านใหม่")).toHaveAttribute("autocomplete", "new-password");
  });

  it("blocks a short or mismatched new password locally", () => {
    render(<PasswordForm />);
    fillPasswords("old-password", "short", "different");
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
    expect(screen.getByText("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร")).toBeInTheDocument();
    expect(screen.getByText("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("sends only both passwords once, announces success, and clears the inputs", async () => {
    let resolveSave!: (value: { changed: boolean }) => void;
    vi.mocked(authenticatedRequest).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    render(<PasswordForm />);
    fillPasswords("old-password", "new-password", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนรหัสผ่าน" }));
    fireEvent.click(screen.getByRole("button", { name: "กำลังเปลี่ยนรหัสผ่าน" }));

    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
    });
    resolveSave({ changed: true });
    expect(await screen.findByRole("status")).toHaveTextContent("เปลี่ยนรหัสผ่านแล้ว");
    await waitFor(() => expect(screen.getByLabelText("รหัสผ่านปัจจุบัน")).toHaveValue(""));
    expect(screen.getByLabelText("รหัสผ่านใหม่")).toHaveValue("");
    expect(screen.getByLabelText("ยืนยันรหัสผ่านใหม่")).toHaveValue("");
  });

  it("maps password field errors returned by the API", () => {
    const error = new ApiError("เปลี่ยนรหัสผ่านไม่สำเร็จ", 422, "VALIDATION_FAILED", {
      currentPassword: "รหัสผ่านปัจจุบันไม่ถูกต้อง",
    });
    expect(passwordFieldErrors(error)).toEqual({ currentPassword: "รหัสผ่านปัจจุบันไม่ถูกต้อง" });
  });
});
