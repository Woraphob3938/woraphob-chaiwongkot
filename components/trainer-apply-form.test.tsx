import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerApplyForm } from "@/components/trainer-apply-form";
import { ApiError, authenticatedRequest } from "@/lib/api";
import type { TrainerAccountProfile } from "@/lib/types";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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

/** A first application sends from the last step, so tests walk there first. */
function goToLastStep() {
  fireEvent.click(screen.getByRole("button", { name: /ใบรับรองและส่ง/ }));
}

function certificateFile() {
  return new File(["certificate"], "certificate.pdf", { type: "application/pdf" });
}

async function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "เทรนเนอร์ ทดสอบ" } });
  fireEvent.change(screen.getByLabelText("ประโยคแนะนำตัวบนหน้าร้าน"), { target: { value: "วางรากฐานความแข็งแรง" } });
  fireEvent.change(screen.getByLabelText("เกี่ยวกับฉัน"), { target: { value: "ดูแลการฝึกเวทอย่างปลอดภัย" } });
  fireEvent.change(screen.getByLabelText("ค่าฝึกเริ่มต้น (บาท)"), { target: { value: "650" } });
  fireEvent.change(screen.getByLabelText("ชื่อ-นามสกุลจริง"), { target: { value: "สมชาย ใจดี" } });
  // Waits for the types request because the checkboxes only exist once it lands.
  fireEvent.click(await screen.findByLabelText("เวทเทรนนิง"));
}

