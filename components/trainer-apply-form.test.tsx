import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerApplyForm } from "@/components/trainer-apply-form";
import { ApiError, authenticatedRequest } from "@/lib/api";
import type { TrainerAccountProfile } from "@/lib/types";

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, authenticatedRequest: vi.fn() };
});

const trainingTypes = [
  { id: 1, slug: "strength", nameTh: "เวทเทรนนิง" },
  { id: 2, slug: "running", nameTh: "วิ่ง" },
];

function profileWith(certificateStatus: "pending" | "verified" | "rejected" | null): TrainerAccountProfile {
  return {
    role: "trainer",
    user: { displayName: "เทรนเนอร์ ทดสอบ", email: "trainer@fitconnect.local" },
    imageUrl: null,
    trainer: {
      legalName: "สมชาย ใจดี",
      phone: "0812345678",
      headline: "วางรากฐานความแข็งแรง",
      bio: "ดูแลการฝึกเวทอย่างปลอดภัย",
      yearsExperience: 5,
      serviceMode: "freelance",
      gymName: null,
      priceFrom: 650,
      monthlyPrice: null,
      monthlySessionCount: null,
      paymentAccountName: "สมชาย ใจดี",
      promptPayId: "0812345678",
      paymentQrUrl: null,
      trainingTypeIds: [1],
      approvalStatus: "pending",
      approvalNote: null,
      certificates: certificateStatus === null
        ? []
        : [{ id: 9, name: "เอกสารใบรับรองจากผู้สมัคร", issuer: "รอระบุ", issuedYear: null, status: certificateStatus }],
    },
  };
}

function mockApi(profile: TrainerAccountProfile | null) {
  vi.mocked(authenticatedRequest).mockImplementation((path: string) => {
    if (path === "/v1/training-types") return Promise.resolve(trainingTypes) as never;
    if (path === "/v1/profile") {
      return profile
        ? Promise.resolve(profile) as never
        : Promise.reject(new ApiError("กรอกข้อมูลสมัครเทรนเนอร์ก่อนเปิดโปรไฟล์", 409, "TRAINER_PROFILE_REQUIRED")) as never;
    }
    return Promise.resolve({}) as never;
  });
}

function certificateFile() {
  return new File(["certificate"], "certificate.pdf", { type: "application/pdf" });
}

async function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "เทรนเนอร์ ทดสอบ" } });
  fireEvent.change(screen.getByLabelText("ประโยคแนะนำตัวบนหน้าร้าน"), { target: { value: "วางรากฐานความแข็งแรง" } });
  fireEvent.change(screen.getByLabelText("เกี่ยวกับฉัน"), { target: { value: "ดูแลการฝึกเวทอย่างปลอดภัย" } });
  fireEvent.change(screen.getByLabelText("ค่าฝึกเริ่มต้น (บาท)"), { target: { value: "650" } });
  fireEvent.change(screen.getByLabelText("ชื่อบัญชีรับเงิน"), { target: { value: "สมชาย ใจดี" } });
  fireEvent.change(screen.getByLabelText("หมายเลขพร้อมเพย์"), { target: { value: "0812345678" } });
  fireEvent.change(screen.getByLabelText("ชื่อ-นามสกุลจริง"), { target: { value: "สมชาย ใจดี" } });
  // Waits for the types request because the checkboxes only exist once it lands.
  fireEvent.click(await screen.findByLabelText("เวทเทรนนิง"));
}

