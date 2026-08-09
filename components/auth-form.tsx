"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, CircleAlert, LoaderCircle, LockKeyhole, Mail, UserRound } from "lucide-react";
import { apiRequest, authenticatedRequest } from "@/lib/api";
import { resolvePostAuthDestination } from "@/lib/post-auth-destination";
import type { AuthenticatedUser, TrainerWorkspace } from "@/lib/types";

type AuthFormProps = {
  mode: "login" | "register";
  navigate?: (href: string) => void;
};

export function AuthForm({ mode, navigate = (href) => window.location.assign(href) }: AuthFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(null);

  async function continueToWorkspace(user: AuthenticatedUser) {
    setPending(true);
    setMessage({ tone: "success", text: "เชื่อมต่อบัญชีสำเร็จ กำลังตรวจพื้นที่ใช้งานของคุณ" });
    try {
      const destination = await resolvePostAuthDestination(
        user,
        () => authenticatedRequest<TrainerWorkspace>("/v1/trainer/me"),
      );
      navigate(destination);
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "ตรวจสถานะเทรนเนอร์ไม่สำเร็จ",
      });
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);
    const payload = Object.fromEntries(data.entries());
    try {
      const result = await apiRequest<{ token: string; user: AuthenticatedUser }>(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      localStorage.setItem("fitconnect_token", result.token);
      localStorage.setItem("fitconnect_user", JSON.stringify(result.user));
      window.dispatchEvent(new CustomEvent("fitconnect:auth", { detail: result.user }));
      setAuthenticatedUser(result.user);
      await continueToWorkspace(result.user);
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "เข้าสู่ระบบไม่สำเร็จ โปรดตรวจการเชื่อมต่อ XAMPP" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={onSubmit}>
      {mode === "register" && (
        <div className="field">
          <label htmlFor="display-name">ชื่อที่ใช้ในระบบ</label>
          <div className="input-with-icon"><UserRound aria-hidden="true" size={17} /><input id="display-name" name="displayName" autoComplete="name" required /></div>
        </div>
      )}
      <div className="field">
        <label htmlFor="email">อีเมล</label>
        <div className="input-with-icon"><Mail aria-hidden="true" size={17} /><input id="email" name="email" type="email" autoComplete="email" required /></div>
      </div>
      <div className="field">
        <label htmlFor="password">รหัสผ่าน</label>
        <div className="input-with-icon"><LockKeyhole aria-hidden="true" size={17} /><input id="password" name="password" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required /></div>
      </div>
      {mode === "register" && (
        <div className="field">
          <label htmlFor="role">ฉันต้องการใช้งานในฐานะ</label>
          <select id="role" name="role" defaultValue="member">
            <option value="member">สมาชิกที่กำลังหาเทรนเนอร์</option>
            <option value="trainer">เทรนเนอร์</option>
          </select>
        </div>
      )}
      <div className="form-message-slot" aria-live="polite">
        {message && <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}><CircleAlert aria-hidden="true" size={18} /> {message.text}</div>}
      </div>
      {authenticatedUser && message?.tone === "error" && (
        <button className="button button--ghost button--wide" type="button" disabled={pending} onClick={() => void continueToWorkspace(authenticatedUser)}>
          ตรวจสถานะอีกครั้ง
        </button>
      )}
      <button className="button button--accent button--wide" type="submit" disabled={pending}>
        {pending ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังเชื่อมต่อ</> : <>{mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี"} <ArrowRight aria-hidden="true" size={18} /></>}
      </button>
      <p className="form-switch">
        {mode === "login" ? <>ยังไม่มีบัญชี? <Link href="/register">สมัครสมาชิก</Link></> : <>มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link></>}
      </p>
    </form>
  );
}
