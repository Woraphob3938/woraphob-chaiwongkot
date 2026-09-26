import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberProfileForm, profileFieldErrors, validateBirthDate } from "@/components/member-profile-form";
import { ApiError, authenticatedRequest } from "@/lib/api";
import type { MemberAccountProfile } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

const profile: MemberAccountProfile = {
  role: "member",
  user: { displayName: "สมชาย ใจดี", email: "member@example.com" },
  imageUrl: null,
  member: { nameFromDisplayName: false, firstName: "สมชาย", lastName: "ใจดี", phone: "", fitnessGoal: "", experienceLevel: "", weight: null, height: null },
};

beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

describe("MemberProfileForm", () => {
  it("shows the sticky save bar only after profile data changes", () => {
    render(<MemberProfileForm profile={profile} onSaved={vi.fn()} />);

    expect(screen.queryByRole("region", { name: "การเปลี่ยนแปลงที่ยังไม่บันทึก" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "บันทึกข้อมูลสมาชิก" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "0812345678" } });

    expect(screen.getByRole("region", { name: "การเปลี่ยนแปลงที่ยังไม่บันทึก" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" })).toBeInTheDocument();
  });

  it("shows only the approved member fields and sends the exact profile body", async () => {
    const saved = { ...profile, member: { ...profile.member, phone: "0812345678" } };
    vi.mocked(authenticatedRequest).mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<MemberProfileForm profile={profile} onSaved={onSaved} />);

    expect(screen.queryByText("member@example.com")).not.toBeInTheDocument();
    expect(screen.queryByText("ใช้อีเมลนี้เข้าสู่ระบบ เปลี่ยนไม่ได้จากหน้านี้")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "อีเมล" })).not.toBeInTheDocument();
    for (const label of ["ชื่อ", "นามสกุล", "เบอร์โทรศัพท์", "วันเกิด", "เป้าหมายการออกกำลังกาย", "ระดับประสบการณ์", "น้ำหนัก (กก.)", "ส่วนสูง (ซม.)"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const absent of ["ข้อมูลสุขภาพ", "เพศ", "จังหวัด", "สถานที่นัดฝึก"]) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
    const height = screen.getByLabelText("ส่วนสูง (ซม.)");
    const goal = screen.getByLabelText("เป้าหมายการออกกำลังกาย");
    expect(height.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "0812345678" } });
    fireEvent.change(screen.getByLabelText("วันเกิด"), { target: { value: "1998-04-12" } });
    fireEvent.change(screen.getByLabelText("เป้าหมายการออกกำลังกาย"), { target: { value: "เพิ่มความแข็งแรง" } });
    fireEvent.change(screen.getByLabelText("ระดับประสบการณ์"), { target: { value: "beginner" } });
    fireEvent.change(screen.getByLabelText("น้ำหนัก (กก.)"), { target: { value: "70.5" } });
    fireEvent.change(screen.getByLabelText("ส่วนสูง (ซม.)"), { target: { value: "175" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({
        firstName: "สมชาย", lastName: "ใจดี", phone: "0812345678", birthDate: "1998-04-12",
        fitnessGoal: "เพิ่มความแข็งแรง", experienceLevel: "beginner",
        weight: 70.5, height: 175,
      }),
    }));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(screen.getByRole("status")).toHaveTextContent("บันทึกข้อมูลสมาชิกแล้ว");
  });

  it("sends a cleared birth date as null and keeps the field optional", async () => {
    const saved = { ...profile, member: { ...profile.member, phone: "0812345678" } };
    vi.mocked(authenticatedRequest).mockResolvedValue(saved);
    render(<MemberProfileForm profile={profile} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "0812345678" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledTimes(1));
    const body = JSON.parse(vi.mocked(authenticatedRequest).mock.calls[0][1]?.body as string);
    expect(body.birthDate).toBeNull();
  });

  it("rejects impossible birth dates before the request", () => {
    render(<MemberProfileForm profile={profile} onSaved={vi.fn()} />);
    const birthDate = screen.getByLabelText("วันเกิด");

    fireEvent.change(birthDate, { target: { value: "2100-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" }));
    expect(screen.getByText("วันเกิดต้องเป็นวันที่ผ่านมาแล้ว")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();

    fireEvent.change(birthDate, { target: { value: "1800-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" }));
    expect(screen.getByText("อายุต้องอยู่ระหว่าง 5 ถึง 120 ปี")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();

    expect(validateBirthDate("")).toBe("");
    expect(validateBirthDate("2026-02-30")).toBe("กรอกวันเกิดให้ถูกต้อง");
    expect(validateBirthDate("1998-04-12")).toBe("");
  });

  it("prefills the stored birth date without marking the form dirty", () => {
    const stored = { ...profile, member: { ...profile.member, birthDate: "1998-04-12" } };
    render(<MemberProfileForm profile={stored} onSaved={vi.fn()} />);

    expect(screen.getByLabelText("วันเกิด")).toHaveValue("1998-04-12");
    expect(screen.queryByRole("button", { name: "บันทึกข้อมูลสมาชิก" })).not.toBeInTheDocument();
  });

  it("shows the display-name fallback as a hint, not as saved input", () => {
    const legacy: MemberAccountProfile = {
      ...profile,
      user: { displayName: "สมาชิกสาธิต", email: "legacy@example.com" },
      member: { ...profile.member, nameFromDisplayName: true, firstName: "สมาชิกสาธิต", lastName: "" },
    };
    render(<MemberProfileForm profile={legacy} onSaved={vi.fn()} />);

    const firstName = screen.getByLabelText("ชื่อ");
    expect(firstName).toHaveValue("");
    expect(firstName).toHaveAttribute("placeholder", "สมาชิกสาธิต");
    expect(document.getElementById("member-name-hint")).toHaveTextContent("ยังไม่มีชื่อที่บันทึกไว้");
    expect(firstName).toHaveAccessibleDescription(/ยังไม่มีชื่อที่บันทึกไว้/);
    // Nothing looks edited, so no save bar until the member types something.
    expect(screen.queryByRole("button", { name: "บันทึกข้อมูลสมาชิก" })).not.toBeInTheDocument();
  });

  it("says that saving the name replaces the display name", () => {
    render(<MemberProfileForm profile={profile} onSaved={vi.fn()} />);

    const heading = screen.getByRole("heading", { name: "รายละเอียดสมาชิก" });
    expect(heading.parentElement).toHaveTextContent("จะกลายเป็นชื่อที่แสดงในระบบ");
    expect(heading.parentElement).toHaveTextContent("สมชาย ใจดี");
  });

  it("keeps typed values and maps server field errors", () => {    const apiError = new ApiError(
      "ข้อมูลโปรไฟล์ไม่ถูกต้อง", 422, "VALIDATION_FAILED", { phone: "กรอกเบอร์โทรศัพท์ให้ถูกต้อง" },
    );
    expect(profileFieldErrors(apiError)).toEqual({ phone: "กรอกเบอร์โทรศัพท์ให้ถูกต้อง" });
    render(<MemberProfileForm profile={profile} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "abc" } });
    expect(screen.getByLabelText("เบอร์โทรศัพท์")).toHaveValue("abc");
  });

  it("blocks invalid measurements and duplicate pending submissions", async () => {
    render(<MemberProfileForm profile={profile} onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("น้ำหนัก (กก.)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" }));
    expect(screen.getByText("น้ำหนักต้องมากกว่าศูนย์")).toBeInTheDocument();
    expect(authenticatedRequest).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("น้ำหนัก (กก.)"), { target: { value: "70" } });
    let resolveSave!: (value: MemberAccountProfile) => void;
    vi.mocked(authenticatedRequest).mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" }));
    fireEvent.click(screen.getByRole("button", { name: "กำลังบันทึก" }));
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
    resolveSave(profile);
    await screen.findByText("บันทึกข้อมูลสมาชิกแล้ว");
  });
});
