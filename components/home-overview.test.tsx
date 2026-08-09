import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeOverview } from "@/components/home-overview";
import { trainers, trainingTypes } from "@/lib/demo-data";

describe("HomeOverview", () => {
  it("gives visitors a concise path into trainer discovery", () => {
    render(<HomeOverview trainers={trainers} trainingTypes={trainingTypes} isDemo />);

    expect(screen.getByRole("heading", { level: 1, name: /เริ่มต้นสุขภาพที่ดี/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ค้นหาเทรนเนอร์" })).toHaveAttribute("href", "/trainers");
    expect(screen.getAllByTestId("trainer-preview")).toHaveLength(Math.min(4, trainers.length));
    expect(screen.getByRole("link", { name: trainingTypes[0].nameTh })).toHaveAttribute(
      "href",
      `/trainers?type=${trainingTypes[0].slug}`,
    );
    expect(screen.getByText(/ผู้ดูแลตรวจหลักฐานด้วยตนเอง/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "กรองเทรนเนอร์" })).not.toBeInTheDocument();
  });

  it("keeps every overview section useful when the catalog is empty", () => {
    render(<HomeOverview trainers={[]} trainingTypes={[]} isDemo={false} />);

    expect(screen.getByText("ยังไม่มีประเภทการฝึกให้เลือก")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีเทรนเนอร์ในรายการแนะนำ")).toBeInTheDocument();
    expect(screen.queryByTestId("trainer-preview")).not.toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลสาธิต/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูเทรนเนอร์ทั้งหมด" })).toHaveAttribute("href", "/trainers");
  });

  it("prioritizes the first portrait even when an earlier preview has no image", () => {
    const trainerWithoutImage = { ...trainers[0], image: undefined };
    const trainerWithImage = { ...trainers[1], image: trainers[1].image ?? "/demo/trainer-b.png" };

    render(
      <HomeOverview
        trainers={[trainerWithoutImage, trainerWithImage]}
        trainingTypes={trainingTypes}
        isDemo
      />,
    );

    expect(screen.getByRole("img")).not.toHaveAttribute("loading", "lazy");
  });

  it("describes the journey through observable member actions", () => {
    render(<HomeOverview trainers={trainers} trainingTypes={trainingTypes} isDemo />);

    expect(
      screen.getByText("ดูเส้นทางตั้งแต่เลือกเทรนเนอร์ ส่งคำขอ อัปโหลดสลิป จนถึงเขียนรีวิวหลังการฝึก"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลการจองชุดเดียวกัน/)).not.toBeInTheDocument();
  });
});
