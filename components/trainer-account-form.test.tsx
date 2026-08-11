import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerAccountForm } from "@/components/trainer-account-form";
import { authenticatedRequest } from "@/lib/api";
import type { TrainerAccountProfile } from "@/lib/types";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

const profile: TrainerAccountProfile = {
  role: "trainer",
  user: { displayName: "ครูเมย์", email: "trainer@example.com" },
  imageUrl: null,
  trainer: {
    legalName: "เมย์ ใจดี", phone: "0812345678", headline: "ฝึกให้แข็งแรง", bio: "ดูแลอย่างเป็นระบบ",
    yearsExperience: 3, serviceMode: "freelance", gymName: null, priceFrom: 650,
    trainingTypeIds: [1], approvalStatus: "rejected", approvalNote: "แก้ชื่อใบรับรอง",
    certificates: [{ id: 9, name: "CPT", issuer: "FIT", issuedYear: 2025, status: "pending" }],
  },
};

beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

describe("TrainerAccountForm", () => {
  it("loads training types, reveals the gym field when needed, and sends only editable fields", async () => {
    const saved = { ...profile, user: { ...profile.user, displayName: "เมย์ ฟิต" } };
    vi.mocked(authenticatedRequest).mockImplementation(async (path) => {
      if (path === "/v1/training-types") return [{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }, { id: 2, slug: "yoga", nameTh: "โยคะ" }];
      return saved;
    });
    const onSaved = vi.fn();
    render(<TrainerAccountForm profile={profile} onSaved={onSaved} />);

    expect(await screen.findByLabelText("สร้างกล้ามเนื้อ")).toBeChecked();
    expect(screen.getByLabelText("อีเมล")).toHaveAttribute("readonly");
    expect(screen.getByText("แก้ชื่อใบรับรอง")).toBeInTheDocument();
    expect(screen.getByText("CPT")).toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อยิม")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "เมย์ ฟิต" } });
    fireEvent.change(screen.getByLabelText("รูปแบบการให้บริการ"), { target: { value: "both" } });
    expect(screen.getByLabelText("ชื่อยิม")).toBeRequired();
    fireEvent.change(screen.getByLabelText("ชื่อยิม"), { target: { value: "Fit Gym" } });
    fireEvent.click(screen.getByLabelText("โยคะ"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลเทรนเนอร์" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: "เมย์ ฟิต", legalName: "เมย์ ใจดี", phone: "0812345678",
        headline: "ฝึกให้แข็งแรง", bio: "ดูแลอย่างเป็นระบบ", yearsExperience: 3,
        serviceMode: "both", gymName: "Fit Gym", priceFrom: 650, trainingTypeIds: [1, 2],
      }),
    }));
    const sentBody = JSON.parse(String(vi.mocked(authenticatedRequest).mock.calls.find(([path]) => path === "/v1/profile")?.[1]?.body));
    expect(sentBody).not.toHaveProperty("approvalStatus");
    expect(sentBody).not.toHaveProperty("certificates");
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("requires a gym name and at least one training type", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }]);
    render(<TrainerAccountForm profile={profile} onSaved={vi.fn()} />);
    await screen.findByLabelText("สร้างกล้ามเนื้อ");
    fireEvent.change(screen.getByLabelText("รูปแบบการให้บริการ"), { target: { value: "gym" } });
    fireEvent.click(screen.getByLabelText("สร้างกล้ามเนื้อ"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลเทรนเนอร์" }));

    expect(screen.getByText("กรุณากรอกชื่อยิม")).toBeInTheDocument();
    expect(screen.getByText("เลือกประเภทการฝึกอย่างน้อยหนึ่งรายการ")).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
  });
});
