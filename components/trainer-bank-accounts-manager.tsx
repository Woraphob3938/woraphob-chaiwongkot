"use client";

import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import { Landmark, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { authenticatedRequest } from "@/lib/api";
import { formatBankAccountNumber } from "@/lib/payment-copy";
import type { TrainerBankAccount } from "@/lib/types";

type Draft = { bankName: string; accountName: string; accountNumber: string };
type FieldErrors = Partial<Record<keyof Draft, string>>;

const emptyDraft: Draft = { bankName: "", accountName: "", accountNumber: "" };
const MAX_ACCOUNTS = 5;

function validate(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.bankName) errors.bankName = "เลือกธนาคาร";
  const name = draft.accountName.trim();
  if (name.length < 2) errors.accountName = "กรอกชื่อบัญชี";
  if (!/^\d{10,15}$/.test(draft.accountNumber.replace(/[\s-]/g, ""))) errors.accountNumber = "เลขบัญชีเป็นตัวเลข 10–15 หลัก";
  return errors;
}

/**
 * บทที่ 3.1.3 ข้อ 3: the trainer adds the bank accounts they receive money in,
 * picks the default one members see at the payment step, and edits or removes
 * accounts. PromptPay and its QR stay in the manager beside this one.
 */
export function TrainerBankAccountsManager() {
  const formId = useId();
  const [accounts, setAccounts] = useState<TrainerBankAccount[] | null>(null);
  const [banks, setBanks] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [editingId, setEditingId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [makeDefault, setMakeDefault] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await authenticatedRequest<{ banks: string[]; accounts: TrainerBankAccount[] }>("/v1/trainer/bank-accounts");
      setBanks(Array.isArray(result?.banks) ? result.banks : []);
      setAccounts(Array.isArray(result?.accounts) ? result.accounts : []);
      setLoadError("");
    } catch (requestError) {
      setLoadError(requestError instanceof Error ? requestError.message : "โหลดบัญชีธนาคารไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!active) return;
      await load();
    }
    void run();
    return () => { active = false; };
  }, [load]);

  function startAdd() {
    setEditingId("new");
    setDraft(emptyDraft);
    setMakeDefault(false);
    setFieldErrors({});
    setMessage("");
    setError("");
  }

  function startEdit(account: TrainerBankAccount) {
    setEditingId(account.id);
    setDraft({ bankName: account.bankName, accountName: account.accountName, accountNumber: account.accountNumber });
    setFieldErrors({});
    setMessage("");
    setError("");
  }

  function closeForm() {
    setEditingId(null);
    setFieldErrors({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const errors = validate(draft);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPending("save");
    setError("");
    setMessage("");
    const body = {
      bankName: draft.bankName,
      accountName: draft.accountName.trim(),
      accountNumber: draft.accountNumber.replace(/[\s-]/g, ""),
      ...(editingId === "new" ? { isDefault: makeDefault } : {}),
    };
    try {
      const result = editingId === "new"
        ? await authenticatedRequest<{ accounts: TrainerBankAccount[] }>("/v1/trainer/bank-accounts", { method: "POST", body: JSON.stringify(body) })
        : await authenticatedRequest<{ accounts: TrainerBankAccount[] }>(`/v1/trainer/bank-accounts/${editingId}`, { method: "PATCH", body: JSON.stringify(body) });
      setAccounts(result.accounts);
      setMessage(editingId === "new" ? "เพิ่มบัญชีธนาคารแล้ว" : "บันทึกการแก้ไขบัญชีแล้ว");
      closeForm();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "บันทึกบัญชีไม่สำเร็จ");
    } finally {
      setPending(null);
    }
  }

  async function act(account: TrainerBankAccount, action: "default" | "delete") {
    if (pending) return;
    setPending(`${action}-${account.id}`);
    setError("");
    setMessage("");
    try {
      const result = action === "default"
        ? await authenticatedRequest<{ accounts: TrainerBankAccount[] }>(`/v1/trainer/bank-accounts/${account.id}/default`, { method: "POST" })
        : await authenticatedRequest<{ accounts: TrainerBankAccount[] }>(`/v1/trainer/bank-accounts/${account.id}`, { method: "DELETE" });
      setAccounts(result.accounts);
      setMessage(action === "default" ? `ตั้ง ${account.bankName} เป็นบัญชีเริ่มต้นแล้ว` : "ลบบัญชีแล้ว");
      if (editingId === account.id) closeForm();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "บันทึกไม่สำเร็จ");
    } finally {
      setPending(null);
    }
  }

  const field = (name: keyof Draft) => `${formId}-${name}`;

  return (
    <div className="profile-group bank-accounts-manager">
      <div className="profile-group__heading">
        <h3>บัญชีธนาคารรับเงิน</h3>
        <span>โอนเข้าบัญชี</span>
      </div>
      <p className="profile-group__hint">
        สมาชิกจะเห็นบัญชีเริ่มต้นในขั้นตอนชำระเงิน คู่กับ QR พร้อมเพย์ เพิ่มได้สูงสุด {MAX_ACCOUNTS} บัญชี
      </p>

      {loadError && <p className="profile-field-error" role="alert">{loadError}</p>}
      {accounts === null && !loadError && <p className="bank-accounts-manager__loading" role="status">กำลังโหลดบัญชี…</p>}

      {accounts !== null && accounts.length === 0 && editingId === null && (
        <div className="bank-accounts-manager__empty">
          <Landmark aria-hidden="true" size={22} />
          <p>ยังไม่มีบัญชีธนาคาร เพิ่มบัญชีแรกแล้วระบบจะตั้งเป็นบัญชีเริ่มต้นให้</p>
        </div>
      )}

      {accounts !== null && accounts.length > 0 && (
        <ul className="bank-account-list" aria-label="บัญชีธนาคารของฉัน">
          {accounts.map((account) => (
            <li key={account.id} className={`bank-account-item${account.isDefault ? " bank-account-item--default" : ""}`}>
              <div className="bank-account-item__icon" aria-hidden="true"><Landmark size={18} /></div>
              <div className="bank-account-item__body">
                <strong>{account.bankName}</strong>
                <span>{account.accountName}</span>
                <span className="bank-account-item__number">{formatBankAccountNumber(account.accountNumber)}</span>
              </div>
              {account.isDefault
                ? <span className="bank-account-item__badge"><Star aria-hidden="true" size={13} /> บัญชีเริ่มต้น</span>
                : (
                  <button className="button button--ghost" type="button" disabled={Boolean(pending)} onClick={() => void act(account, "default")} aria-label={`ตั้ง ${account.bankName} ${account.accountNumber.slice(-4)} เป็นบัญชีเริ่มต้น`}>
                    {pending === `default-${account.id}` ? "กำลังบันทึก…" : "ตั้งเป็นค่าเริ่มต้น"}
                  </button>
                )}
              <div className="bank-account-item__actions">
                <button className="icon-button" type="button" disabled={Boolean(pending)} onClick={() => startEdit(account)} aria-label={`แก้ไขบัญชี ${account.bankName} ${account.accountNumber.slice(-4)}`}>
                  <Pencil aria-hidden="true" size={16} />
                </button>
                <button className="icon-button icon-button--danger" type="button" disabled={Boolean(pending)} onClick={() => void act(account, "delete")} aria-label={`ลบบัญชี ${account.bankName} ${account.accountNumber.slice(-4)}`}>
                  <Trash2 aria-hidden="true" size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editingId !== null ? (
        <form className="bank-account-form" onSubmit={(event) => void submit(event)} noValidate aria-label={editingId === "new" ? "เพิ่มบัญชีธนาคาร" : "แก้ไขบัญชีธนาคาร"}>
          <div className="field">
            <label htmlFor={field("bankName")}>ธนาคาร</label>
            <select
              id={field("bankName")}
              value={draft.bankName}
              aria-invalid={Boolean(fieldErrors.bankName)}
              onChange={(event) => setDraft({ ...draft, bankName: event.target.value })}
            >
              <option value="">เลือกธนาคาร</option>
              {banks.map((bank) => <option key={bank} value={bank}>{bank}</option>)}
            </select>
            {fieldErrors.bankName && <small className="field-error">{fieldErrors.bankName}</small>}
          </div>
          <div className="field">
            <label htmlFor={field("accountName")}>ชื่อบัญชี</label>
            <input
              id={field("accountName")}
              value={draft.accountName}
              maxLength={190}
              autoComplete="name"
              aria-invalid={Boolean(fieldErrors.accountName)}
              onChange={(event) => setDraft({ ...draft, accountName: event.target.value })}
            />
            {fieldErrors.accountName && <small className="field-error">{fieldErrors.accountName}</small>}
          </div>
          <div className="field">
            <label htmlFor={field("accountNumber")}>เลขบัญชี</label>
            <input
              id={field("accountNumber")}
              value={draft.accountNumber}
              inputMode="numeric"
              maxLength={19}
              placeholder="เช่น 123-4-56789-0"
              aria-invalid={Boolean(fieldErrors.accountNumber)}
              onChange={(event) => setDraft({ ...draft, accountNumber: event.target.value })}
            />
            {fieldErrors.accountNumber && <small className="field-error">{fieldErrors.accountNumber}</small>}
          </div>
          {editingId === "new" && accounts !== null && accounts.length > 0 && (
            <label className="bank-account-form__check">
              <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
              ตั้งเป็นบัญชีเริ่มต้น
            </label>
          )}
          <div className="bank-account-form__actions">
            <button className="button" type="button" disabled={pending === "save"} onClick={closeForm}>ยกเลิก</button>
            <button className="button button--accent" type="submit" disabled={pending === "save"}>
              {pending === "save" ? "กำลังบันทึก…" : editingId === "new" ? "เพิ่มบัญชี" : "บันทึกการแก้ไข"}
            </button>
          </div>
        </form>
      ) : (
        accounts !== null && accounts.length < MAX_ACCOUNTS && (
          <button className="button bank-accounts-manager__add" type="button" onClick={startAdd}>
            <Plus aria-hidden="true" size={17} /> เพิ่มบัญชีธนาคาร
          </button>
        )
      )}

      {message && <p className="profile-success" role="status">{message}</p>}
      {error && <p className="profile-field-error" role="alert">{error}</p>}
    </div>
  );
}
