import { ApplicationForm } from "@/components/application-form";

export const metadata = { title: "สมัครเป็นเทรนเนอร์" };
export default function TrainerApplyPage() {
  return <main className="page-shell form-page"><section className="form-page-heading"><div><p className="workflow-current">ขั้นตอนปัจจุบัน: ข้อมูลการให้บริการ</p><h1>ให้หลักฐาน<br />พูดแทนคุณ</h1></div><div><p>FitConnect แสดงเฉพาะสถานะที่แอดมินตรวจแล้ว ใบสมัครและเอกสาร PDF จะถูกทบทวนด้วยตนเองก่อนเผยแพร่โปรไฟล์</p><ol><li><span>01</span>ข้อมูลการให้บริการ</li><li><span>02</span>ใบรับรอง PDF</li><li><span>03</span>แอดมินตรวจและแจ้งผล</li></ol></div></section><ApplicationForm /></main>;
}
