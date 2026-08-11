"use client";

import { FormEvent, useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authenticatedRequest } from "@/lib/api";

export function passwordFieldErrors(error: unknown) {
  return error && typeof error === "object" && "fields" in error
    ? (error as { fields: Record<string, string> }).fields
    : {};
}

export function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextFields: Record<string, string> = {};
    if (!currentPassword) nextFields.currentPassword = "กรุณากรอกรหัสผ่านปัจจุบัน";
    if (newPassword.length < 8) nextFields.newPassword = "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร";
    if (newPassword !== confirmPassword) nextFields.confirmPassword = "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน";
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      return;
    }

    setPending(true);
    setFields({});
    setMessage("");
    setError("");
    void authenticatedRequest<{ changed: boolean }>("/v1/profile/password", {
      method: "PATCH",
      body: JSON.stringify({ currentPassword, newPassword }),
    })
      .then(() => {
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
        setMessage("เปลี่ยนรหัสผ่านแล้ว");
      })
      .catch((saveError: unknown) => {
        setFields(passwordFieldErrors(saveError));
        const errorMessage = saveError && typeof saveError === "object" && "message" in saveError
          ? String(saveError.message)
          : "เปลี่ยนรหัสผ่านไม่สำเร็จ";
        setError(errorMessage);
      })
      .finally(() => setPending(false));
  }

  return (
    <section className="profile-section password-section" aria-labelledby="password-title">
      <div className="profile-section__heading">
        <div><p className="label">บัญชี</p><h2 id="password-title">ความปลอดภัย</h2></div>
        <p>ใช้รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร</p>
      </div>
      <form onSubmit={submit} noValidate>
        <div className="profile-form-grid">
          <div className="field field--full"><label htmlFor="current-password">รหัสผ่านปัจจุบัน</label><Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} aria-invalid={Boolean(fields.currentPassword)} onChange={(event) => { setCurrentPassword(event.target.value); setFields((current) => ({ ...current, currentPassword: "" })); }} />{fields.currentPassword && <small className="profile-field-error">{fields.currentPassword}</small>}</div>
          <div className="field"><label htmlFor="new-password">รหัสผ่านใหม่</label><Input id="new-password" type="password" autoComplete="new-password" value={newPassword} aria-invalid={Boolean(fields.newPassword)} onChange={(event) => { setNewPassword(event.target.value); setFields((current) => ({ ...current, newPassword: "" })); }} />{fields.newPassword && <small className="profile-field-error">{fields.newPassword}</small>}</div>
          <div className="field"><label htmlFor="confirm-password">ยืนยันรหัสผ่านใหม่</label><Input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} aria-invalid={Boolean(fields.confirmPassword)} onChange={(event) => { setConfirmPassword(event.target.value); setFields((current) => ({ ...current, confirmPassword: "" })); }} />{fields.confirmPassword && <small className="profile-field-error">{fields.confirmPassword}</small>}</div>
        </div>
        {error && <p className="profile-form-error" role="alert">{error}</p>}
        {message && <p className="profile-success" role="status">{message}</p>}
        <div className="profile-form-actions"><Button type="submit" disabled={pending}>{pending ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังเปลี่ยนรหัสผ่าน</> : <><KeyRound aria-hidden="true" /> เปลี่ยนรหัสผ่าน</>}</Button></div>
      </form>
    </section>
  );
}
