import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerDetail } from "@/components/trainer-detail";
import { authenticatedRequest } from "@/lib/api";
import { trainers } from "@/lib/demo-data";

vi.mock("@/lib/api", () => ({ authenticatedRequest: vi.fn() }));

function appearsBefore(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("TrainerDetail", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("uses a commerce-detail hierarchy with media, identity evidence, and booking panel", () => {
    const trainer = { ...trainers[0], demo: false };
    render(<TrainerDetail trainer={trainer} isDemo={false} />);

    const summary = screen.getByRole("region", { name: trainer.displayName });
    const bookingPanel = screen.getByRole("complementary", { name: "เลือกเวลาฝึก" });
    const credentials = screen.getByText("ใบรับรองและคุณสมบัติ").closest("details");

    expect(within(summary).getByRole("heading", { level: 1, name: trainer.displayName })).toBeInTheDocument();
    expect(within(summary).getAllByText("ตรวจคุณสมบัติแล้ว").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ค่าฝึกต่อครั้ง").length).toBeGreaterThan(0);
    expect(within(summary).queryByText(/สกลนคร|นครพนม|พื้นที่ให้บริการ/)).not.toBeInTheDocument();
    expect(credentials).not.toHaveAttribute("open");
    expect(appearsBefore(summary, bookingPanel)).toBe(true);
    expect(within(bookingPanel).getByText("ระบบจะเก็บเวลาที่เลือกไว้ 10 นาทีหลังยืนยัน")).toBeInTheDocument();
  });

  it("mounts credentials and the complete schedule once, then exposes the booking link", () => {
    const trainer = { ...trainers[0], demo: false };
    render(<TrainerDetail trainer={trainer} isDemo={false} />);

    const credentials = screen.getByText("ใบรับรองและคุณสมบัติ").closest("details") as HTMLElement;
    const schedule = screen.getByText("ตารางว่างทั้งหมด").closest("details") as HTMLElement;
    expect(screen.getAllByText(trainer.certificates[0].name)).toHaveLength(1);
    expect(screen.getAllByRole("region", { name: `ตารางว่างของ ${trainer.displayName}` })).toHaveLength(1);

    expect(schedule).toHaveAttribute("open");
    const firstSlot = within(schedule).getAllByRole("button")[0];
    fireEvent.click(firstSlot);

    expect(screen.getAllByRole("link", { name: "จองเวลานี้" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "จองเวลานี้" })).toHaveAttribute(
      "href",
      `/booking?trainer=${trainer.slug}&slot=${trainer.slots[0].id}`,
    );
    expect(credentials).not.toHaveAttribute("open");
  });

  it("distinguishes live portraits from demo portraits and keeps a null price factual", () => {
    const liveTrainer = { ...trainers[0], demo: false, priceFrom: null };
    const { rerender } = render(<TrainerDetail trainer={liveTrainer} isDemo={false} />);

    expect(screen.getByRole("img", { name: `ภาพบุคคลของ${liveTrainer.displayName}` })).toBeInTheDocument();
    expect(screen.queryByText("ภาพสังเคราะห์ · สาธิต")).not.toBeInTheDocument();
    expect(screen.getAllByText("เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก").length).toBeGreaterThan(0);

    rerender(<TrainerDetail trainer={trainers[0]} isDemo />);
    expect(screen.getByRole("img", { name: `ภาพสังเคราะห์ของ${trainers[0].displayName} ใช้เพื่อสาธิต` })).toBeInTheDocument();
    expect(screen.getByText("ภาพสังเคราะห์ · สาธิต")).toBeInTheDocument();
  });

  it("lets a trainer update only their own profile price after the API succeeds", async () => {
    const trainer = { ...trainers[0], demo: false };
    const workspace = {
      profile: { id: trainer.id, slug: trainer.slug, displayName: trainer.displayName, approvalStatus: "approved" as const, approvalNote: null },
      certificates: [],
      slots: [],
    };
    localStorage.setItem("fitconnect_user", JSON.stringify({ role: "trainer" }));
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(workspace)
      .mockResolvedValueOnce(workspace);

    render(<TrainerDetail trainer={trainer} isDemo={false} />);
    fireEvent.click(await screen.findByRole("button", { name: "ปรับราคา" }));
    fireEvent.change(screen.getByLabelText("ค่าฝึกต่อครั้ง"), { target: { value: "780" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/trainer/me", {
      method: "PATCH",
      body: JSON.stringify({ priceFrom: 780 }),
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกค่าฝึกต่อครั้งแล้ว");
    expect(screen.getAllByText(/฿780/).length).toBeGreaterThan(0);
  });

  it("does not expose the price editor on another trainer's profile", async () => {
    const trainer = { ...trainers[0], demo: false };
    localStorage.setItem("fitconnect_user", JSON.stringify({ role: "trainer" }));
    vi.mocked(authenticatedRequest).mockResolvedValue({
      profile: { id: trainer.id + 1, slug: "another-trainer", displayName: "อีกคน", approvalStatus: "approved", approvalNote: null },
      certificates: [],
      slots: [],
    });

    render(<TrainerDetail trainer={trainer} isDemo={false} />);
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/trainer/me"));
    expect(screen.queryByRole("button", { name: "ปรับราคา" })).not.toBeInTheDocument();
  });
});
