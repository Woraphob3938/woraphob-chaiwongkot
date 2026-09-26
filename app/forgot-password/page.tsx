import { PasswordResetForm } from "@/components/password-reset-form";
import { KeyRound, MailCheck, ShieldCheck } from "lucide-react";

export const metadata = { title: "ลืมรหัสผ่าน" };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <span className="auth-badge">บัญชี FITCONNECT</span>
        <h1>ตั้งรหัสผ่านใหม่<br />ด้วยรหัสทางอีเมล</h1>
        <p>ยืนยันด้วยอีเมลที่ใช้สมัคร ระบบจะส่งรหัส 6 หลักให้ใช้ครั้งเดียว แล้วให้คุณตั้งรหัสผ่านใหม่เอง</p>

        <ul className="auth-features" aria-label="ขั้นตอนการตั้งรหัสผ่านใหม่">
          <li className="auth-feature-item">
            <MailCheck aria-hidden="true" size={20} />
            <div>
              <strong>ขอรหัสทางอีเมล</strong>
              <span>ระบบตอบเหมือนกันทุกอีเมล จึงใช้ตรวจสอบไม่ได้ว่าอีเมลใดมีบัญชีอยู่</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <KeyRound aria-hidden="true" size={20} />
            <div>
              <strong>รหัสใช้ครั้งเดียว</strong>
              <span>รหัสมีอายุ 15 นาที และขอรหัสใหม่จะยกเลิกรหัสเดิมทันที</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <strong>ปิดเซสชันเดิมทั้งหมด</strong>
              <span>เมื่อตั้งรหัสใหม่สำเร็จ ระบบจะออกจากระบบทุกอุปกรณ์ที่ค้างอยู่</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="auth-panel">
        <p className="label">ตั้งรหัสผ่านใหม่</p>
        <h2>ยืนยันตัวตนด้วยอีเมล</h2>
        <PasswordResetForm initialEmail={email ?? ""} />
      </section>
    </main>
  );
}
