import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthForm } from "@/components/auth-form";
import { apiRequest, authenticatedRequest } from "@/lib/api";
import type { AuthenticatedUser, TrainerWorkspace } from "@/lib/types";

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  authenticatedRequest: vi.fn(),
}));

const trainerUser: AuthenticatedUser = {
  id: 9,
  email: "trainer@fitconnect.test",
  displayName: "เทรนเนอร์ทดสอบ",
  role: "trainer",
  status: "active",
};

const pendingWorkspace: TrainerWorkspace = {
  profile: {
    id: 9,
    slug: "trainer-test",
    displayName: trainerUser.displayName,
    approvalStatus: "pending",
    approvalNote: null,
  },
  certificates: [],
  slots: [],
};

function completeForm(mode: "login" | "register", role: "member" | "trainer" = "trainer") {
  if (mode === "register") {
    fireEvent.change(screen.getByLabelText("ชื่อที่ใช้ในระบบ"), { target: { value: trainerUser.displayName } });
    fireEvent.change(screen.getByLabelText("ฉันต้องการใช้งานในฐานะ"), { target: { value: role } });
    const confirmInput = screen.queryByLabelText("ยืนยันรหัสผ่าน");
    if (confirmInput) {
      fireEvent.change(confirmInput, { target: { value: "password123" } });
    }
  }
  fireEvent.change(screen.getByLabelText("อีเมล"), { target: { value: trainerUser.email } });
  fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: "password123" } });
  fireEvent.submit(screen.getByRole("button", { name: mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี" }).closest("form")!);
}

describe("AuthForm trainer onboarding and enhanced UX", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(apiRequest).mockReset();
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("redirects an existing member session without showing the login flow again", async () => {
    const navigate = vi.fn();
    const member = { ...trainerUser, role: "member" as const };
    localStorage.setItem("fitconnect_token", "member-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(member));

    render(<AuthForm mode="login" navigate={navigate} />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/member"));
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("continues a newly registered trainer to professional profile setup", async () => {
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockResolvedValue({ token: "trainer-token", user: trainerUser });
    vi.mocked(authenticatedRequest).mockResolvedValue({ profile: null, certificates: [], slots: [] });

    render(<AuthForm mode="register" navigate={navigate} />);
    completeForm("register");

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/trainer/apply"));
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/trainer/me");
    expect(localStorage.getItem("fitconnect_token")).toBe("trainer-token");
  });

  it("takes a returning trainer with a saved application to the workspace", async () => {
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockResolvedValue({ token: "trainer-token", user: trainerUser });
    vi.mocked(authenticatedRequest).mockResolvedValue(pendingWorkspace);

    render(<AuthForm mode="login" navigate={navigate} />);
    completeForm("login");

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/trainer"));
  });

  it("retries only the trainer status lookup without repeating authentication", async () => {
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockResolvedValue({ token: "trainer-token", user: trainerUser });
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new Error("ตรวจสถานะเทรนเนอร์ไม่สำเร็จ"))
      .mockResolvedValueOnce({ profile: null, certificates: [], slots: [] });

    render(<AuthForm mode="login" navigate={navigate} />);
    completeForm("login");

    expect(await screen.findByRole("alert")).toHaveTextContent("ตรวจสถานะเทรนเนอร์ไม่สำเร็จ");
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสถานะอีกครั้ง" }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/trainer/apply"));
    expect(apiRequest).toHaveBeenCalledTimes(1);
    expect(authenticatedRequest).toHaveBeenCalledTimes(2);
  });

  it("toggles password visibility when eye toggle button is clicked", () => {
    render(<AuthForm mode="login" />);
    const passwordInput = screen.getByLabelText("รหัสผ่าน");
    const toggleButton = screen.getByRole("button", { name: "แสดงรหัสผ่าน" });

    expect(passwordInput).toHaveAttribute("type", "password");
    fireEvent.click(toggleButton);
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(toggleButton).toHaveAttribute("aria-label", "ซ่อนรหัสผ่าน");
  });

  it("validates password mismatch on register submission", async () => {
    render(<AuthForm mode="register" />);
    fireEvent.change(screen.getByLabelText("ชื่อที่ใช้ในระบบ"), { target: { value: "สมาชิกทดสอบ" } });
    fireEvent.change(screen.getByLabelText("อีเมล"), { target: { value: "member@fitconnect.test" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่าน"), { target: { value: "differentPassword" } });
    fireEvent.submit(screen.getByRole("button", { name: "สร้างบัญชี" }).closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน");
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("updates role when role card is clicked", () => {
    render(<AuthForm mode="register" />);
    const trainerCard = screen.getByRole("button", { name: "เทรนเนอร์ เปิดรับสอนและสร้างโปรไฟล์" });
    const select = screen.getByLabelText("ฉันต้องการใช้งานในฐานะ") as HTMLSelectElement;

    expect(select.value).toBe("member");
    fireEvent.click(trainerCard);
    expect(select.value).toBe("trainer");
  });
});

