import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DisclosureSection } from "@/components/disclosure-section";

describe("DisclosureSection", () => {
  it("uses a native closed disclosure while keeping its content mounted", () => {
    const { container } = render(
      <DisclosureSection title="ใบรับรอง" summary="เอกสาร 2 รายการ">
        <p>หลักฐาน</p>
      </DisclosureSection>,
    );

    const title = screen.getByText("ใบรับรอง");
    const details = title.closest("details");
    const summary = container.querySelector("summary");

    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("หลักฐาน")).toBeInTheDocument();
    expect(summary).toHaveTextContent("ใบรับรอง");
    expect(summary).toHaveTextContent("เอกสาร 2 รายการ");
    expect(summary?.parentElement).toBe(details);
    expect(summary?.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("[role='button']")).not.toBeInTheDocument();
    expect(container.querySelector("div[tabindex]")).not.toBeInTheDocument();
  });

  it("supports an open default and caller styling", () => {
    render(
      <DisclosureSection title="ตารางว่างทั้งหมด" defaultOpen className="schedule-disclosure">
        <p>วันจันทร์ 09:00</p>
      </DisclosureSection>,
    );

    const details = screen.getByText("ตารางว่างทั้งหมด").closest("details");
    expect(details).toHaveAttribute("open");
    expect(details).toHaveClass("disclosure-section", "schedule-disclosure");
  });
});
