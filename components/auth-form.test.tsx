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
    fireEvent.click(screen.getByRole("radio", { name: role === "trainer" ? "เทรนเนอร์ ยื่นเอกสารและเปิดรับสอน" : "สมาชิกทั่วไป ค้นหาและจองเทรนเนอร์" }));
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

  it("honours the requested destination even when a session is already stored", async () => {
    const navigate = vi.fn();
    localStorage.setItem("fitconnect_token", "stale-token");
    localStorage.setItem("fitconnect_user", JSON.stringify({ ...trainerUser, role: "member" }));

    render(<AuthForm mode="login" navigate={navigate} redirectTo="/booking?trainer=demo-trainer-a&slot=101" />);

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/booking?trainer=demo-trainer-a&slot=101"));
    // It must not also run the workspace check that would move the visitor away.
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("applies the requested destination to a trainer as well, not only a member", async () => {
    const navigate = vi.fn();
    vi.mocked(apiRequest).mockResolvedValue({ token: "trainer-token", user: trainerUser });
    vi.mocked(authenticatedRequest).mockResolvedValue(pendingWorkspace);

    render(<AuthForm mode="login" navigate={navigate} redirectTo="/trainers/demo-trainer-a" />);
    completeForm("login");

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/trainers/demo-trainer-a"));
    // The role still decides the fallback, so the workspace is still consulted.
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/trainer/me");
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

  it("does not offer the trainer status retry on the register form", async () => {
    const navigate = vi.fn();
    localStorage.setItem("fitconnect_token", "stale-token");
    localStorage.setItem("fitconnect_user", JSON.stringify(trainerUser));
    vi.mocked(apiRequest).mockRejectedValue(new Error("สมัครไม่สำเร็จ"));

    render(<AuthForm mode="register" navigate={navigate} />);
    completeForm("register");

    expect(await screen.findByRole("alert")).toHaveTextContent("สมัครไม่สำเร็จ");
    expect(screen.queryByRole("button", { name: "ตรวจสถานะอีกครั้ง" })).not.toBeInTheDocument();
    // A stored session must not move someone away from a form they opened.
    expect(navigate).not.toHaveBeenCalled();
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

  it("gives the two password toggles distinct accessible names", () => {
    render(<AuthForm mode="register" />);

    expect(screen.getByRole("button", { name: "แสดงรหัสผ่าน" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แสดงรหัสผ่านยืนยัน" })).toBeInTheDocument();
  });

  it("reports a mismatch in Thai without calling the API", async () => {
    render(<AuthForm mode="register" />);
    fireEvent.change(screen.getByLabelText("ชื่อที่ใช้ในระบบ"), { target: { value: "สมาชิกทดสอบ" } });
    fireEvent.change(screen.getByLabelText("อีเมล"), { target: { value: "member@fitconnect.test" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่าน"), { target: { value: "differentPassword" } });
    fireEvent.submit(screen.getByRole("button", { name: "สร้างบัญชี" }).closest("form")!);

    expect(await screen.findByText("รหัสผ่านทั้งสองช่องไม่ตรงกัน")).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("blocks an invalid email and a short password before sending", async () => {
    render(<AuthForm mode="register" />);
    fireEvent.change(screen.getByLabelText("ชื่อที่ใช้ในระบบ"), { target: { value: "สมาชิกทดสอบ" } });
    fireEvent.change(screen.getByLabelText("อีเมล"), { target: { value: "not-an-email" } });
    fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("ยืนยันรหัสผ่าน"), { target: { value: "short" } });
    fireEvent.submit(screen.getByRole("button", { name: "สร้างบัญชี" }).closest("form")!);

    expect(await screen.findByText(/กรุณากรอกอีเมลให้ถูกต้อง/)).toBeInTheDocument();
    expect(screen.getByText(/รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร/)).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it("states how many characters the password still needs while typing", () => {
    render(<AuthForm mode="register" />);

    expect(screen.getByText("ความยาวอย่างน้อย 8 ตัวอักษร")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: "abc" } });
    expect(screen.getByText("อีก 5 ตัวอักษรจะครบ 8 ตัวอักษร")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: "abcdefgh" } });
    expect(screen.getByText("ความยาวอย่างน้อย 8 ตัวอักษร")).toBeInTheDocument();
  });

  it("explains the review step only while the trainer role is chosen", () => {
    render(<AuthForm mode="register" />);

    expect(screen.queryByText(/ยื่นใบสมัครกับเอกสาร PDF/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "เทรนเนอร์ ยื่นเอกสารและเปิดรับสอน" }));
    expect(screen.getByText(/ยื่นใบสมัครกับเอกสาร PDF/)).toBeInTheDocument();
  });

  it("prefills and focuses the address handed back by a password reset", () => {
    render(<AuthForm mode="login" initialEmail="member@fitconnect.test" />);

    const email = screen.getByLabelText("อีเมล");
    expect(email).toHaveValue("member@fitconnect.test");
    expect(email).toHaveFocus();
  });

  it("selects a role through one labelled radio group", () => {
    render(<AuthForm mode="register" />);
    const member = screen.getByRole("radio", { name: "สมาชิกทั่วไป ค้นหาและจองเทรนเนอร์" });
    const trainer = screen.getByRole("radio", { name: "เทรนเนอร์ ยื่นเอกสารและเปิดรับสอน" });

    expect(member).toHaveAttribute("aria-checked", "true");
    expect(trainer).toHaveAttribute("aria-checked", "false");
    fireEvent.click(trainer);
    expect(trainer).toHaveAttribute("aria-checked", "true");
    expect(member).toHaveAttribute("aria-checked", "false");
    // The legend names the group and nothing else carries that name, so the
    // choice is exposed exactly once.
    expect(screen.getByRole("group", { name: "ฉันต้องการใช้งานในฐานะ" })).toBeInTheDocument();
  });
});
