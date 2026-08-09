import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { trainers } from "@/lib/demo-data";
import { TrainerPreviewCard } from "@/components/trainer-preview-card";

describe("TrainerPreviewCard", () => {
  it("shows a compact verified trainer profile without the biography", () => {
    const trainer = trainers[0];

    render(<TrainerPreviewCard trainer={trainer} />);

    expect(screen.getByRole("heading", { name: trainer.displayName })).toBeInTheDocument();
    expect(screen.getByText(trainer.province.nameTh)).toBeInTheDocument();
    expect(screen.getByText("ตรวจคุณสมบัติแล้ว")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูโปรไฟล์" })).toHaveAttribute("href", `/trainers/${trainer.slug}`);
    expect(screen.queryByText(trainer.bio)).not.toBeInTheDocument();
  });
});
