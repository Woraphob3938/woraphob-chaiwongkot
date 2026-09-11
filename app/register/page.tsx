import { AuthForm } from "@/components/auth-form";
import { CheckCircle2, Sparkles, UserCheck } from "lucide-react";

export const metadata = { title: "สร้างบัญชี" };

export default function RegisterPage() {
  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <span className="auth-badge">ONE ACCOUNT · FULL ACCESS</span>
        <h1>เริ่มจากบัญชีเดียว<br />แล้วไปต่อได้ทันที</h1>
        <p>แพลตฟอร์มค้นหาและจัดการเทรนเนอร์ส่วนบุคคลที่ขับเคลื่อนด้วยหลักฐานจริงและความน่าเชื่อถือ</p>

        <ul className="auth-features" aria-label="สิทธิประโยชน์สำหรับผู้ใช้">
          <li className="auth-feature-item">
            <UserCheck aria-hidden="true" size={20} />
            <div>
              <strong>สำหรับสมาชิกทั่วไป</strong>
              <span>ค้นหาเทรนเนอร์ที่ตรงเป้าหมาย เช็กใบรับรอง และจองได้ทันที</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <Sparkles aria-hidden="true" size={20} />
            <div>
              <strong>สำหรับเทรนเนอร์</strong>
              <span>สร้างโปรไฟล์วิชาชีพ ยื่นเอกสารรับรอง และจัดการตารางสอน</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <CheckCircle2 aria-hidden="true" size={20} />
            <div>
              <strong>ระบบตรวจเอกสารโปร่งใส</strong>
              <span>ทุกขั้นตอนได้รับการตรวจสอบความถูกต้องโดยผู้ดูแลระบบ</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="auth-panel">
        <p className="label">สร้างบัญชี FITCONNECT</p>
        <h2>สร้างบัญชีใหม่</h2>
        <AuthForm mode="register" />
        <p className="connection-note">🔒 ข้อมูลส่วนตัวของคุณถูกเก็บรักษาอย่างปลอดภัยตามมาตรฐาน</p>
      </section>
    </main>
  );
}
