import { describe, expect, it } from "vitest";
import { maskPromptPayId, promptPayPayload } from "@/lib/promptpay";

describe("promptPayPayload", () => {
  it("creates a dynamic Thai QR payload with the fixed booking amount", () => {
    const payload = promptPayPayload("081-234-5678", 650);
    expect(payload).toContain("01130066812345678");
    expect(payload).toContain("5303764");
    expect(payload).toContain("5406650.00");
    expect(payload).toMatch(/6304[A-F0-9]{4}$/);
  });

  it("rejects an invalid recipient and masks valid identifiers", () => {
    expect(() => promptPayPayload("123", 650)).toThrow(/พร้อมเพย์/);
    expect(maskPromptPayId("0812345678")).toBe("081••••678");
  });
});
