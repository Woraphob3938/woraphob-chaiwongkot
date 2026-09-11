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

  it("keeps portrait copy neutral for every trainer", () => {
    const demoTrainer = trainers[0];
    const liveTrainer = { ...trainers[1], demo: false };

    const { rerender } = render(<TrainerPreviewCard trainer={demoTrainer} />);
    expect(screen.getByRole("img", { name: `รูปโปรไฟล์ของ${demoTrainer.displayName}` })).toBeInTheDocument();
    expect(screen.queryByText("ภาพสังเคราะห์ · สาธิต")).not.toBeInTheDocument();

    rerender(<TrainerPreviewCard trainer={liveTrainer} />);
    expect(screen.getByRole("img", { name: `รูปโปรไฟล์ของ${liveTrainer.displayName}` })).toBeInTheDocument();
    expect(screen.queryByText("ภาพสังเคราะห์ · สาธิต")).not.toBeInTheDocument();
  });

  it("uses one accessible profile placeholder when a trainer has no portrait", () => {
    const trainer = { ...trainers[0], image: undefined };

    const { container } = render(<TrainerPreviewCard trainer={trainer} />);

    expect(screen.getByRole("img", { name: `ยังไม่มีรูปโปรไฟล์ของ${trainer.displayName}` })).toBeInTheDocument();
    expect(container.querySelector(".trainer-preview-card__initials")).not.toBeInTheDocument();
  });
});
