"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  CircleAlert,
  Dumbbell,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserCheck,
  UserRound,
} from "lucide-react";
import { apiRequest, authenticatedRequest } from "@/lib/api";
import { resolvePostAuthDestination } from "@/lib/post-auth-destination";
import type { AuthenticatedUser, TrainerWorkspace } from "@/lib/types";

type AuthFormProps = {
  mode: "login" | "register";
  navigate?: (href: string) => void;
};

const defaultNavigate = (href: string) => window.location.assign(href);

function readStoredUser(): AuthenticatedUser | null {
  if (typeof window === "undefined" || !localStorage.getItem("fitconnect_token")) return null;
  try {
    const user = JSON.parse(localStorage.getItem("fitconnect_user") ?? "null") as AuthenticatedUser | null;
    return user && ["member", "trainer", "admin"].includes(user.role) ? user : null;
  } catch {
    return null;
  }
}

function getSafeRedirectUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get("redirect");
    if (!redirect) return null;
    if (redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.includes("\\")) {
      return redirect;
    }
  } catch {
    return null;
  }
  return null;
}

export function AuthForm({ mode, navigate = defaultNavigate }: AuthFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(readStoredUser);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [role, setRole] = useState<"member" | "trainer">("member");

  const continueToWorkspace = useCallback(async (user: AuthenticatedUser) => {
    setPending(true);
    setMessage({ tone: "success", text: "เชื่อมต่อบัญชีสำเร็จ กำลังตรวจพื้นที่ใช้งานของคุณ" });
    try {
      const safeRedirect = getSafeRedirectUrl();
      if (user.role === "member" && safeRedirect) {
        navigate(safeRedirect);
        return;
      }
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
  }, [navigate]);

  useEffect(() => {
    if (!authenticatedUser) return;
    const redirect = window.setTimeout(() => void continueToWorkspace(authenticatedUser), 0);
    return () => window.clearTimeout(redirect);
  }, [authenticatedUser, continueToWorkspace]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const data = new FormData(event.currentTarget);

    if (mode === "register") {
      const password = String(data.get("password") || "");
      const confirmPassword = String(data.get("confirmPassword") || "");
      if (confirmPassword && password !== confirmPassword) {
        setMessage({ tone: "error", text: "รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน โปรดตรวจสอบอีกครั้ง" });
        setPending(false);
        return;
      }
    }

    const payload: Record<string, unknown> = {
      email: data.get("email"),
      password: data.get("password"),
    };
    if (mode === "register") {
      payload.displayName = data.get("displayName");
      payload.role = data.get("role") || role;
    }

    try {
      const result = await apiRequest<{ token: string; user: AuthenticatedUser }>(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      localStorage.setItem("fitconnect_token", result.token);
      localStorage.setItem("fitconnect_user", JSON.stringify(result.user));
      window.dispatchEvent(new CustomEvent("fitconnect:auth", { detail: result.user }));
      setAuthenticatedUser(result.user);
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
          <label htmlFor="role">ฉันต้องการใช้งานในฐานะ</label>
          <div className="role-selector-grid" role="group" aria-label="เลือกบทบาทการใช้งาน">
            <button
              type="button"
              className={`role-card ${role === "member" ? "role-card--active" : ""}`}
              onClick={() => setRole("member")}
              aria-pressed={role === "member"}
              aria-label="สมาชิกทั่วไป ค้นหาและจองเทรนเนอร์"
            >
              <UserCheck aria-hidden="true" size={20} />
              <div>
                <strong>สมาชิกทั่วไป</strong>
                <span>ค้นหาและจองเทรนเนอร์</span>
              </div>
            </button>

            <button
              type="button"
              className={`role-card ${role === "trainer" ? "role-card--active" : ""}`}
              onClick={() => setRole("trainer")}
              aria-pressed={role === "trainer"}
              aria-label="เทรนเนอร์ เปิดรับสอนและสร้างโปรไฟล์"
            >
              <Dumbbell aria-hidden="true" size={20} />
              <div>
                <strong>เทรนเนอร์</strong>
                <span>เปิดรับสอนและสร้างโปรไฟล์</span>
              </div>
            </button>
          </div>
          <select
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as "member" | "trainer")}
            className="sr-only"
            aria-label="ฉันต้องการใช้งานในฐานะ"
          >
            <option value="member">สมาชิกที่กำลังหาเทรนเนอร์</option>
            <option value="trainer">เทรนเนอร์</option>
          </select>
        </div>
      )}

      {mode === "register" && (
        <div className="field">
          <label htmlFor="display-name">ชื่อที่ใช้ในระบบ</label>
          <div className="input-with-icon">
            <UserRound aria-hidden="true" size={17} />
            <input id="display-name" name="displayName" autoComplete="name" placeholder="ชื่อหรือนามแฝงของคุณ" required />
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="email">อีเมล</label>
        <div className="input-with-icon">
          <Mail aria-hidden="true" size={17} />
          <input id="email" name="email" type="email" autoComplete="email" placeholder="name@example.com" required />
        </div>
      </div>

      <div className="field">
        <div className="field-header">
          <label htmlFor="password">รหัสผ่าน</label>
          {mode === "login" && (
            <button
              type="button"
              className="text-link text-link--subtle forgot-link"
              onClick={() => setMessage({ tone: "error", text: "หากลืมรหัสผ่าน โปรดติดต่อผู้ดูแลระบบเพื่อยืนยันตัวตนและรีเซ็ตรหัสผ่าน" })}
            >
              ลืมรหัสผ่าน?
            </button>
          )}
        </div>
        <div className="input-with-icon input-with-toggle">
          <LockKeyhole aria-hidden="true" size={17} />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            placeholder="••••••••"
            required
          />
          <button
            type="button"
            className="password-toggle-btn"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            title={showPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
          >
            {showPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
          </button>
        </div>
        {mode === "register" && <span className="field-hint">ความยาวอย่างน้อย 8 ตัวอักษร</span>}
      </div>

      {mode === "register" && (
        <div className="field">
          <label htmlFor="confirm-password">ยืนยันรหัสผ่าน</label>
          <div className="input-with-icon input-with-toggle">
            <LockKeyhole aria-hidden="true" size={17} />
            <input
              id="confirm-password"
              name="confirmPassword"
              type={showConfirmPassword ? "text" : "password"}
              autoComplete="new-password"
              minLength={8}
              placeholder="••••••••"
              required
            />
            <button
              type="button"
              className="password-toggle-btn"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
              title={showConfirmPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
            >
              {showConfirmPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
            </button>
          </div>
        </div>
      )}

      <div className="form-message-slot" aria-live="polite">
        {message && (
          <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            <CircleAlert aria-hidden="true" size={18} /> {message.text}
          </div>
        )}
      </div>

      {authenticatedUser && message?.tone === "error" && (
        <button className="button button--ghost button--wide" type="button" disabled={pending} onClick={() => void continueToWorkspace(authenticatedUser)}>
          ตรวจสถานะอีกครั้ง
        </button>
      )}

      <button className="button button--accent button--wide" type="submit" disabled={pending}>
        {pending ? (
          <>
            <LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังเชื่อมต่อ...
          </>
        ) : (
          <>
            {mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี"} <ArrowRight aria-hidden="true" size={18} />
          </>
        )}
      </button>

      <p className="form-switch">
        {mode === "login" ? (
          <>
            ยังไม่มีบัญชี? <Link href="/register">สร้างบัญชีสมาชิก</Link>
          </>
        ) : (
          <>
            มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link>
          </>
        )}
      </p>
    </form>
  );
}
