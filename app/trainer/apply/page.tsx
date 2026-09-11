import { TrainerApplyForm } from "@/components/trainer-apply-form";

export const metadata = { title: "สมัครเป็นเทรนเนอร์" };
export default function TrainerApplyPage() {
  return (
    <main className="page-shell form-page">
      <section className="form-page-heading">
        <div>
          <p className="workflow-current">ข้อมูลวิชาชีพ</p>
          <h1>กรอกข้อมูลวิชาชีพ<br />ให้ครบในที่เดียว</h1>
        </div>
        <div>
          <p>ข้อมูลนี้เป็นชุดเดียวกับที่สมาชิกเห็นบนหน้าร้าน เมื่อส่งแล้วโปรไฟล์จะกลับเข้าคิวให้ผู้ดูแลระบบตรวจก่อนกลับมาแสดง พร้อมแนบไฟล์ PDF ใบรับรองเมื่อยังไม่มีเอกสารในระบบ</p>
          <ol><li><span>01</span>ข้อมูลการให้บริการและราคา</li><li><span>02</span>บัญชีรับเงินและใบรับรอง PDF</li><li><span>03</span>ผู้ดูแลระบบตรวจและแจ้งผล</li></ol>
        </div>
      </section>
      <TrainerApplyForm />
    </main>
  );
}
