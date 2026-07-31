import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "สร้างบัญชี" };
export default function RegisterPage() {
  return <main className="auth-shell"><section className="auth-copy"><h1>ฝึกอย่างมั่นใจ<br />ตั้งแต่การเลือก</h1><p>บัญชีสมาชิกใช้สำหรับส่งคำขอ จัดการนัดหมาย อัปโหลดสลิป และพูดคุยกับเทรนเนอร์</p></section><section className="auth-panel"><p className="label">บัญชีใหม่</p><h2>สร้างบัญชี</h2><AuthForm mode="register" /><p className="connection-note">ระบบไม่สร้างบัญชีปลอม หาก API ยังไม่พร้อมจะแจ้งข้อผิดพลาดตามจริง</p></section></main>;
}
