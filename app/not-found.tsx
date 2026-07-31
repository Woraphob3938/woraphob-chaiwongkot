import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return <main className="not-found"><p className="error-code">404 / ไม่พบหน้านี้</p><h1>เส้นทางนี้<br />ยังไม่เปิด</h1><p>ลองกลับไปค้นหาเทรนเนอร์ หรือเลือกเมนูหลักเพื่อเริ่มต้นอีกครั้ง</p><Link className="button button--accent" href="/trainers"><ArrowLeft aria-hidden="true" size={18} /> กลับไปค้นหา</Link></main>;
}
