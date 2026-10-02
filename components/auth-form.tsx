"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, Dumbbell, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, UserCheck, UserRound } from "lucide-react";
import { apiRequest, authenticatedRequest } from "@/lib/api";
import { resolveAuthRedirect, resolvePostAuthDestination } from "@/lib/post-auth-destination";
import { TOKEN_STORAGE_KEY, USER_STORAGE_KEY, readStoredUser } from "@/lib/session";
import type { AuthenticatedUser, TrainerWorkspace } from "@/lib/types";

type AuthFormProps = {
  mode: "login" | "register";
  navigate?: (href: string) => void;
  /** Comes from the server so the notice renders on the first paint. */
  initialMessage?: { tone: "error" | "success"; text: string } | null;
  /** Already validated on the server; an internal path or null. */
  redirectTo?: string | null;
  /** Filled in after a completed password reset. */
  initialEmail?: string;
};

const defaultNavigate = (href: string) => window.location.assign(href);

const minimumPasswordLength = 8;

type FieldErrors = Partial<Record<"displayName" | "email" | "password" | "confirmPassword", string>>;

/** Field keys in screen order, with the id of the input each one belongs to. */
const fieldIds = { displayName: "display-name", email: "email", password: "password", confirmPassword: "confirm-password" } as const;

function validate(mode: "login" | "register", fields: Record<keyof typeof fieldIds, string>): FieldErrors {
  const errors: FieldErrors = {};
  if (mode === "register" && fields.displayName.trim() === "") errors.displayName = "กรุณากรอกชื่อที่ใช้ในระบบ";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) errors.email = "กรุณากรอกอีเมลให้ถูกต้อง เช่น name@example.com";
  if (fields.password.length < minimumPasswordLength) errors.password = `รหัสผ่านต้องมีอย่างน้อย ${minimumPasswordLength} ตัวอักษร`;
  if (mode === "register" && fields.confirmPassword !== fields.password) errors.confirmPassword = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
  return errors;
}

