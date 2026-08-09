import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "สร้างบัญชี" };
export default function RegisterPage() {
  return <main className="auth-shell"><section className="auth-copy"><h1>เริ่มจากบัญชีเดียว<br />แล้วไปต่อได้ทันที</h1><p>สมาชิกเริ่มค้นหาและจัดการการจองได้ ส่วนผู้ที่เลือกเทรนเนอร์จะกรอกข้อมูลวิชาชีพและใบรับรองต่อในขั้นถัดไปโดยไม่ต้องสมัครซ้ำ</p></section><section className="auth-panel"><p className="label">ขั้นที่ 1 จาก 2 สำหรับเทรนเนอร์</p><h2>สร้างบัญชี</h2><AuthForm mode="register" /><p className="connection-note">ระบบไม่สร้างบัญชีปลอม หาก API ยังไม่พร้อมจะแจ้งข้อผิดพลาดตามจริง</p></section></main>;
}
