import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileIdentity } from "@/components/profile-identity";
import { authenticatedRequest } from "@/lib/api";
import type { MemberAccountProfile } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

const profile: MemberAccountProfile = {
  role: "member",
  user: { displayName: "สมชาย ใจดี", email: "member@example.com" },
  imageUrl: "/v1/profile-images/member/7",
  member: {
    nameFromDisplayName: false,
    firstName: "สมชาย", lastName: "ใจดี", phone: "", fitnessGoal: "",
    experienceLevel: "", weight: null, height: null,
  },
};

beforeEach(() => {
  vi.mocked(authenticatedRequest).mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:profile-preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

function openImageManager() {
  fireEvent.click(screen.getByRole("button", { name: "จัดการรูปโปรไฟล์" }));
}

describe("ProfileIdentity", () => {
  it("opens profile photo management from the avatar instead of showing every action inline", () => {
    render(<ProfileIdentity profile={profile} onProfileChange={vi.fn()} />);

    expect(screen.queryByLabelText("เลือกรูปโปรไฟล์")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "จัดการรูปโปรไฟล์" }));

    expect(screen.getByRole("dialog", { name: "จัดการรูปโปรไฟล์" })).toBeInTheDocument();
    expect(screen.getByLabelText("เลือกรูปโปรไฟล์")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบรูปโปรไฟล์" })).toBeInTheDocument();
  });

  it("shows the account identity and accepts only supported image formats", () => {
    render(<ProfileIdentity profile={profile} onProfileChange={vi.fn()} />);

    expect(screen.getByRole("navigation", { name: "เส้นทางโปรไฟล์" })).toHaveTextContent("บัญชีของฉัน/โปรไฟล์");
    expect(screen.getByRole("link", { name: "บัญชีของฉัน" })).toHaveAttribute("href", "/member");
    expect(screen.getByRole("heading", { name: "สมชาย ใจดี" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "รูปโปรไฟล์ของ สมชาย ใจดี" })).toHaveAttribute(
      "src", expect.stringContaining("/v1/profile-images/member/7"),
    );
    expect(screen.getByText("member@example.com")).toBeInTheDocument();
    expect(screen.getByText("สมาชิก")).toBeInTheDocument();
    openImageManager();
    expect(screen.getByLabelText("เลือกรูปโปรไฟล์")).toHaveAttribute(
      "accept", "image/jpeg,image/png,image/webp",
    );
  });

  it("rejects files above 5 MB before making a request", () => {
    render(<ProfileIdentity profile={profile} onProfileChange={vi.fn()} />);
    openImageManager();
    const oversized = new File([new Uint8Array((5 * 1024 * 1024) + 1)], "large.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("เลือกรูปโปรไฟล์"), { target: { files: [oversized] } });

    expect(screen.getByRole("alert")).toHaveTextContent("ไม่เกิน 5 MB");
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("uploads the image field, disables the action while pending, then publishes the new image", async () => {
    let resolveUpload!: (value: { imageUrl: string }) => void;
    vi.mocked(authenticatedRequest).mockReturnValue(new Promise((resolve) => { resolveUpload = resolve; }));
    const onProfileChange = vi.fn();
    render(<ProfileIdentity profile={profile} onProfileChange={onProfileChange} />);
    openImageManager();
    const image = new File(["image"], "new.webp", { type: "image/webp" });

    fireEvent.change(screen.getByLabelText("เลือกรูปโปรไฟล์"), { target: { files: [image] } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรูปใหม่" }));

    expect(screen.getByRole("button", { name: "กำลังอัปโหลด" })).toBeDisabled();
    const [, request] = vi.mocked(authenticatedRequest).mock.calls[0];
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile/image", expect.objectContaining({ method: "POST" }));
    expect((request?.body as FormData).get("image")).toBe(image);

    resolveUpload({ imageUrl: "/v1/profile-images/member/7?updated=1" });
    expect(await screen.findByText("เปลี่ยนรูปโปรไฟล์แล้ว")).toBeInTheDocument();
    expect(onProfileChange).toHaveBeenCalledWith(expect.objectContaining({
      imageUrl: "/v1/profile-images/member/7?updated=1",
    }));
  });

  it("cancels a selected image and returns to the saved profile image", async () => {
    render(<ProfileIdentity profile={profile} onProfileChange={vi.fn()} />);
    openImageManager();
    const image = new File(["image"], "new.webp", { type: "image/webp" });

    fireEvent.change(screen.getByLabelText("เลือกรูปโปรไฟล์"), { target: { files: [image] } });
    expect(screen.getByRole("img", { name: "ตัวอย่างรูปโปรไฟล์ของ สมชาย ใจดี" })).toHaveAttribute(
      "src", expect.stringContaining("blob:profile-preview"),
    );

    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกรูปที่เลือก" }));

    expect(screen.getByRole("img", { name: "ตัวอย่างรูปโปรไฟล์ของ สมชาย ใจดี" })).toHaveAttribute(
      "src", expect.stringContaining("/v1/profile-images/member/7"),
    );
    expect(screen.getByRole("button", { name: "บันทึกรูปใหม่" })).toBeDisabled();
    expect(screen.queryByText("new.webp")).not.toBeInTheDocument();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:profile-preview"));
  });

  it("deletes the saved profile image after confirmation", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue({ imageUrl: null });
    const onProfileChange = vi.fn();
    render(<ProfileIdentity profile={profile} onProfileChange={onProfileChange} />);
    openImageManager();

    fireEvent.click(screen.getByRole("button", { name: "ลบรูปโปรไฟล์" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบรูป" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile/image", {
      method: "DELETE",
    }));
    expect(onProfileChange).toHaveBeenCalledWith(expect.objectContaining({ imageUrl: null }));
    expect(await screen.findByRole("status")).toHaveTextContent("ลบรูปโปรไฟล์แล้ว");
  });

  it("returns to the saved image when uploading fails", async () => {
    vi.mocked(authenticatedRequest).mockRejectedValue(new Error("อัปโหลดไม่สำเร็จ"));
    render(<ProfileIdentity profile={profile} onProfileChange={vi.fn()} />);
    openImageManager();

    fireEvent.change(screen.getByLabelText("เลือกรูปโปรไฟล์"), {
      target: { files: [new File(["image"], "new.png", { type: "image/png" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกรูปใหม่" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("อัปโหลดไม่สำเร็จ");
    await waitFor(() => expect(screen.getByRole("img", { name: "ตัวอย่างรูปโปรไฟล์ของ สมชาย ใจดี" }))
      .toHaveAttribute("src", expect.stringContaining("/v1/profile-images/member/7")));
  });
});
