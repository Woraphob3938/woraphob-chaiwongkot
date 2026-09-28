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
  it("preserves every search condition in the URL and profile return link", () => {
    const view = renderDiscovery();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: trainers[0].displayName } });
    fireEvent.change(screen.getByLabelText("หมวดหมู่ความเชี่ยวชาญ"), { target: { value: "strength" } });
    fireEvent.change(screen.getByLabelText("ราคาค่าจ้างต่อวัน/เดือน"), { target: { value: "under_700" } });
    fireEvent.click(screen.getByLabelText("เฉพาะโปรไฟล์ที่ตรวจแล้ว"));
    fireEvent.change(screen.getByLabelText("วันที่ว่าง"), { target: { value: "any" } });
    fireEvent.change(screen.getByLabelText("เรียงผลลัพธ์"), { target: { value: "price_desc" } });
    // The component mirrors its conditions into the URL; the return link is the
    // observable result of that, so assert on it rather than on replaceState,
    // which React schedules outside this test's control.
    const href = screen.getByRole("link", { name: "ดูโปรไฟล์และเลือกเวลา" }).getAttribute("href")!;
    const returnTo = new URL(href, window.location.origin).searchParams.get("returnTo")!;
    const saved = new URLSearchParams(returnTo.split("?")[1] ?? "");
    expect(saved.get("q")).toBe(trainers[0].displayName);
    expect(saved.get("type")).toBe("strength");
    expect(saved.get("price")).toBe("under_700");
    expect(saved.get("verified")).toBe("1");
    expect(saved.get("day")).toBe("any");
    expect(saved.get("sort")).toBe("price_desc");
    view.unmount();
    render(<TrainerDiscovery initialTrainers={trainers} trainingTypes={trainingTypes} initialQuery={saved.get("q")!} initialType={saved.get("type")!} initialFilters={Object.fromEntries(saved)} />);
    expect(screen.getByRole("searchbox")).toHaveValue(saved.get("q")!);
    expect(screen.getByLabelText("หมวดหมู่ความเชี่ยวชาญ")).toHaveValue("strength");
    expect(screen.getByLabelText("ราคาค่าจ้างต่อวัน/เดือน")).toHaveValue("under_700");
    expect(screen.getByLabelText("เฉพาะโปรไฟล์ที่ตรวจแล้ว")).toBeChecked();
    expect(screen.getByLabelText("วันที่ว่าง")).toHaveValue("any");
    expect(screen.getByLabelText("เรียงผลลัพธ์")).toHaveValue("price_desc");
    fireEvent.click(screen.getByRole("button", { name: "ล้างตัวกรองทั้งหมด" }));
    const clearedHref = screen.getAllByRole("link", { name: /^ดูโปรไฟล์/ })[0].getAttribute("href")!;
    const clearedReturn = new URL(clearedHref, window.location.origin).searchParams.get("returnTo")!;
    expect(clearedReturn).toBe("/trainers?sort=price_desc");
  });

  it("ignores invalid and repeated filter values in the URL", () => {
    render(<TrainerDiscovery initialTrainers={trainers} trainingTypes={trainingTypes} initialFilters={{ price: ["under_700"], rating: "invalid", sort: "invalid" }} />);
    expect(screen.getByLabelText("ราคาค่าจ้างต่อวัน/เดือน")).toHaveValue("all");
    expect(screen.getByLabelText("เรียงผลลัพธ์")).toHaveValue("availability");
    expect(window.location.search).toBe("");
  });

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
    expect(screen.getAllByRole("link", { name: "ดูโปรไฟล์และเลือกเวลา" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์" })).toBeInTheDocument();
    expect(screen.queryByText("เทรนเนอร์ที่เลือก")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เลือก .*ตรวจคุณสมบัติ/ })).not.toBeInTheDocument();
  });

  it("filters by specialty, fixed session price, verification, and availability", () => {
    const trainerWithoutSlots = { ...trainers[2], slots: [] };
    renderDiscovery([trainers[0], trainers[1], trainerWithoutSlots]);

    fireEvent.change(screen.getByLabelText("หมวดหมู่ความเชี่ยวชาญ"), { target: { value: "strength" } });
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 1 รายการ" })).toHaveTextContent(trainers[0].displayName);

    fireEvent.change(screen.getByLabelText("หมวดหมู่ความเชี่ยวชาญ"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("ราคาค่าจ้างต่อวัน/เดือน"), { target: { value: "under_700" } });
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 2 รายการ" })).not.toHaveTextContent(trainers[2].displayName);

    fireEvent.click(screen.getByLabelText("เฉพาะโปรไฟล์ที่ตรวจแล้ว"));
    fireEvent.change(screen.getByLabelText("วันที่ว่าง"), { target: { value: "any" } });
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

    fireEvent.click(screen.getByRole("button", { name: /^เปิดตัวกรอง/ }));
    expect(screen.getByRole("dialog", { name: "ตัวกรองเทรนเนอร์" })).toBeInTheDocument();
    expect(document.querySelector("#desktop-training-type")).toBeInTheDocument();
    expect(document.querySelector("#mobile-training-type")).toBeInTheDocument();
  });

  it("shows the active filter count and clears every search condition at once", () => {
    renderDiscovery();

    expect(screen.queryByRole("button", { name: "ล้างตัวกรองทั้งหมด" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "ค้นหาเทรนเนอร์" }), {
      target: { value: trainers[0].displayName },
    });
    fireEvent.change(screen.getByLabelText("หมวดหมู่ความเชี่ยวชาญ"), { target: { value: "strength" } });
    fireEvent.click(screen.getByLabelText("เฉพาะโปรไฟล์ที่ตรวจแล้ว"));

    expect(screen.getByRole("button", { name: /^เปิดตัวกรอง.*ใช้อยู่ 2 เงื่อนไข$/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ล้างตัวกรองทั้งหมด" }));

    expect(screen.getByRole("searchbox", { name: "ค้นหาเทรนเนอร์" })).toHaveValue("");
    expect(screen.getByLabelText("หมวดหมู่ความเชี่ยวชาญ")).toHaveValue("");
    expect(screen.getByLabelText("เฉพาะโปรไฟล์ที่ตรวจแล้ว")).not.toBeChecked();
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 3 รายการ" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ล้างตัวกรองทั้งหมด" })).not.toBeInTheDocument();
  });

  it("shows a useful empty state", () => {
    renderDiscovery();

    fireEvent.change(screen.getByRole("searchbox", { name: "ค้นหาเทรนเนอร์" }), {
      target: { value: "ไม่มีคำนี้ในระบบ" },
    });

    expect(screen.getByText("ยังไม่พบเทรนเนอร์ที่ตรงครบทุกข้อ")).toBeInTheDocument();
    expect(screen.getByText(/ลองเปลี่ยนคำค้นหรือลดตัวกรองบางข้อ/)).toBeInTheDocument();
  });
  it("uses the three filter headings exactly as named", () => {
    renderDiscovery();
    const rail = screen.getByRole("complementary", { name: "ตัวกรองเทรนเนอร์" });
    expect(within(rail).getByText("หมวดหมู่ความเชี่ยวชาญ")).toBeInTheDocument();
    expect(within(rail).getByText("ราคาค่าจ้างต่อวัน/เดือน")).toBeInTheDocument();
    expect(within(rail).getByText("ตารางเวลาที่ว่าง")).toBeInTheDocument();
    expect(within(rail).queryByText("ประเภทการฝึก")).not.toBeInTheDocument();
    expect(within(rail).queryByText("ค่าฝึกต่อครั้ง")).not.toBeInTheDocument();
  });

  it("filters by the monthly package price when the basis is per month", () => {
    const monthly = [
      { ...trainers[0], monthlyPrice: 4_500 },
      { ...trainers[1], monthlyPrice: 8_000 },
      { ...trainers[2], monthlyPrice: null },
    ];
    renderDiscovery(monthly);
    fireEvent.click(screen.getAllByRole("button", { name: "ต่อเดือน" })[0]);
    const price = screen.getByLabelText("ราคาค่าจ้างต่อวัน/เดือน");
    expect(within(price).getByRole("option", { name: /ไม่เกิน ฿5,000 ต่อเดือน/ })).toBeInTheDocument();
    fireEvent.change(price, { target: { value: "m_under_5000" } });
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 1 รายการ" })).toHaveTextContent(monthly[0].displayName);
  });

  it("filters by the time of day of a free slot on the Bangkok clock", () => {
    const at = (hour: number) => {
      const date = new Date(Date.now() + 2 * 86_400_000);
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
      return new Date(`${key}T${String(hour).padStart(2, "0")}:00:00+07:00`).toISOString();
    };
    const slot = (id: number, hour: number) => ({ id, startsAt: at(hour), endsAt: at(hour + 1), available: true });
    const pool = [
      { ...trainers[0], slots: [slot(1, 8)] },
      { ...trainers[1], slots: [slot(2, 19)] },
      { ...trainers[2], slots: [] },
    ];
    renderDiscovery(pool);
    fireEvent.change(screen.getByLabelText("วันที่ว่าง"), { target: { value: "week" } });
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 2 รายการ" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /^เย็น/ })[0]);
    expect(screen.getByRole("list", { name: "ผลการค้นหาเทรนเนอร์ 1 รายการ" })).toHaveTextContent(pool[1].displayName);
  });

  it("reads the legacy available=1 link as free on any day", () => {
    render(<TrainerDiscovery initialTrainers={trainers} trainingTypes={trainingTypes} initialFilters={{ available: "1" }} />);
    expect(screen.getByLabelText("วันที่ว่าง")).toHaveValue("any");
  });
});
