import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrainerDiscovery } from "@/components/trainer-discovery";
import { provinces, trainers, trainingTypes } from "@/lib/demo-data";

function renderDiscovery() {
  return render(
    <TrainerDiscovery
      initialTrainers={trainers}
      provinces={provinces}
      trainingTypes={trainingTypes}
      isDemo={false}
    />,
  );
}

describe("TrainerDiscovery", () => {
  it("keeps search visible and groups the optional filters in a closed disclosure", () => {
    renderDiscovery();

    expect(screen.getByRole("searchbox", { name: "ชื่อหรือความเชี่ยวชาญ" })).toBeVisible();
    const filters = screen.getByText("ตัวกรองเพิ่มเติม").closest("details");
    expect(filters).not.toBeNull();
    expect(filters).not.toHaveAttribute("open");
    expect(within(filters as HTMLElement).getByLabelText("จังหวัด")).toBeInTheDocument();
    expect(within(filters as HTMLElement).getByLabelText("ประเภทการฝึก")).toBeInTheDocument();
    expect(within(filters as HTMLElement).getByLabelText("แสดงเฉพาะโปรไฟล์ที่ตรวจแล้ว")).toBeInTheDocument();
  });

  it("announces result count and exposes every trainer choice", () => {
    renderDiscovery();

    const results = screen.getByRole("region", { name: "ผลการค้นหาเทรนเนอร์ 3 รายการ" });
    expect(within(results).getByText("3 ผลลัพธ์")).toBeInTheDocument();
    for (const trainer of trainers) {
      expect(within(results).getByRole("button", { name: new RegExp(trainer.displayName) })).toBeInTheDocument();
    }
  });

  it("summarizes the selected trainer before the closed credential evidence and schedule", () => {
    renderDiscovery();

    expect(screen.getByRole("heading", { name: trainers[0].displayName })).toBeInTheDocument();
    const evidence = screen.getByText("หลักฐานและใบรับรอง").closest("details");
    expect(evidence).not.toBeNull();
    expect(evidence).not.toHaveAttribute("open");
    expect(within(evidence as HTMLElement).getByText(trainers[0].certificates[0].name)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: `ตารางว่างของ ${trainers[0].displayName}` })).toBeInTheDocument();
  });

  it("passes the selected trainer and slot to the booking strip, then clears the slot when trainer changes", () => {
    renderDiscovery();

    fireEvent.click(screen.getByRole("button", { name: /เทรนเนอร์สาธิต ก\..*สกลนคร/ }));
    const schedule = screen.getByRole("region", { name: `ตารางว่างของ ${trainers[0].displayName}` });
    fireEvent.click(within(schedule).getAllByRole("button")[0]);

    const bookingLink = screen.getByRole("link", { name: "ส่งคำขอจอง" });
    expect(bookingLink).toHaveAttribute(
      "href",
      `/booking?trainer=${trainers[0].slug}&slot=${trainers[0].slots[0].id}`,
    );

    fireEvent.click(screen.getByRole("button", { name: /เทรนเนอร์สาธิต ข\..*สกลนคร/ }));
    expect(screen.queryByRole("link", { name: "ส่งคำขอจอง" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกเวลา" })).toBeDisabled();
  });

  it("does not keep a slot when filtering changes the selected trainer", () => {
    renderDiscovery();

    const firstSchedule = screen.getByRole("region", { name: `ตารางว่างของ ${trainers[0].displayName}` });
    fireEvent.click(within(firstSchedule).getAllByRole("button")[0]);
    expect(screen.getByRole("link", { name: "ส่งคำขอจอง" })).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "ชื่อหรือความเชี่ยวชาญ" }), {
      target: { value: trainers[1].headline },
    });

    expect(screen.getByRole("heading", { name: trainers[1].displayName })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ส่งคำขอจอง" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เลือกเวลา" })).toBeDisabled();
  });
});
