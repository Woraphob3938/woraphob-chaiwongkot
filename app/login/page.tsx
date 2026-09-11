import { AuthForm } from "@/components/auth-form";
import { CheckCircle2, ShieldCheck, Zap } from "lucide-react";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>;
}) {
  const { reset } = await searchParams;
  const initialMessage = reset === "done"
    ? { tone: "success" as const, text: "ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย" }
    : null;

  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <span className="auth-badge">ATHLETE CREDENTIAL PLATFORM</span>
        <h1>ข้อมูลเดียวกัน<br />ทุกสถานะ</h1>
        <p>ศูนย์กลางข้อมูลการฝึกแบบมืออาชีพ เชื่อมต่อสมาชิกและเทรนเนอร์ด้วยความโปร่งใสและหลักฐานจริง</p>

        <ul className="auth-features" aria-label="จุดเด่นของระบบ">
          <li className="auth-feature-item">
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <strong>ตรวจสอบใบรับรองจริง</strong>
              <span>ผู้ดูแลระบบตรวจสอบเอกสารและคุณสมบัติเทรนเนอร์ทุกท่าน</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <Zap aria-hidden="true" size={20} />
            <div>
              <strong>ล็อกตารางเวลาทันที</strong>
              <span>เห็นเวลาว่างจริง เลือกจองและล็อกเวลาได้ตรงไปตรงมา</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <CheckCircle2 aria-hidden="true" size={20} />
            <div>
              <strong>รวมทุกขั้นตอนในที่เดียว</strong>
              <span>ติดตามคำขอ สลิปชำระเงิน สนทนา และรีวิวอย่างเป็นระบบ</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="auth-panel">
        <p className="label">เข้าสู่ระบบ FITCONNECT</p>
        <h2>ยินดีต้อนรับกลับ</h2>
        <AuthForm mode="login" initialMessage={initialMessage} />
        <p className="connection-note">🔒 ข้อมูลของคุณปลอดภัยและเชื่อมต่อตรงกับระบบ FitConnect</p>
      </section>
    </main>
  );
}
