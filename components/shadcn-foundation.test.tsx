import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

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

  it("uses Thai-first, touch-safe defaults for interactive primitives", () => {
    render(
      <>
        <Button data-testid="button">ดำเนินการต่อ</Button>
        <Input aria-label="ชื่อ" />
        <NativeSelect aria-label="เป้าหมาย">
          <option>ลดน้ำหนัก</option>
        </NativeSelect>
        <Badge>สถานะ</Badge>
      </>,
    );

    expect(screen.getByTestId("button")).toHaveClass("h-11");
    expect(screen.getByRole("textbox", { name: "ชื่อ" })).toHaveClass("h-11");
    expect(screen.getByRole("combobox", { name: "เป้าหมาย" })).toHaveClass("h-11");
    expect(screen.getByText("สถานะ")).toHaveClass("bg-secondary");
    expect(buttonVariants({ size: "icon-sm" })).toContain("size-11");
    expect(buttonVariants({ size: "xs" })).toContain("h-11");
  });
});
