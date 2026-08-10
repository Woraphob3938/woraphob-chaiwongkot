import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrainerMarketplaceCard } from "@/components/trainer-marketplace-card";
import { trainers } from "@/lib/demo-data";

describe("TrainerMarketplaceCard", () => {
  it("shows fixed-price and next-slot facts with one profile CTA", () => {
    render(<TrainerMarketplaceCard trainer={trainers[0]} />);

    expect(screen.getByRole("heading", { name: trainers[0].displayName })).toBeInTheDocument();
    expect(screen.getByText("ค่าฝึกต่อครั้ง")).toBeInTheDocument();
    expect(screen.getByText("฿650")).toBeInTheDocument();
    expect(screen.getByText(/ว่างเร็วสุด/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `รูปโปรไฟล์ของ${trainers[0].displayName}` })).toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลสาธิต|ภาพสังเคราะห์/)).not.toBeInTheDocument();
    expect(screen.queryByText(/คะแนน/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์และเลือกเวลา" })).toHaveAttribute(
      "href",
      `/trainers/${trainers[0].slug}`,
    );
  });
});
