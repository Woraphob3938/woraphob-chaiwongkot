import Link from "next/link";

export function PageFooter() {
  return (
    <footer className="page-footer">
      <div className="footer-rule" />
      <div className="footer-line">
        <strong>FITCONNECT</strong>
        <p>ค้นหา ตรวจสอบ และจองเทรนเนอร์ในเส้นทางเดียว</p>
        <nav aria-label="เมนูส่วนท้าย">
          <Link href="/trainers">เทรนเนอร์</Link>
          <Link href="/trainer/apply">สมัครเทรนเนอร์</Link>
          <Link href="/login">เข้าสู่ระบบ</Link>
        </nav>
        <span>© 2026</span>
      </div>
    </footer>
  );
}
