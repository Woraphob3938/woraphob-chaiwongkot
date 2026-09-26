import { AuthForm } from "@/components/auth-form";
import { BadgeCheck, CalendarClock, MessagesSquare } from "lucide-react";

export const metadata = { title: "สร้างบัญชี" };

export default function RegisterPage() {
  return (
    <main className="auth-shell">
      <section className="auth-copy">
        <span className="auth-badge">เริ่มได้ในไม่กี่นาที</span>
        <h1>เริ่มจากบัญชีเดียว<br />แล้วไปต่อได้ทันที</h1>
        <p>เลือกบทบาทตอนสมัครได้เลย สมาชิกจองได้ทันที ส่วนเทรนเนอร์ยื่นเอกสารให้ผู้ดูแลระบบตรวจก่อนเปิดรับสอน</p>

        {/* The role cards already describe the two roles, so this list only
            carries what the cards cannot say. */}
        <ul className="auth-features" aria-label="สิ่งที่เกิดขึ้นหลังสร้างบัญชี">
          <li className="auth-feature-item">
            <BadgeCheck aria-hidden="true" size={20} />
            <div>
              <strong>เทรนเนอร์ต้องผ่านการตรวจ</strong>
              <span>แนบใบรับรองเป็นไฟล์ PDF แล้วรอผล โปรไฟล์จะยังไม่ขึ้นหน้าค้นหาจนกว่าจะอนุมัติ</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <CalendarClock aria-hidden="true" size={20} />
            <div>
              <strong>ยืนยันเป็นรอบ แล้วชำระภายใน 10 นาที</strong>
              <span>สมาชิกส่งคำขอตามเวลาที่อยากฝึก เทรนเนอร์ตอบรับ แล้วระบบแจ้งยืนยันในรอบ 12:00 หรือ 18:00 น. จากนั้นส่งสลิปภายใน 10 นาที</span>
            </div>
          </li>
          <li className="auth-feature-item">
            <MessagesSquare aria-hidden="true" size={20} />
            <div>
              <strong>คุยกันได้ในระบบ</strong>
              <span>ทักถามเทรนเนอร์ได้ตั้งแต่ก่อนจอง และคุยนัดหมายต่อได้จนจบการฝึก</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="auth-panel">
        <p className="label">สร้างบัญชี</p>
        <h2>สร้างบัญชีใหม่</h2>
        <AuthForm mode="register" />
        <p className="connection-note">สมัครฟรี ไม่มีค่าใช้จ่ายในการสร้างบัญชี</p>
      </section>
    </main>
  );
}
