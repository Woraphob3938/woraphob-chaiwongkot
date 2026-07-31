import { FlaskConical } from "lucide-react";

export function DemoNotice({ compact = false }: { compact?: boolean }) {
  return (
    <aside className={compact ? "demo-notice demo-notice--compact" : "demo-notice"} aria-label="หมายเหตุข้อมูลสาธิต">
      <FlaskConical aria-hidden="true" size={18} strokeWidth={1.8} />
      <p>
        <strong>ข้อมูลสาธิต</strong>
        {!compact && " — โปรไฟล์ ราคา ใบรับรอง และตารางเวลาชุดนี้ใช้ทดสอบระบบ ไม่ใช่ข้อมูลบุคคลจริง"}
      </p>
    </aside>
  );
}