describe("TrainerApplyForm", () => {
  beforeEach(() => {
    vi.mocked(authenticatedRequest).mockReset();
    push.mockClear();
    localStorage.setItem("fitconnect_token", "trainer-token");
  });

  it("sends the whole professional record in one submission", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/^วันเกิด/), { target: { value: "1990-05-20" } });
    fireEvent.change(screen.getByLabelText(/^ข้อมูลการศึกษา/), { target: { value: "ปริญญาตรี วิทยาศาสตร์การกีฬา" } });
    fireEvent.change(screen.getByLabelText(/ไฟล์ใบรับรอง/), { target: { files: [certificateFile()] } });
    goToLastStep();
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
    expect(body.get("paymentAccountName")).toBeNull();
    expect(body.get("promptPayId")).toBeNull();
    expect(body.get("birthDate")).toBe("1990-05-20");
    expect(body.get("education")).toBe("ปริญญาตรี วิทยาศาสตร์การกีฬา");
    expect(body.getAll("trainingTypeIds[]")).toEqual(["1"]);
    expect(body.get("certificate")).toBeInstanceOf(File);
    expect(body.has("provinceId")).toBe(false);
  });

  it("rejects impossible birth dates and education over 255 characters", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/^วันเกิด/), { target: { value: "2100-01-01" } });
    goToLastStep();
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    expect(await screen.findByText("วันเกิดต้องเป็นวันที่ผ่านมาแล้ว")).toBeInTheDocument();
    expect(vi.mocked(authenticatedRequest).mock.calls.some(([path]) => path === "/v1/trainer-applications")).toBe(false);

    fireEvent.change(screen.getByLabelText(/^วันเกิด/), { target: { value: "1990-05-20" } });
    fireEvent.change(screen.getByLabelText(/^ข้อมูลการศึกษา/), { target: { value: "ว".repeat(256) } });
    goToLastStep();
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    expect(await screen.findByText("ข้อมูลการศึกษาต้องไม่เกิน 255 ตัวอักษร")).toBeInTheDocument();
    expect(vi.mocked(authenticatedRequest).mock.calls.some(([path]) => path === "/v1/trainer-applications")).toBe(false);
  });

  it("prefills the stored birth date and education", async () => {
    const base = profileWith("verified");
    const stored = { ...base, trainer: { ...base.trainer, birthDate: "1990-05-20", education: "ปริญญาตรี วิทยาศาสตร์การกีฬา" } };
    mockApi(stored);
    render(<TrainerApplyForm />);

    await waitFor(() => expect(screen.getByLabelText(/^วันเกิด/)).toHaveValue("1990-05-20"));
    expect(screen.getByLabelText(/^ข้อมูลการศึกษา/)).toHaveValue("ปริญญาตรี วิทยาศาสตร์การกีฬา");
  });

  it("keeps the service mode to two choices and collects no gym name", async () => {
    mockApi(profileWith("verified"));
    render(<TrainerApplyForm />);
    await waitFor(() => expect(screen.getByLabelText("ชื่อที่แสดง")).toHaveValue("เทรนเนอร์ ทดสอบ"));

    // The record offers freelance or gym only and no longer asks where the
    // trainer works, so a submission carries no gym name at all.
    const modes = within(screen.getByRole("group", { name: "รูปแบบการให้บริการ" })).getAllByRole("radio");
    expect(modes.map((radio) => (radio as HTMLInputElement).value)).toEqual(["freelance", "gym"]);
    expect(screen.getByRole("radio", { name: /ฟรีแลนซ์/ })).toBeChecked();
    expect(screen.queryByLabelText("ชื่อสถานที่ฝึก")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));
    await waitFor(() => expect(vi.mocked(authenticatedRequest).mock.calls.some(([path]) => path === "/v1/trainer-applications")).toBe(true));
    const call = vi.mocked(authenticatedRequest).mock.calls.find(([path]) => path === "/v1/trainer-applications");
    const body = call?.[1]?.body as FormData;
    expect(body.get("serviceMode")).toBe("freelance");
    expect(body.has("gymName")).toBe(false);
  });

  it("returns to the profile page and can put the saved record back", async () => {
    mockApi(profileWith("verified"));
    render(<TrainerApplyForm />);
    await waitFor(() => expect(screen.getByLabelText("ชื่อที่แสดง")).toHaveValue("เทรนเนอร์ ทดสอบ"));

    expect(screen.getByRole("link", { name: "ย้อนกลับ" })).toHaveAttribute("href", "/profile");
    const restore = screen.getByRole("button", { name: /คืนค่า/ });
    expect(restore).toBeDisabled();

    fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "ชื่อที่แก้แล้ว" } });
    fireEvent.change(screen.getByLabelText("ค่าฝึกเริ่มต้น (บาท)"), { target: { value: "999" } });
    expect(restore).toBeEnabled();

    fireEvent.click(restore);

    expect(screen.getByLabelText("ชื่อที่แสดง")).toHaveValue("เทรนเนอร์ ทดสอบ");
    expect(screen.getByLabelText("ค่าฝึกเริ่มต้น (บาท)")).toHaveValue(650);
    expect(restore).toBeDisabled();
  });

  it("asks before leaving with changes it has not sent", async () => {
    mockApi(profileWith("verified"));
    render(<TrainerApplyForm />);
    await waitFor(() => expect(screen.getByLabelText("ชื่อที่แสดง")).toHaveValue("เทรนเนอร์ ทดสอบ"));

    // Nothing typed yet, so leaving is not worth interrupting.
    expect(screen.queryByText("ย้อนกลับโดยที่ยังไม่ได้ส่งใบสมัคร?")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "ชื่อที่แก้แล้ว" } });
    fireEvent.click(screen.getByRole("link", { name: "ย้อนกลับ" }));

    expect(await screen.findByText("ย้อนกลับโดยที่ยังไม่ได้ส่งใบสมัคร?")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "ย้อนกลับโดยไม่บันทึก" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/profile"));
  });

  it("demands a certificate when the trainer has none on file", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await fillRequiredFields();
    goToLastStep();
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
    expect(screen.queryByLabelText("หมายเลขพร้อมเพย์")).not.toBeInTheDocument();
    expect(screen.getByLabelText("เวทเทรนนิง")).toBeChecked();
  });

  it("surfaces the field errors the server returns", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path: string) => {
      if (path === "/v1/training-types") return Promise.resolve(trainingTypes) as never;
      if (path === "/v1/profile") return Promise.reject(new ApiError("ยังไม่มีโปรไฟล์", 409)) as never;
      return Promise.reject(new ApiError("ข้อมูลไม่ถูกต้อง", 422, "VALIDATION_FAILED", {
        phone: "เบอร์โทรศัพท์ไม่ถูกต้อง",
      })) as never;
    });

    render(<TrainerApplyForm />);
    await fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/ไฟล์ใบรับรอง/), { target: { files: [certificateFile()] } });
    goToLastStep();
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));

    expect(await screen.findByText("ข้อมูลไม่ถูกต้อง")).toBeInTheDocument();
  });
  it("walks a new applicant through four steps and checks only the step being left", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await screen.findByLabelText("เวทเทรนนิง");

    const steps = screen.getByRole("navigation", { name: "ขั้นตอนการกรอกข้อมูล" });
    expect(within(steps).getAllByRole("button")).toHaveLength(4);
    expect(within(steps).getByRole("button", { name: /หน้าร้าน/ })).toHaveAttribute("aria-current", "step");
    // A first application cannot be sent before the last step.
    expect(screen.queryByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^ถัดไป/ }));
    expect(await screen.findByText("กรุณากรอกชื่อที่แสดง")).toBeInTheDocument();
    // Fields of later steps are not flagged yet.
    expect(screen.queryByText("กรุณากรอกชื่อจริง")).not.toBeInTheDocument();
    expect(within(steps).getByRole("button", { name: /หน้าร้าน/ })).toHaveAttribute("aria-current", "step");

    await fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /^ถัดไป/ }));
    expect(within(steps).getByRole("button", { name: /บริการและราคา/ })).toHaveAttribute("aria-current", "step");
  });

  it("jumps to the earliest step that still owes something on send", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await screen.findByLabelText("เวทเทรนนิง");
    goToLastStep();
    fireEvent.click(screen.getByRole("button", { name: /ส่งใบสมัครให้ผู้ดูแลระบบตรวจ/ }));
    const steps = screen.getByRole("navigation", { name: "ขั้นตอนการกรอกข้อมูล" });
    await waitFor(() => expect(within(steps).getByRole("button", { name: /หน้าร้าน/ })).toHaveAttribute("aria-current", "step"));
    expect(within(steps).getByRole("button", { name: /ข้อมูลส่วนตัว/ })).toHaveTextContent(/ต้องแก้/);
  });

  it("opens the 30-day package fields only when the package switch is on", async () => {
    mockApi(null);
    render(<TrainerApplyForm />);
    await screen.findByLabelText("เวทเทรนนิง");
    expect(screen.queryByLabelText("ราคาแพ็กเกจ 30 วัน")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("switch", { name: /เปิดแพ็กเกจ 30 วัน/ }));
    fireEvent.change(screen.getByLabelText("ราคาแพ็กเกจ 30 วัน"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("จำนวนครั้งในแพ็กเกจ"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("switch", { name: /เปิดแพ็กเกจ 30 วัน/ }));
    fireEvent.click(screen.getByRole("switch", { name: /เปิดแพ็กเกจ 30 วัน/ }));
    // Turning the package off cleared it, so it comes back empty.
    expect(screen.getByLabelText("ราคาแพ็กเกจ 30 วัน")).toHaveValue(null);
  });
});
