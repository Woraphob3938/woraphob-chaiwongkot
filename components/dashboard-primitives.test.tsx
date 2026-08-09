import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardSection, NextActionCard } from "@/components/dashboard-primitives";

describe("dashboard primitives", () => {
  it("renders one next action with its semantic state", () => {
    render(
      <NextActionCard
        action={{
          title: "อัปโหลดสลิป",
          description: "คำขอ BK-TEST",
          href: "/member#booking-BK-TEST",
          cta: "ดำเนินการ",
          state: "action",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "อัปโหลดสลิป" })).toBeInTheDocument();
    expect(screen.getByText("คำขอ BK-TEST")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดำเนินการ" })).toHaveAttribute("href", "/member#booking-BK-TEST");
    expect(screen.getByTestId("next-action")).toHaveAttribute("data-state", "action");
  });

  it("names the optional section action from its title", () => {
    render(
      <DashboardSection title="คำขอจอง" action={{ href: "/member/bookings", label: "ดูทั้งหมด" }}>
        <p>รายการล่าสุด</p>
      </DashboardSection>,
    );

    expect(screen.getByRole("region", { name: "คำขอจอง" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ดูทั้งหมด: คำขอจอง" })).toHaveAttribute("href", "/member/bookings");
  });
});
