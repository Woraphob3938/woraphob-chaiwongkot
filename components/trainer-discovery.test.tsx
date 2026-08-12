import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrainerDiscovery } from "@/components/trainer-discovery";
import { trainers, trainingTypes } from "@/lib/demo-data";

function renderDiscovery(initialTrainers = trainers) {
  return render(
    <TrainerDiscovery
      initialTrainers={initialTrainers}
      trainingTypes={trainingTypes}
    />,
  );
}

describe("TrainerDiscovery", () => {
  it("keeps the page name accessible without repeating a large visible intro", () => {
    renderDiscovery();

    expect(screen.getByRole("heading", { name: "ค้นหาเทรนเนอร์" })).toHaveClass("sr-only");
    expect(screen.queryByText("ค้นหาเทรนเนอร์ที่เหมาะกับคุณ")).not.toBeInTheDocument();
    expect(screen.queryByText(/ดูความเชี่ยวชาญ ค่าฝึกต่อครั้ง/)).not.toBeInTheDocument();
  });

  it("does not show demo explanations in the discovery experience", () => {
    render(
      <TrainerDiscovery
        initialTrainers={trainers}
        trainingTypes={trainingTypes}
      />,
    );

    expect(screen.queryByText(/ข้อมูลสาธิต|ภาพสังเคราะห์/)).not.toBeInTheDocument();
  });

  it("renders a marketplace filter rail, result list, and profile CTAs", () => {
    renderDiscovery();

    expect(screen.getByRole("complementary", { name: "ตัวกรองเทรนเนอร์" })).toBeInTheDocument();
    const results = screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 3 รายการ" });
    expect(within(results).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByRole("link", { name: "ดูโปรไฟล์และเลือกเวลา" })).toHaveLength(3);
    expect(screen.queryByText("เทรนเนอร์ที่เลือก")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เลือก .*ตรวจคุณสมบัติ/ })).not.toBeInTheDocument();
  });

  it("filters by specialty, fixed session price, verification, and availability", () => {
    const trainerWithoutSlots = { ...trainers[2], slots: [] };
    renderDiscovery([trainers[0], trainers[1], trainerWithoutSlots]);

    fireEvent.change(screen.getByLabelText("ประเภทการฝึก"), { target: { value: "strength" } });
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 1 รายการ" })).toHaveTextContent(trainers[0].displayName);

    fireEvent.change(screen.getByLabelText("ประเภทการฝึก"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("ค่าฝึกต่อครั้ง"), { target: { value: "under_700" } });
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 2 รายการ" })).not.toHaveTextContent(trainers[2].displayName);

    fireEvent.click(screen.getByLabelText("เฉพาะโปรไฟล์ที่ตรวจแล้ว"));
    fireEvent.click(screen.getByLabelText("เฉพาะเทรนเนอร์ที่มีเวลาว่าง"));
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 2 รายการ" })).toBeInTheDocument();
  });

  it("sorts prices without mutating the source order", () => {
    const source = [...trainers];
    renderDiscovery(source);

    fireEvent.change(screen.getByLabelText("เรียงผลลัพธ์"), { target: { value: "price_desc" } });
    const cards = screen.getAllByRole("listitem");
    expect(within(cards[0]).getByRole("heading", { name: trainers[0].displayName })).toBeInTheDocument();
    expect(within(cards[1]).getByRole("heading", { name: trainers[1].displayName })).toBeInTheDocument();
    expect(source.map((trainer) => trainer.id)).toEqual(trainers.map((trainer) => trainer.id));
  });

  it("opens mobile filters with unique field ids", () => {
    renderDiscovery();

    fireEvent.click(screen.getByRole("button", { name: "เปิดตัวกรอง" }));
    expect(screen.getByRole("dialog", { name: "ตัวกรองเทรนเนอร์" })).toBeInTheDocument();
    expect(document.querySelector("#desktop-training-type")).toBeInTheDocument();
    expect(document.querySelector("#mobile-training-type")).toBeInTheDocument();
  });

  it("shows a useful empty state", () => {
    renderDiscovery();

    fireEvent.change(screen.getByRole("searchbox", { name: "ค้นหาชื่อหรือความเชี่ยวชาญ" }), {
      target: { value: "ไม่มีคำนี้ในระบบ" },
    });

    expect(screen.getByText("ยังไม่พบเทรนเนอร์ที่ตรงครบทุกข้อ")).toBeInTheDocument();
    expect(screen.getByText("ลองเปลี่ยนคำค้นหรือลดตัวกรองบางข้อ")).toBeInTheDocument();
  });
});