export function AuthForm({
  mode,
  navigate = defaultNavigate,
  initialMessage = null,
  redirectTo = null,
  initialEmail = "",
}: AuthFormProps) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(initialMessage);
  const [authenticatedUser, setAuthenticatedUser] = useState<AuthenticatedUser | null>(readStoredUser);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [role, setRole] = useState<"member" | "trainer">("member");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const emailRef = useRef<HTMLInputElement>(null);
  // True once this form has authenticated someone, so the auto-continue effect
  // can tell an inherited session apart from the one it just created.
  const justAuthenticated = useRef(false);

  // A reset that just succeeded should not make the visitor retype the address.
  useEffect(() => {
    if (initialEmail !== "" && emailRef.current) emailRef.current.focus();
  }, [initialEmail]);

  const continueToWorkspace = useCallback(async (user: AuthenticatedUser, registered = false) => {
    setPending(true);
    setMessage({ tone: "success", text: "เชื่อมต่อบัญชีสำเร็จ กำลังตรวจพื้นที่ใช้งานของคุณ" });
    try {
      const destination = await resolvePostAuthDestination(user, () => authenticatedRequest<TrainerWorkspace>("/v1/trainer/me"));
      // A new member fills a short profile first, then goes where they were headed.
      if (registered && user.role === "member") {
        navigate(redirectTo ? `/member/welcome?next=${encodeURIComponent(redirectTo)}` : "/member/welcome");
        return;
      }
      navigate(resolveAuthRedirect(redirectTo, destination));
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "ตรวจสถานะเทรนเนอร์ไม่สำเร็จ" });
    } finally {
      setPending(false);
    }
  }, [navigate, redirectTo]);

  // A session already in this browser continues on its own, but only from the
  // sign-in form: someone who asked to register should see the form rather than
  // be moved somewhere without an explanation. When a destination was requested,
  // that destination wins over wherever the role would land.
  useEffect(() => {
    if (!authenticatedUser || justAuthenticated.current) return;
    if (redirectTo) {
      navigate(redirectTo);
      return;
    }
    if (mode !== "login") return;
    const redirect = window.setTimeout(() => void continueToWorkspace(authenticatedUser), 0);
    return () => window.clearTimeout(redirect);
  }, [authenticatedUser, continueToWorkspace, mode, navigate, redirectTo]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const errors = validate(mode, { displayName, email, password, confirmPassword });
    const firstInvalid = (Object.keys(fieldIds) as Array<keyof typeof fieldIds>).find((key) => errors[key]);
    if (firstInvalid) {
      setFieldErrors(errors);
      setMessage(null);
      document.getElementById(fieldIds[firstInvalid])?.focus();
      return;
    }

    setFieldErrors({});
    setPending(true);
    setMessage(null);

    try {
      const result = await apiRequest<{ token: string; user: AuthenticatedUser }>(`/v1/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify({ email: email.trim(), password, ...(mode === "register" && { displayName: displayName.trim(), role }) }),
      });
      localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(result.user));
      window.dispatchEvent(new CustomEvent("fitconnect:auth", { detail: result.user }));
      // Signing in here is an explicit request to continue, so the workspace
      // check runs even though the effect above stands down.
      justAuthenticated.current = true;
      setAuthenticatedUser(result.user);
      await continueToWorkspace(result.user, mode === "register");
    } catch (error) {
      setMessage({ tone: "error", text: error instanceof Error ? error.message : "ยังเชื่อมต่อบริการไม่ได้ กรุณาลองใหม่อีกครั้ง" });
    } finally {
      setPending(false);
    }
  }

  const passwordTooShort = password !== "" && password.length < minimumPasswordLength;
  const confirmMismatch = confirmPassword !== "" && confirmPassword !== password;

  function fieldError(id: string, message?: string) {
    if (!message) return null;
    return <small className="field-error" id={`${id}-error`} role="alert">{message}</small>;
  }

  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate aria-busy={pending}>
      {mode === "register" && (
        <fieldset className="field role-field">
          <legend>ฉันต้องการใช้งานในฐานะ</legend>
          {/* A radio group rather than buttons plus a hidden select: one control,
              one accessible name, and the choice is announced as a choice. */}
          <div className="role-selector-grid" role="radiogroup" aria-label="เลือกบทบาทการใช้งาน">
            {([
              { id: "member", label: "สมาชิกทั่วไป", detail: "ค้นหาและจองเทรนเนอร์", Icon: UserCheck },
              { id: "trainer", label: "เทรนเนอร์", detail: "ยื่นเอกสารและเปิดรับสอน", Icon: Dumbbell },
            ] as const).map(({ id, label, detail, Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={role === id}
                className={`role-card ${role === id ? "role-card--active" : ""}`}
                onClick={() => setRole(id)}
              >
                <Icon aria-hidden="true" size={20} />
                <span>
                  <strong>{label}</strong>{" "}
                  <small>{detail}</small>
                </span>
              </button>
            ))}
          </div>
          {role === "trainer" && (
            <small className="field-hint">
              บัญชีเทรนเนอร์ใช้ยื่นใบสมัครกับเอกสาร PDF และรอผู้ดูแลระบบตรวจก่อน โปรไฟล์จึงจะแสดงต่อสมาชิก
            </small>
          )}
        </fieldset>
      )}

      {mode === "register" && (
        <div className="field">
          <label htmlFor="display-name">ชื่อที่ใช้ในระบบ</label>
          <div className="input-with-icon">
            <UserRound aria-hidden="true" size={17} />
            <input
              id="display-name"
              name="displayName"
              autoComplete="name"
              value={displayName}
              aria-invalid={Boolean(fieldErrors.displayName)}
              aria-describedby={fieldErrors.displayName ? "display-name-error" : undefined}
              onChange={(event) => { setDisplayName(event.target.value); setFieldErrors((current) => ({ ...current, displayName: undefined })); }}
            />
          </div>
          {fieldError("display-name", fieldErrors.displayName)}
        </div>
      )}

      <div className="field">
        <label htmlFor="email">อีเมล</label>
        <div className="input-with-icon">
          <Mail aria-hidden="true" size={17} />
          <input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            aria-invalid={Boolean(fieldErrors.email)}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
            onChange={(event) => { setEmail(event.target.value); setFieldErrors((current) => ({ ...current, email: undefined })); }}
          />
        </div>
        {fieldError("email", fieldErrors.email)}
      </div>

      <div className="field">
        <div className="field-header">
          <label htmlFor="password">รหัสผ่าน</label>
          {mode === "login" && (
            <Link className="text-link text-link--subtle forgot-link" href="/forgot-password">ลืมรหัสผ่าน?</Link>
          )}
        </div>
        <div className="input-with-icon input-with-toggle">
          <LockKeyhole aria-hidden="true" size={17} />
          <input
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            value={password}
            aria-invalid={Boolean(fieldErrors.password || passwordTooShort)}
            aria-describedby={mode === "register" ? "password-rule" : undefined}
            onChange={(event) => { setPassword(event.target.value); setFieldErrors((current) => ({ ...current, password: undefined })); }}
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
        {/* The requirement is stated before submitting, not only after. */}
        {mode === "register" && (
          <span className={`field-hint${passwordTooShort ? " field-hint--warning" : ""}`} id="password-rule" aria-live="polite">
            {passwordTooShort
              ? `อีก ${minimumPasswordLength - password.length} ตัวอักษรจะครบ ${minimumPasswordLength} ตัวอักษร`
              : `ความยาวอย่างน้อย ${minimumPasswordLength} ตัวอักษร`}
          </span>
        )}
        {fieldError("password", fieldErrors.password)}
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
              value={confirmPassword}
              aria-invalid={Boolean(fieldErrors.confirmPassword || confirmMismatch)}
              aria-describedby={fieldErrors.confirmPassword ? "confirm-password-error" : undefined}
              onChange={(event) => { setConfirmPassword(event.target.value); setFieldErrors((current) => ({ ...current, confirmPassword: undefined })); }}
            />
            <button
              type="button"
              className="password-toggle-btn"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              aria-label={showConfirmPassword ? "ซ่อนรหัสผ่านยืนยัน" : "แสดงรหัสผ่านยืนยัน"}
              title={showConfirmPassword ? "ซ่อนรหัสผ่านยืนยัน" : "แสดงรหัสผ่านยืนยัน"}
            >
              {showConfirmPassword ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
            </button>
          </div>
          {fieldError("confirm-password", fieldErrors.confirmPassword)}
        </div>
      )}

      <div className="form-message-slot" aria-live="polite">
        {message && (
          <div className={`form-message form-message--${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            <CircleAlert aria-hidden="true" size={18} /> {message.text}
          </div>
        )}
      </div>

      {/* Only offered where a trainer's workspace check actually ran. */}
      {mode === "login" && authenticatedUser && message?.tone === "error" && (
        <button className="button button--ghost button--wide" type="button" disabled={pending} onClick={() => void continueToWorkspace(authenticatedUser)}>
          ตรวจสถานะอีกครั้ง
        </button>
      )}

      <button className="button button--accent button--wide" type="submit" disabled={pending}>
        {pending
          ? <><LoaderCircle className="spin" aria-hidden="true" size={18} /> กำลังเชื่อมต่อ...</>
          : <>{mode === "login" ? "เข้าสู่ระบบ" : "สร้างบัญชี"} <ArrowRight aria-hidden="true" size={18} /></>}
      </button>

      <p className="form-switch">
        {mode === "login"
          ? <>ยังไม่มีบัญชี? <Link href="/register">สร้างบัญชีสมาชิก</Link></>
          : <>มีบัญชีแล้ว? <Link href="/login">เข้าสู่ระบบ</Link></>}
      </p>
    </form>
  );
}
