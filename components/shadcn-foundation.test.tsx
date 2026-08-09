import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";

describe("selective shadcn foundation", () => {
  it("renders FitConnect-owned accessible primitives", () => {
    render(
      <>
        <Button>ดำเนินการต่อ</Button>
        <Alert>
          <AlertTitle>ตรวจสอบข้อมูล</AlertTitle>
        </Alert>
      </>,
    );

    expect(
      screen.getByRole("button", { name: "ดำเนินการต่อ" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ตรวจสอบข้อมูล")).toBeInTheDocument();
  });
});
