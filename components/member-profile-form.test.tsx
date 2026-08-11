import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemberProfileForm, profileFieldErrors } from "@/components/member-profile-form";
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
  member: { firstName: "สมชาย", lastName: "ใจดี", phone: "", fitnessGoal: "", experienceLevel: "", weight: null, height: null },
};

beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

describe("MemberProfileForm", () => {
  it("shows only the approved member fields and sends the exact profile body", async () => {
    const saved = { ...profile, member: { ...profile.member, phone: "0812345678" } };
    vi.mocked(authenticatedRequest).mockResolvedValue(saved);
    const onSaved = vi.fn();
    render(<MemberProfileForm profile={profile} onSaved={onSaved} />);

    expect(screen.getByLabelText("อีเมล")).toHaveAttribute("readonly");
    for (const label of ["ชื่อ", "นามสกุล", "เบอร์โทรศัพท์", "เป้าหมายการออกกำลังกาย", "ระดับประสบการณ์", "น้ำหนัก (กก.)", "ส่วนสูง (ซม.)"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    for (const absent of ["ข้อมูลสุขภาพ", "เพศ", "วันเกิด", "จังหวัด", "สถานที่นัดฝึก"]) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }

    fireEvent.change(screen.getByLabelText("เบอร์โทรศัพท์"), { target: { value: "0812345678" } });
    fireEvent.change(screen.getByLabelText("เป้าหมายการออกกำลังกาย"), { target: { value: "เพิ่มความแข็งแรง" } });
    fireEvent.change(screen.getByLabelText("ระดับประสบการณ์"), { target: { value: "beginner" } });
    fireEvent.change(screen.getByLabelText("น้ำหนัก (กก.)"), { target: { value: "70.5" } });
    fireEvent.change(screen.getByLabelText("ส่วนสูง (ซม.)"), { target: { value: "175" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลสมาชิก" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({
        firstName: "สมชาย", lastName: "ใจดี", phone: "0812345678",
        fitnessGoal: "เพิ่มความแข็งแรง", experienceLevel: "beginner",
        weight: 70.5, height: 175,
      }),
    }));
    expect(onSaved).toHaveBeenCalledWith(saved);
    expect(screen.getByRole("status")).toHaveTextContent("บันทึกข้อมูลสมาชิกแล้ว");
  });

  it("keeps typed values and maps server field errors", () => {
    const apiError = new ApiError(
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
