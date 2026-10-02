import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HomeOverview } from "@/components/home-overview";
import { trainers, trainingTypes } from "@/lib/demo-data";

describe("HomeOverview", () => {
  it("gives visitors a concise path into trainer discovery", () => {
    const { container } = render(<HomeOverview trainers={trainers} trainingTypes={trainingTypes} />);

    expect(screen.getByRole("heading", { level: 1, name: /หาเทรนเนอร์ที่ใช่/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "เลือกจากเป้าหมายการฝึก" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /เริ่มหาเทรนเนอร์/ })).toHaveAttribute("href", "/trainers");
    expect(screen.queryByRole("heading", { name: /เริ่มต้นสุขภาพที่ดี/ })).not.toBeInTheDocument();
    expect(screen.queryByText("ดูภาพรวมบริการก่อนเปรียบเทียบเทรนเนอร์ที่ผ่านการตรวจสอบ")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "ค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
    expect(container.querySelector(".home-hero")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("trainer-preview")).toHaveLength(Math.min(4, trainers.length));
    expect(screen.getByRole("link", { name: "เวทเทรนนิ่ง" })).toHaveAttribute(
      "href",
      `/trainers?type=${trainingTypes[0].slug}`,
    );
    expect(screen.getByText(/การชำระเงินยืนยันอัตโนมัติผ่าน Stripe/)).toBeInTheDocument();
    expect(screen.getByText("เริ่มจากประเภทที่สนใจ แล้วปรับราคาและเวลาในหน้าค้นหา")).toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลสาธิต|ภาพสังเคราะห์/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ปรับพื้นที่/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "กรองเทรนเนอร์" })).not.toBeInTheDocument();
  });

  it("keeps every overview section useful when the catalog is empty", () => {
    render(<HomeOverview trainers={[]} trainingTypes={[]} />);

    expect(screen.getByText("ยังไม่มีประเภทการฝึกให้เลือก")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีเทรนเนอร์ในรายการแนะนำ")).toBeInTheDocument();
    expect(screen.queryByTestId("trainer-preview")).not.toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลสาธิต/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูเทรนเนอร์ทั้งหมด" })).toHaveAttribute("href", "/trainers");
  });

  it("keeps uneven training goals balanced and uses consistent Thai labels", () => {
    const unevenTrainingTypes = [
      ...trainingTypes.slice(0, 5),
      { id: 91, slug: "pilates", nameTh: "พิลาทิส" },
      { id: 92, slug: "sport-specific", nameTh: "เฉพาะเเต่ละกีฬา" },
    ];

    render(<HomeOverview trainers={[]} trainingTypes={unevenTrainingTypes} />);

    expect(screen.getByRole("link", { name: "เฉพาะแต่ละกีฬา" })).toHaveAttribute(
      "href",
      "/trainers?type=sport-specific",
    );
    expect(screen.getByRole("link", { name: "เวทเทรนนิ่ง" })).toBeInTheDocument();
    const lastGoal = screen.getByRole("link", { name: "เฉพาะแต่ละกีฬา" }).closest("li");
    expect(lastGoal).toHaveClass("home-training-types__item--wide");
    expect(screen.queryByText("เฉพาะเเต่ละกีฬา")).not.toBeInTheDocument();
    expect(screen.queryByText("เวทเทรนนิง")).not.toBeInTheDocument();
  });

  it("prioritizes the first portrait even when an earlier preview has no image", () => {
    const trainerWithoutImage = { ...trainers[0], image: undefined };
    const trainerWithImage = { ...trainers[1], image: trainers[1].image ?? "/demo/trainer-b.png" };

    render(
      <HomeOverview
        trainers={[trainerWithoutImage, trainerWithImage]}
        trainingTypes={trainingTypes}
      />,
    );

    expect(screen.getByRole("img", { name: `รูปโปรไฟล์ของ${trainerWithImage.displayName}` })).not.toHaveAttribute(
      "loading",
      "lazy",
    );
  });

  it("describes the journey through observable member actions", () => {
    render(<HomeOverview trainers={trainers} trainingTypes={trainingTypes} />);

    expect(
      screen.getByText("ดูเส้นทางตั้งแต่เลือกเทรนเนอร์ ส่งคำขอ ชำระเงินออนไลน์ จนถึงเขียนรีวิวหลังการฝึก"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลการจองชุดเดียวกัน/)).not.toBeInTheDocument();
    // The acceptance reaches the member right away.
    expect(screen.getByText("ระบบแจ้งผลการตอบรับให้คุณทันที เวลาฝึกยังเป็นเวลาที่คุณเลือก")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ชำระเงินภายใน 10 นาที" })).toBeInTheDocument();
  });
});