describe("TrainerApplyForm", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    localStorage.setItem("fitconnect_token", "trainer-token");
  });

  it("sends the whole professional record in one submission", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/ไฟล์ใบรับรอง/), { target: { files: [certificateFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    await waitFor(() => expect(vi.mocked(authenticatedRequest)).toHaveBeenCalledWith(
      "/v1/trainer-applications",
      expect.objectContaining({ method: "POST" }),
    ));
    const call = vi.mocked(authenticatedRequest).mock.calls.find(([path]) => path === "/v1/trainer-applications");
    const body = call?.[1]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    // The fields the old apply form never collected.
    expect(body.get("headline")).toBe("วางรากฐานความแข็งแรง");
    expect(body.get("bio")).toBe("ดูแลการฝึกเวทอย่างปลอดภัย");
    expect(body.get("priceFrom")).toBe("650");
    expect(body.get("paymentAccountName")).toBe("สมชาย ใจดี");
    expect(body.getAll("trainingTypeIds[]")).toEqual(["1"]);
    expect(body.get("certificate")).toBeInstanceOf(File);
    expect(body.has("provinceId")).toBe(false);
  });

  it("demands a certificate when the trainer has none on file", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    expect(await screen.findByText("แนบไฟล์ PDF ใบรับรองเพื่อให้ผู้ดูแลระบบตรวจ")).toBeInTheDocument();
    expect(vi.mocked(authenticatedRequest).mock.calls.some(([path]) => path === "/v1/trainer-applications")).toBe(false);
  });

  it("lets a trainer with a stored certificate resubmit without re-uploading", async () => {
    mockApi(profileWith("verified"));
    render(<TrainerApplyForm />);
    expect(await screen.findByText("เอกสารใบรับรองจากผู้สมัคร")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("ชื่อที่แสดง")).toHaveValue("เทรนเนอร์ ทดสอบ"));

    fireEvent.change(screen.getByLabelText("ค่าฝึกเริ่มต้น (บาท)"), { target: { value: "700" } });
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    await waitFor(() => expect(vi.mocked(authenticatedRequest).mock.calls.some(([path]) => path === "/v1/trainer-applications")).toBe(true));
    const call = vi.mocked(authenticatedRequest).mock.calls.find(([path]) => path === "/v1/trainer-applications");
    const body = call?.[1]?.body as FormData;
    expect(body.get("priceFrom")).toBe("700");
    expect(body.has("certificate")).toBe(false);
  });

  it("still demands a new certificate after a rejection", async () => {
    mockApi(profileWith("rejected"));
    render(<TrainerApplyForm />);
    await waitFor(() => expect(screen.getByLabelText("ชื่อที่แสดง")).toHaveValue("เทรนเนอร์ ทดสอบ"));
    expect(screen.getByText("ใบรับรองเดิมไม่ผ่านการตรวจ กรุณาแนบไฟล์ PDF ฉบับใหม่")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    expect(await screen.findByText("แนบไฟล์ PDF ใบรับรองเพื่อให้ผู้ดูแลระบบตรวจ")).toBeInTheDocument();
    expect(vi.mocked(authenticatedRequest).mock.calls.some(([path]) => path === "/v1/trainer-applications")).toBe(false);
  });

  it("prefills the record a trainer already saved", async () => {
    mockApi(profileWith("pending"));
    render(<TrainerApplyForm />);

    await waitFor(() => expect(screen.getByLabelText("ชื่อ-นามสกุลจริง")).toHaveValue("สมชาย ใจดี"));
    expect(screen.getByLabelText("ค่าฝึกเริ่มต้น (บาท)")).toHaveValue(650);
    expect(screen.getByLabelText("หมายเลขพร้อมเพย์")).toHaveValue("0812345678");
    expect(screen.getByLabelText("เวทเทรนนิง")).toBeChecked();
  });

  it("surfaces the field errors the server returns", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path: string) => {
      if (path === "/v1/training-types") return Promise.resolve(trainingTypes) as never;
      if (path === "/v1/profile") return Promise.reject(new ApiError("ยังไม่มีโปรไฟล์", 409)) as never;
      return Promise.reject(new ApiError("ข้อมูลไม่ถูกต้อง", 422, "VALIDATION_FAILED", {
        promptPayId: "กรอกเบอร์พร้อมเพย์ 10 หลักหรือเลขประจำตัว 13 หลัก",
      })) as never;
    });

    render(<TrainerApplyForm />);
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/ไฟล์ใบรับรอง/), { target: { files: [certificateFile()] } });
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    expect(await screen.findByText("ข้อมูลไม่ถูกต้อง")).toBeInTheDocument();
  });
});
