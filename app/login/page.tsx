import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "เข้าสู่ระบบ" };
export default function LoginPage() {
  return <main className="auth-shell"><section className="auth-copy"><h1>ข้อมูลเดียวกัน<br />ทุกสถานะ</h1><p>ดูคำขอ นัดหมาย หลักฐานการชำระ และการสนทนาโดยไม่ต้องตามหาข้อมูลจากหลายช่องทาง</p></section><section className="auth-panel"><p className="label">สมาชิก FitConnect</p><h2>เข้าสู่ระบบ</h2><AuthForm mode="login" /><p className="connection-note">แบบฟอร์มส่งข้อมูลไปยัง PHP API และฐานข้อมูล MySQL ผ่าน XAMPP</p></section></main>;
}
