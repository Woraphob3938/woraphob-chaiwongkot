import { ApplicationForm } from "@/components/application-form";

export const metadata = { title: "สมัครเป็นเทรนเนอร์" };
export default function TrainerApplyPage() {
  return <main className="page-shell form-page"><section className="form-page-heading"><div><p className="workflow-current">ขั้นที่ 2 จาก 2 · ตั้งค่าโปรไฟล์เทรนเนอร์</p><h1>เติมข้อมูลวิชาชีพ<br />ให้ครบในครั้งเดียว</h1></div><div><p>บัญชีเทรนเนอร์ของคุณสร้างเรียบร้อยแล้ว เหลือข้อมูลการให้บริการและเอกสาร PDF เพื่อให้ผู้ดูแลระบบตรวจ ก่อนเปิดโปรไฟล์และตารางว่างให้สมาชิกจอง</p><ol><li><span>01</span>ข้อมูลการให้บริการ</li><li><span>02</span>ใบรับรอง PDF</li><li><span>03</span>ผู้ดูแลระบบตรวจและแจ้งผล</li></ol></div></section><ApplicationForm /></main>;
}
