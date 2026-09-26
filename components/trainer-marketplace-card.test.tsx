import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrainerMarketplaceCard } from "@/components/trainer-marketplace-card";
import { API_URL } from "@/lib/api";
import { trainers } from "@/lib/demo-data";

describe("TrainerMarketplaceCard", () => {
  it("shows fixed-price and next-slot facts with one profile CTA", () => {
    render(<TrainerMarketplaceCard trainer={trainers[0]} />);

    expect(screen.getByRole("heading", { name: trainers[0].displayName })).toBeInTheDocument();
    expect(screen.getByText("ค่าฝึกต่อครั้ง")).toBeInTheDocument();
    expect(screen.getByText("฿650")).toBeInTheDocument();
    expect(screen.getByText(/ว่างเร็วสุด/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `รูปโปรไฟล์ของ${trainers[0].displayName}` })).toBeInTheDocument();
    expect(screen.getByText("ภาพสาธิต")).toBeInTheDocument();
    expect(screen.queryByText(/ข้อมูลสาธิต|ภาพสังเคราะห์/)).not.toBeInTheDocument();
    expect(screen.queryByText(/คะแนน/)).not.toBeInTheDocument();
    expect(screen.getByText("ยังไม่มีรีวิว")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `ดูโปรไฟล์ของ${trainers[0].displayName}` })).toHaveAttribute(
      "href",
      `/trainers/${trainers[0].slug}`,
    );
    expect(
      within(screen.getByRole("heading", { name: trainers[0].displayName })).getByRole("link"),
    ).toHaveAttribute("href", `/trainers/${trainers[0].slug}`);
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์และเลือกเวลา" })).toHaveAttribute(
      "href",
      `/trainers/${trainers[0].slug}`,
    );
  });

  it("does not promise time selection when the trainer is not ready for booking", () => {
    const trainer = { ...trainers[2], slots: [], priceFrom: undefined };

    render(<TrainerMarketplaceCard trainer={trainer} />);

    expect(screen.getByText("ยังไม่มีเวลาว่าง")).toBeInTheDocument();
    expect(screen.getByText("ยังไม่กำหนด")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์" })).toHaveAttribute(
      "href",
      `/trainers/${trainer.slug}`,
    );
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์" })).toHaveAttribute("data-variant", "outline");
    expect(screen.queryByRole("link", { name: "ดูโปรไฟล์และเลือกเวลา" })).not.toBeInTheDocument();
  });

  it("resolves a live profile image against the API origin, not the Next origin", () => {
    // The API answers with a relative `/v1/profile-images/...` path; passing it
    // to next/image unchanged made the optimizer fetch it from Next and 400.
    const trainer = { ...trainers[0], image: "/v1/profile-images/trainer/2" };

    render(<TrainerMarketplaceCard trainer={trainer} />);

    const image = screen.getByRole("img", { name: `รูปโปรไฟล์ของ${trainer.displayName}` });
    expect(decodeURIComponent(image.getAttribute("src") ?? "")).toContain(`${API_URL}/v1/profile-images/trainer/2`);
  });
});
