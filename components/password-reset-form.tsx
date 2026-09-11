"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, KeyRound, LoaderCircle, MailCheck } from "lucide-react";
import { ApiError, apiRequest } from "@/lib/api";
import { Input } from "@/components/ui/input";

/**
 * Two steps, one component: ask for a code, then set the password with it. The
 * backend answers the first step identically for every address, so the copy here
 * must not promise that the message was sent to a known account.
 */
export function PasswordResetForm({ initialEmail = "" }: { initialEmail?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [stage, setStage] = useState<"request" | "confirm">("request");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!email.trim()) {
      setFields({ email: "กรอกอีเมลที่ใช้สมัคร" });
      return;
    }
    setPending(true);
    setFields({});
    setMessage(null);
    try {
      const result = await apiRequest<{ message: string }>("/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim() }),
      });
      setStage("confirm");
      setMessage({ tone: "success", text: result.message });
    } catch (error) {
      if (error instanceof ApiError) setFields(error.fields);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "ขอรหัสไม่สำเร็จ" });
    } finally {
      setPending(false);
    }
  }

  async function confirmReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const nextFields: Record<string, string> = {};
    if (code.replace(/\D/g, "").length !== 6) nextFields.code = "กรอกรหัส 6 หลักจากอีเมล";
    if (newPassword.length < 8) nextFields.newPassword = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
    if (newPassword !== confirmPassword) nextFields.confirmPassword = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
    if (Object.keys(nextFields).length > 0) {
      setFields(nextFields);
      return;
    }

    setPending(true);
    setFields({});
    setMessage(null);
    try {
      await apiRequest("/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), code: code.replace(/\D/g, ""), newPassword }),
      });
      router.push("/login?reset=done");
    } catch (error) {
      if (error instanceof ApiError) setFields(error.fields);
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "ตั้งรหัสผ่านใหม่ไม่สำเร็จ" });
    } finally {
      setPending(false);
    }
  }

  const fieldError = (key: string) => fields[key]
    ? <small className="field-error" id={`reset-${key}-error`} role="alert">{fields[key]}</small>
    : null;

  return (
    <div className="password-reset">
      {stage === "request" ? (
        <form className="auth-form" onSubmit={requestCode} noValidate aria-busy={pending}>
          <div className="field">
            <label htmlFor="reset-email">อีเมลที่ใช้สมัคร</label>
            <div className="input-with-icon">
              <MailCheck aria-hidden="true" size={17} />
              <Input
                id="reset-email"
                type="email"
                autoComplete="email"
                value={email}
                aria-invalid={Boolean(fields.email)}
                aria-describedby={fields.email ? "reset-email-error" : undefined}
                onChange={(event) => { setEmail(event.target.value); setFields({}); }}
              />
            </div>
            {fieldError("email")}
          </div>
          <div className="form-message-slot" aria-live="polite">
            {message && (
              <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
                <CircleAlert aria-hidden="true" size={18} /> {message.text}
              </div>
            )}
          </div>
          <button className="button button--accent button--wide" type="submit" disabled={pending}>
            {pending
              ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังส่งรหัส</>
              : <>ส่งรหัสตั้งรหัสผ่านใหม่ <ArrowRight aria-hidden="true" size={18} /></>}
          </button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={confirmReset} noValidate aria-busy={pending}>
          <p className="password-reset__hint">
            กรอกรหัส 6 หลักที่ส่งไปที่ <strong>{email.trim()}</strong> รหัสใช้ได้ 15 นาทีและใช้ได้ครั้งเดียว
          </p>
          <div className="field">
            <label htmlFor="reset-code">รหัสยืนยัน</label>
            <div className="input-with-icon">
              <KeyRound aria-hidden="true" size={17} />
              <Input
                id="reset-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                aria-invalid={Boolean(fields.code)}
                aria-describedby={fields.code ? "reset-code-error" : undefined}
                onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setFields({}); }}
              />
            </div>
            {fieldError("code")}
          </div>
          <div className="field">
            <label htmlFor="reset-new-password">รหัสผ่านใหม่</label>
            <Input
              id="reset-new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={newPassword}
              aria-invalid={Boolean(fields.newPassword)}
              aria-describedby={fields.newPassword ? "reset-newPassword-error" : undefined}
              onChange={(event) => { setNewPassword(event.target.value); setFields({}); }}
            />
            <span className="field-hint">ความยาวอย่างน้อย 8 ตัวอักษร</span>
            {fieldError("newPassword")}
          </div>
          <div className="field">
            <label htmlFor="reset-confirm-password">ยืนยันรหัสผ่านใหม่</label>
            <Input
              id="reset-confirm-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              value={confirmPassword}
              aria-invalid={Boolean(fields.confirmPassword)}
              aria-describedby={fields.confirmPassword ? "reset-confirmPassword-error" : undefined}
              onChange={(event) => { setConfirmPassword(event.target.value); setFields({}); }}
            />
            {fieldError("confirmPassword")}
          </div>
          <div className="form-message-slot" aria-live="polite">
            {message && (
              <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
                <CircleAlert aria-hidden="true" size={18} /> {message.text}
              </div>
            )}
          </div>
          <button className="button button--accent button--wide" type="submit" disabled={pending}>
            {pending
              ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังบันทึก</>
              : <>ตั้งรหัสผ่านใหม่ <ArrowRight aria-hidden="true" size={18} /></>}
          </button>
          <button className="button button--ghost button--wide" type="button" disabled={pending} onClick={() => { setStage("request"); setMessage(null); setFields({}); }}>
            ขอรหัสใหม่
          </button>
        </form>
      )}
      <p className="connection-note">
        <Link className="text-link" href="/login">กลับไปหน้าเข้าสู่ระบบ</Link>
      </p>
    </div>
  );
}
