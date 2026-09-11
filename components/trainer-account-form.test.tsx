import { readFileSync } from "node:fs";
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
    paymentAccountName: "เมย์ ใจดี", promptPayId: "0812345678",
    paymentQrUrl: null,
    monthlyPrice: 2400, monthlySessionCount: 4,
    trainingTypeIds: [1], approvalStatus: "rejected", approvalNote: "แก้ชื่อใบรับรอง",
    certificates: [{ id: 9, name: "CPT", issuer: "FIT", issuedYear: 2025, status: "pending" }],
  },
};

beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

describe("TrainerAccountForm", () => {
  it("keeps training type checkboxes compact", () => {
    const globalStyles = readFileSync("app/globals.css", "utf8");
    const checkboxRule = globalStyles.match(/\.profile-training-types input\[type="checkbox"\]\s*\{[^}]*\}/)?.[0];

    expect(checkboxRule).toBeDefined();
    expect(checkboxRule).toContain("width: 1.15rem");
    expect(checkboxRule).toContain("height: 1.15rem");
  });

  it("keeps the no-certificate guidance compact and readable", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }]);
    const noCertificates = { ...profile, trainer: { ...profile.trainer, certificates: [] } };
    render(<TrainerAccountForm profile={noCertificates} onSaved={vi.fn()} />);
    await screen.findByLabelText("สร้างกล้ามเนื้อ");

    const message = screen.getByText(/ยังไม่มีใบรับรอง/);
    expect(message).toHaveClass("profile-certificates-empty");
    const globalStyles = readFileSync("app/globals.css", "utf8");
    const emptyRule = globalStyles.match(/\.profile-certificates-empty\s*\{[^}]*\}/)?.[0];
    expect(emptyRule).toBeDefined();
    expect(emptyRule).toContain("font-size: var(--text-sm)");
  });

  it("keeps certificates collapsed until the trainer asks to see them", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }]);
    render(<TrainerAccountForm profile={profile} onSaved={vi.fn()} />);
    await screen.findByLabelText("สร้างกล้ามเนื้อ");

    const summary = screen.getByText("ใบรับรองและคุณสมบัติ");
    const disclosure = summary.closest("details");
    expect(disclosure).not.toHaveAttribute("open");

    fireEvent.click(summary);
    expect(disclosure).toHaveAttribute("open");
  });

  it("keeps the single-gym profile focused and sends only editable fields", async () => {
    const saved = { ...profile, user: { ...profile.user, displayName: "เมย์ ฟิต" } };
    vi.mocked(authenticatedRequest).mockImplementation(async (path) => {
      if (path === "/v1/training-types") return [{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }, { id: 2, slug: "yoga", nameTh: "โยคะ" }];
      return saved;
    });
    const onSaved = vi.fn();
    render(<TrainerAccountForm profile={profile} onSaved={onSaved} />);

    expect(await screen.findByLabelText("สร้างกล้ามเนื้อ")).toBeChecked();
    expect(screen.queryByText("trainer@example.com")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "อีเมล" })).not.toBeInTheDocument();
    expect(screen.getByText("ข้อมูลครบ")).toBeInTheDocument();
    expect(screen.getAllByText("สมาชิกมองเห็น")).toHaveLength(4);
    expect(screen.getByText("ไม่แสดงบนหน้าร้าน")).toBeInTheDocument();
    expect(screen.getByText("แก้ชื่อใบรับรอง")).toBeInTheDocument();
    expect(screen.getByText("CPT")).toBeInTheDocument();
    expect(screen.queryByLabelText("ชื่อยิม")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "เมย์ ฟิต" } });
    fireEvent.change(screen.getByLabelText("รูปแบบการให้บริการ"), { target: { value: "gym" } });
    expect(screen.queryByLabelText("ชื่อยิม")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("โยคะ"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลเทรนเนอร์" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: "เมย์ ฟิต", legalName: "เมย์ ใจดี", phone: "0812345678",
        headline: "ฝึกให้แข็งแรง", bio: "ดูแลอย่างเป็นระบบ", yearsExperience: 3,
        serviceMode: "gym", gymName: "", priceFrom: 650, trainingTypeIds: [1, 2],
        monthlyPrice: 2400, monthlySessionCount: 4,
        paymentAccountName: "เมย์ ใจดี", promptPayId: "0812345678",
      }),
    }));
    const sentBody = JSON.parse(String(vi.mocked(authenticatedRequest).mock.calls.find(([path]) => path === "/v1/profile")?.[1]?.body));
    expect(sentBody).not.toHaveProperty("approvalStatus");
    expect(sentBody).not.toHaveProperty("certificates");
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("requires at least one training type without asking for a gym name", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }]);
    render(<TrainerAccountForm profile={profile} onSaved={vi.fn()} />);
    await screen.findByLabelText("สร้างกล้ามเนื้อ");
    fireEvent.change(screen.getByLabelText("รูปแบบการให้บริการ"), { target: { value: "gym" } });
    fireEvent.click(screen.getByLabelText("สร้างกล้ามเนื้อ"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึกข้อมูลเทรนเนอร์" }));

    expect(screen.queryByText("กรุณากรอกชื่อยิม")).not.toBeInTheDocument();
    expect(screen.getByText("เลือกประเภทการฝึกอย่างน้อยหนึ่งรายการ")).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps save enabled when training types fail to load", async () => {
    vi.mocked(authenticatedRequest).mockImplementation(async (path) => {
      if (path === "/v1/training-types") throw new Error("โหลดประเภทการฝึกไม่สำเร็จ");
      return profile;
    });
    render(<TrainerAccountForm profile={profile} onSaved={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("โหลดประเภทการฝึกไม่สำเร็จ");
    fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "ครูเมย์ ฟิต" } });
    expect(screen.getByRole("button", { name: "บันทึกข้อมูลเทรนเนอร์" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ลองโหลดประเภทการฝึกใหม่" })).toBeInTheDocument();
    expect(document.querySelectorAll("#trainer-training-types-load-error")).toHaveLength(1);
    expect(document.querySelectorAll("#trainer-training-types-error")).toHaveLength(0);
  });

  it("shows monthly package fields only after the trainer opts in", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValue([{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }]);
    const withoutMonthly = { ...profile, trainer: { ...profile.trainer, monthlyPrice: null, monthlySessionCount: null } };
    render(<TrainerAccountForm profile={withoutMonthly} onSaved={vi.fn()} />);
    await screen.findByLabelText("สร้างกล้ามเนื้อ");

    const toggle = screen.getByRole("checkbox", { name: /เปิดรับแพ็กเกจ 30 วัน/ });
    expect(toggle).not.toBeChecked();
    expect(screen.queryByLabelText("ราคาแพ็กเกจ 30 วัน (บาท)")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByLabelText("ราคาแพ็กเกจ 30 วัน (บาท)")).toBeInTheDocument();
    expect(screen.getByLabelText("จำนวนครั้งในแพ็กเกจ")).toBeInTheDocument();
  });

  it("uploads a trainer payment QR and shows the saved image", async () => {
    vi.mocked(authenticatedRequest).mockImplementation(async (path) => {
      if (path === "/v1/training-types") return [{ id: 1, slug: "strength", nameTh: "สร้างกล้ามเนื้อ" }];
      if (path === "/v1/profile/payment-qr") return { paymentQrUrl: "/v1/trainer-payment-qr/7" };
      return profile;
    });
    const onSaved = vi.fn();
    render(<TrainerAccountForm profile={profile} onSaved={onSaved} />);
    await screen.findByLabelText("สร้างกล้ามเนื้อ");

    const file = new File(["qr"], "promptpay.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("อัปโหลด QR รับเงิน"), { target: { files: [file] } });

    expect(await screen.findByRole("img", { name: "QR รับเงินของฉัน" })).toHaveAttribute(
      "src",
      expect.stringContaining("/v1/trainer-payment-qr/7"),
    );
    const uploadCall = vi.mocked(authenticatedRequest).mock.calls.find(([path]) => path === "/v1/profile/payment-qr");
    expect(uploadCall?.[1]?.method).toBe("POST");
    expect((uploadCall?.[1]?.body as FormData).get("image")).toBe(file);
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({
      trainer: expect.objectContaining({ paymentQrUrl: "/v1/trainer-payment-qr/7" }),
    }));
  });
});
