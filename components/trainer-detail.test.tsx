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

  it("puts identity, verification, price, and one next action before supporting details", () => {
    const trainer = { ...trainers[0], demo: false };
    render(<TrainerDetail trainer={trainer} isDemo={false} />);

    const summary = screen.getByRole("region", { name: trainer.displayName });
    const action = screen.getByRole("button", { name: "เลือกเวลา" });
    const credentials = screen.getByText("ใบรับรองและคุณสมบัติ").closest("details");
    const schedule = screen.getByText("ตารางว่างทั้งหมด").closest("details");

    expect(within(summary).getByRole("heading", { name: trainer.displayName })).toBeInTheDocument();
    expect(within(summary).getByText("ตรวจคุณสมบัติแล้ว")).toBeInTheDocument();
    expect(within(summary).getByText(/เริ่มต้น.*650/)).toBeInTheDocument();
    expect(within(summary).queryByText(/สกลนคร|นครพนม|พื้นที่ให้บริการ/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "เลือกเวลา" })).toHaveLength(1);
    expect(credentials).not.toHaveAttribute("open");
    expect(schedule).not.toHaveAttribute("open");
    expect(appearsBefore(summary, action)).toBe(true);
    expect(appearsBefore(action, credentials as Element)).toBe(true);
    expect(appearsBefore(credentials as Element, schedule as Element)).toBe(true);
  });

  it("mounts credentials and the complete schedule once, then advances the single booking action", () => {
    const trainer = { ...trainers[0], demo: false };
    render(<TrainerDetail trainer={trainer} isDemo={false} />);

    const credentials = screen.getByText("ใบรับรองและคุณสมบัติ").closest("details") as HTMLElement;
    const schedule = screen.getByText("ตารางว่างทั้งหมด").closest("details") as HTMLElement;
    expect(screen.getAllByText(trainer.certificates[0].name)).toHaveLength(1);
    expect(screen.getAllByRole("region", { name: `ตารางว่างของ ${trainer.displayName}` })).toHaveLength(1);

    fireEvent.click(within(schedule).getByText("ตารางว่างทั้งหมด"));
    expect(schedule).toHaveAttribute("open");
    const firstSlot = within(schedule).getAllByRole("button")[0];
    fireEvent.click(firstSlot);

    expect(screen.queryByRole("button", { name: "เลือกเวลา" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /ส่งคำขอจอง/ })).toHaveLength(1);
    expect(screen.getByRole("link", { name: /ส่งคำขอจอง/ })).toHaveAttribute(
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
    expect(screen.getAllByText("รอยืนยันราคา").length).toBeGreaterThan(0);

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
    fireEvent.change(screen.getByLabelText("ราคาเริ่มต้น"), { target: { value: "780" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/trainer/me", {
      method: "PATCH",
      body: JSON.stringify({ priceFrom: 780 }),
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("บันทึกราคาเริ่มต้นแล้ว");
    expect(screen.getByText(/เริ่มต้น.*780/)).toBeInTheDocument();
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
