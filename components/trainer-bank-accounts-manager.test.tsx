import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerBankAccountsManager } from "@/components/trainer-bank-accounts-manager";
import { authenticatedRequest } from "@/lib/api";
import type { TrainerBankAccount } from "@/lib/types";

vi.mock("@/lib/api", () => ({ authenticatedRequest: vi.fn() }));

const banks = ["กสิกรไทย", "กรุงเทพ"];
const kbank: TrainerBankAccount = { id: 1, bankName: "กสิกรไทย", accountName: "สมชาย ใจดี", accountNumber: "1234567890", isDefault: true, createdAt: "2026-09-01T00:00:00.000Z" };
const bbl: TrainerBankAccount = { id: 2, bankName: "กรุงเทพ", accountName: "สมชาย ใจดี", accountNumber: "9876543210", isDefault: false, createdAt: "2026-09-02T00:00:00.000Z" };

describe("TrainerBankAccountsManager", () => {
  beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

  it("lists accounts with the default one marked", async () => {
    vi.mocked(authenticatedRequest).mockResolvedValueOnce({ banks, accounts: [kbank, bbl] });
    render(<TrainerBankAccountsManager />);
    const list = await screen.findByRole("list", { name: "บัญชีธนาคารของฉัน" });
    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("บัญชีเริ่มต้น");
    expect(items[0]).toHaveTextContent("123-4-56789-0");
    expect(within(items[1]).getByRole("button", { name: /เป็นบัญชีเริ่มต้น/ })).toBeInTheDocument();
  });

  it("validates, then adds a bank account without dashes", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({ banks, accounts: [] })
      .mockResolvedValueOnce({ accounts: [kbank] });
    render(<TrainerBankAccountsManager />);
    fireEvent.click(await screen.findByRole("button", { name: "เพิ่มบัญชีธนาคาร" }));
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มบัญชี" }));
    expect(screen.getByText("เลือกธนาคาร", { selector: "small" })).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("ธนาคาร"), { target: { value: "กสิกรไทย" } });
    fireEvent.change(screen.getByLabelText("ชื่อบัญชี"), { target: { value: " สมชาย ใจดี " } });
    fireEvent.change(screen.getByLabelText("เลขบัญชี"), { target: { value: "123-4-56789-0" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มบัญชี" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenLastCalledWith("/v1/trainer/bank-accounts", {
      method: "POST",
      body: JSON.stringify({ bankName: "กสิกรไทย", accountName: "สมชาย ใจดี", accountNumber: "1234567890", isDefault: false }),
    }));
    expect(await screen.findByText("เพิ่มบัญชีธนาคารแล้ว")).toBeInTheDocument();
  });

  it("sets another account as the default", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce({ banks, accounts: [kbank, bbl] })
      .mockResolvedValueOnce({ accounts: [{ ...bbl, isDefault: true }, { ...kbank, isDefault: false }] });
    render(<TrainerBankAccountsManager />);
    fireEvent.click(await screen.findByRole("button", { name: "ตั้ง กรุงเทพ 3210 เป็นบัญชีเริ่มต้น" }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenLastCalledWith("/v1/trainer/bank-accounts/2/default", { method: "POST" }));
    expect(await screen.findByText("ตั้ง กรุงเทพ เป็นบัญชีเริ่มต้นแล้ว")).toBeInTheDocument();
  });
});
