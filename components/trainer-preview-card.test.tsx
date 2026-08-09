import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { trainers } from "@/lib/demo-data";
import { TrainerPreviewCard } from "@/components/trainer-preview-card";

describe("TrainerPreviewCard", () => {
  it("shows a compact verified trainer profile without the biography", () => {
    const trainer = trainers[0];

    render(<TrainerPreviewCard trainer={trainer} />);

    expect(screen.getByRole("heading", { name: trainer.displayName })).toBeInTheDocument();
    expect(screen.queryByText(/สกลนคร|นครพนม/)).not.toBeInTheDocument();
    expect(screen.getByText("ตรวจคุณสมบัติแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์" })).toHaveAttribute("href", `/trainers/${trainer.slug}`);
    expect(screen.queryByText(trainer.bio)).not.toBeInTheDocument();
  });

  it("asks visitors to enquire when the live price is null", () => {
    render(<TrainerPreviewCard trainer={{ ...trainers[0], priceFrom: null }} />);

    expect(screen.getByText("สอบถามราคา")).toBeInTheDocument();
    expect(screen.queryByText(/฿0/)).not.toBeInTheDocument();
  });

  it("uses synthetic portrait wording only for demonstration trainers", () => {
    const demoTrainer = trainers[0];
    const liveTrainer = { ...trainers[1], demo: false };

    const { rerender } = render(<TrainerPreviewCard trainer={demoTrainer} />);
    expect(screen.getByRole("img", { name: `ภาพสังเคราะห์ของ${demoTrainer.displayName} ใช้เพื่อสาธิต` })).toBeInTheDocument();
    expect(screen.getByText("ภาพสังเคราะห์ · สาธิต")).toBeInTheDocument();

    rerender(<TrainerPreviewCard trainer={liveTrainer} />);
    expect(screen.getByRole("img", { name: `ภาพบุคคลของ${liveTrainer.displayName}` })).toBeInTheDocument();
    expect(screen.queryByText("ภาพสังเคราะห์ · สาธิต")).not.toBeInTheDocument();
  });
});
