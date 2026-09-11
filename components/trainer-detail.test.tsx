import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerDetail } from "@/components/trainer-detail";
import { authenticatedRequest } from "@/lib/api";
import { trainers } from "@/lib/demo-data";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

function appearsBefore(first: Element, second: Element) {
  return Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("TrainerDetail", () => {
  it.each(["/trainers?q=test&price=under_700", "https://example.com", "//example.com"])("limits the back link to trainer search: %s", (returnTo) => {
    render(<TrainerDetail trainer={trainers[0]} returnTo={returnTo} />);
    expect(screen.getByRole("link", { name: "ย้อนกลับ" })).toHaveAttribute("href", returnTo.startsWith("/trainers?") ? returnTo : "/trainers");
  });

  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("uses a commerce-detail hierarchy with media, identity evidence, and booking panel", () => {
    const trainer = { ...trainers[0], demo: false, paymentQrUrl: "/v1/trainer-payment-qr/1" };
    render(<TrainerDetail trainer={trainer} />);

    const summary = screen.getByRole("region", { name: trainer.displayName });
    const bookingPanel = screen.getByRole("complementary", { name: "เลือกเวลาฝึก" });
    const credentials = screen.getByText("ใบรับรองและคุณสมบัติ").closest("details");

    expect(screen.getByRole("link", { name: "ย้อนกลับ" })).toHaveAttribute("href", "/trainers");
    expect(within(summary).getByRole("heading", { level: 1, name: trainer.displayName })).toBeInTheDocument();
    expect(within(summary).getAllByText("ตรวจคุณสมบัติแล้ว").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ค่าฝึกต่อครั้ง").length).toBeGreaterThan(0);
    expect(within(summary).queryByText(/สกลนคร|นครพนม|พื้นที่ให้บริการ/)).not.toBeInTheDocument();
    expect(screen.getByText("ฟิตเนสประจำยิม")).toBeInTheDocument();
    expect(credentials).not.toHaveAttribute("open");
    expect(appearsBefore(summary, bookingPanel)).toBe(true);
    expect(
      within(bookingPanel).getByText(/ระบบกันเวลานัดแรกไว้ 10 นาที.*ผู้ดูแลระบบตรวจอนุมัติ/),
    ).toBeInTheDocument();
    fireEvent.click(within(bookingPanel).getByText("ดู QR รับเงินของเทรนเนอร์"));
    expect(within(bookingPanel).getByRole("img", { name: `QR รับเงินของ ${trainer.displayName}` })).toBeInTheDocument();
    expect(within(bookingPanel).getByText(/ตรวจชื่อผู้รับในแอปธนาคารก่อนโอนทุกครั้ง/)).toBeInTheDocument();
  });

  it("opens the complete schedule in a dialog, then exposes the booking link", async () => {
    const trainer = { ...trainers[0], demo: false };
    render(<TrainerDetail trainer={trainer} />);

    const credentials = screen.getByText("ใบรับรองและคุณสมบัติ").closest("details") as HTMLElement;
    expect(screen.getAllByText(trainer.certificates[0].name)).toHaveLength(1);
    expect(screen.queryByRole("dialog", { name: "เลือกวันและเวลาฝึก" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /ดูตารางว่างทั้งหมด/ }));
    const schedule = screen.getByRole("dialog", { name: "เลือกวันและเวลาฝึก" });
    fireEvent.click(within(schedule).getByRole("button", { name: "09:00–10:00" }));
    fireEvent.click(within(schedule).getByRole("button", { name: "ยืนยันเวลานี้" }));

    expect(screen.getAllByRole("link", { name: "จองเวลานี้" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "จองเวลานี้" })).toHaveAttribute(
      "href",
      `/booking?trainer=${trainer.slug}&slot=${trainer.slots[0].id}`,
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(credentials).not.toHaveAttribute("open");
  });

  it("keeps portrait copy neutral and a null price factual", () => {
    const liveTrainer = { ...trainers[0], demo: false, priceFrom: null };
    const { rerender } = render(<TrainerDetail trainer={liveTrainer} />);

    expect(screen.getByRole("img", { name: `รูปโปรไฟล์ของ${liveTrainer.displayName}` })).toBeInTheDocument();
    expect(screen.queryByText("ภาพสังเคราะห์ · สาธิต")).not.toBeInTheDocument();
    expect(screen.getAllByText("เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก").length).toBeGreaterThan(0);

    rerender(<TrainerDetail trainer={trainers[0]} />);
    expect(screen.getByRole("img", { name: `รูปโปรไฟล์ของ${trainers[0].displayName}` })).toBeInTheDocument();
    expect(screen.getByText("ภาพสาธิต")).toBeInTheDocument();
  });

  it("shows completed-booking review evidence without exposing internal profile IDs", () => {
    const trainer = {
      ...trainers[0],
      rating: 4.8,
      reviewCount: 5,
      reviews: [
        { rating: 5, comment: "แนะนำท่าชัดเจนและดูแลตลอดการฝึก", createdAt: "2026-08-11T11:14:23Z" },
        { rating: 5, comment: "ตรงเวลาและวางแผนให้เหมาะกับเป้าหมาย", createdAt: "2026-08-10T04:18:15Z" },
        { rating: 4, comment: "อธิบายเข้าใจง่ายและปรับท่าให้ทันที", createdAt: "2026-08-09T03:00:00Z" },
        { rating: 5, comment: "ติดตามผลหลังฝึกดี", createdAt: "2026-08-08T03:00:00Z" },
        { rating: 5, comment: "บรรยากาศการฝึกเป็นกันเอง", createdAt: "2026-08-07T03:00:00Z" },
      ],
    };
    const { container } = render(<TrainerDetail trainer={trainer} />);

    expect(screen.getAllByText("4.8 จาก 5 · 5 รีวิว")).toHaveLength(2);
    expect(screen.queryByText(/ยังไม่มีรีวิว/)).not.toBeInTheDocument();
    expect(screen.queryByText(/#001/)).not.toBeInTheDocument();

    const reviews = screen.getByRole("region", { name: "รีวิวจากสมาชิก" });
    expect(within(reviews).getByText("เฉพาะรีวิวจากการจองที่ฝึกเสร็จแล้ว")).toBeInTheDocument();
    expect(within(reviews).getAllByRole("article")).toHaveLength(3);
    expect(within(reviews).getByText("แนะนำท่าชัดเจนและดูแลตลอดการฝึก")).toBeInTheDocument();
    expect(within(reviews).getByText("แนะนำท่าชัดเจนและดูแลตลอดการฝึก").closest("article")?.querySelector("time"))
      .toHaveAttribute("datetime", "2026-08-11T11:14:23Z");
    expect(within(reviews).queryByText("ติดตามผลหลังฝึกดี")).not.toBeInTheDocument();
    expect(within(reviews).getByRole("navigation", { name: "หน้ารายการรีวิว" })).toBeInTheDocument();
    fireEvent.click(within(reviews).getByRole("button", { name: "หน้ารีวิว 2" }));
    expect(within(reviews).getAllByRole("article")).toHaveLength(2);
    expect(within(reviews).getByText("ติดตามผลหลังฝึกดี")).toBeInTheDocument();
    expect(within(reviews).getByText("กลับไปเลือกเวลา")).toHaveAttribute("href", "#booking-panel");

    const commerceLayout = container.querySelector(".trainer-commerce-layout");
    expect(commerceLayout).not.toBeNull();
    expect(appearsBefore(commerceLayout as Element, reviews)).toBe(true);
    expect(screen.getAllByRole("heading").slice(0, 3).map((heading) => heading.tagName)).toEqual(["H1", "H2", "H3"]);
  });

  it("uses a factual empty review state only when the published count is zero", () => {
    render(<TrainerDetail trainer={{ ...trainers[0], rating: undefined, reviewCount: 0, reviews: [] }} />);

    expect(screen.getAllByText("ยังไม่มีรีวิวจากการฝึกที่เสร็จแล้ว").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "รีวิวจากสมาชิก" })).toBeInTheDocument();
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

    render(<TrainerDetail trainer={trainer} />);
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

    render(<TrainerDetail trainer={trainer} />);
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/trainer/me"));
    expect(screen.queryByRole("button", { name: "ปรับราคา" })).not.toBeInTheDocument();
  });
});
