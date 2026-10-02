import { AuthForm } from "@/components/auth-form";
import { CheckCircle2, ShieldCheck, Zap } from "lucide-react";
import { sanitizeRedirectPath } from "@/lib/post-auth-destination";

export const metadata = { title: "เข้าสู่ระบบ" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string; redirect?: string; email?: string }>;
}) {
  const params = await searchParams;
  const initialMessage = params.reset === "done"
    ? { tone: "success" as const, text: "ตั้งรหัสผ่านใหม่แล้ว เข้าสู่ระบบด้วยรหัสผ่านใหม่ได้เลย" }
    : null;
  // Resolved here rather than in the browser: the form cannot know whether a
  // token it holds is still valid, so it must not decide before reading this.
  const redirectTo = sanitizeRedirectPath(params.redirect);

  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <span className="auth-badge">บัญชีเดียวใช้ได้ทุกบทบาท</span>
        <h1>ข้อมูลเดียวกัน<br />ทุกสถานะ</h1>
        <p>ศูนย์กลางข้อมูลการฝึกแบบมืออาชีพ เชื่อมต่อสมาชิกและเทรนเนอร์ด้วยความโปร่งใสและหลักฐานจริง</p>

        <ul className="auth-features" aria-label="จุดเด่นของระบบ">
          <li className="auth-feature-item">
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <strong>คุณสมบัติที่ตรวจแล้ว</strong>
              <span>ผู้ดูแลระบบอ่านใบรับรองของเทรนเนอร์แต่ละคนก่อนโปรไฟล์ขึ้นหน้าค้นหา</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <Zap aria-hidden="true" size={20} />
            <div>
              <strong>ยืนยันก่อนชำระเงิน</strong>
              <span>เทรนเนอร์ตอบรับแล้วสมาชิกชำระเงินออนไลน์ภายใน 10 นาที</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <CheckCircle2 aria-hidden="true" size={20} />
            <div>
              <strong>ทุกขั้นตอนอยู่ในที่เดียว</strong>
              <span>ติดตามคำขอ หลักฐานการชำระเงิน สนทนา และรีวิวจากหน้าเดียวกัน</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="auth-panel">
        <p className="label">เข้าสู่ระบบ</p>
        <h2>ยินดีต้อนรับกลับ</h2>
        <AuthForm
          mode="login"
          initialMessage={initialMessage}
          redirectTo={redirectTo}
          initialEmail={params.email ?? ""}
        />
        <p className="connection-note">เซสชันอยู่ได้ 30 วัน และปุ่มออกจากระบบจะเพิกถอนทันที</p>
      </section>
    </main>
  );
}
