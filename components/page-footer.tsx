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
          {/* Points at registration: /trainer/apply needs a signed-in trainer, so
              sending a guest there only produces an error they cannot act on. */}
          <Link href="/register">สมัครเป็นเทรนเนอร์</Link>
        </nav>
        <span>© 2026</span>
      </div>
    </footer>
  );
}
