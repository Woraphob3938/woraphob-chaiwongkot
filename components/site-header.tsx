"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Dumbbell, Menu, Search, X } from "lucide-react";

const navItems = [
  { href: "/trainers", label: "ค้นหาเทรนเนอร์" },
  { href: "/trainer/apply", label: "สมัครเป็นเทรนเนอร์" },
  { href: "/member", label: "การจองของฉัน" },
];

export function SiteHeader() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        dialogRef.current?.showModal();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const query = String(data.get("q") ?? "").trim();
    if (!query) event.preventDefault();
  }

  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="FitConnect หน้าหลัก">
          <span className="brand-mark" aria-hidden="true"><Dumbbell size={19} strokeWidth={2.2} /></span>
          <span>FITCONNECT</span>
        </Link>

        <button className="command-pill" type="button" onClick={() => dialogRef.current?.showModal()}>
          <Search aria-hidden="true" size={17} />
          <span>ค้นหาจังหวัด ความเชี่ยวชาญ หรือชื่อเทรนเนอร์</span>
          <kbd>Ctrl K</kbd>
        </button>

        <nav className="desktop-nav" aria-label="เมนูหลัก">
          {navItems.map((item) => <Link href={item.href} key={item.href}>{item.label}</Link>)}
        </nav>

        <div className="header-actions">
          <Link className="text-link desktop-only" href="/login">เข้าสู่ระบบ</Link>
          <Link className="button button--dark desktop-only" href="/register">เริ่มใช้งาน</Link>
          <button
            className="icon-button mobile-menu-button"
            type="button"
            aria-label={mobileOpen ? "ปิดเมนู" : "เปิดเมนู"}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((open) => !open)}
          >
            {mobileOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="mobile-nav" aria-label="เมนูหลักบนมือถือ">
          <button type="button" className="mobile-search" onClick={() => dialogRef.current?.showModal()}>
            <Search aria-hidden="true" size={18} /> ค้นหาเทรนเนอร์
          </button>
          {navItems.map((item) => (
            <Link href={item.href} key={item.href} onClick={() => setMobileOpen(false)}>{item.label}</Link>
          ))}
          <Link href="/login" onClick={() => setMobileOpen(false)}>เข้าสู่ระบบ</Link>
          <Link href="/register" onClick={() => setMobileOpen(false)}>สมัครสมาชิก</Link>
        </nav>
      )}

      <dialog className="search-dialog" ref={dialogRef} onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}>
        <div className="search-dialog__panel">
          <div className="dialog-heading">
            <div>
              <p className="label">ค้นหาทั่ว FitConnect</p>
              <h2>เริ่มจากสิ่งที่คุณต้องการฝึก</h2>
            </div>
            <button className="icon-button" type="button" aria-label="ปิดหน้าต่างค้นหา" onClick={() => dialogRef.current?.close()}>
              <X aria-hidden="true" />
            </button>
          </div>
          <form action="/trainers" method="get" className="dialog-search-form" onSubmit={submitSearch}>
            <Search aria-hidden="true" size={21} />
            <label className="sr-only" htmlFor="global-search">คำค้นหา</label>
            <input id="global-search" name="q" autoFocus placeholder="เช่น เวทเทรนนิง, สกลนคร" />
            <button className="button button--accent" type="submit">ค้นหา</button>
          </form>
          <div className="search-suggestions" aria-label="คำค้นหาแนะนำ">
            <span>ลองค้นหา</span>
            <Link href="/trainers?type=strength">เวทเทรนนิง</Link>
            <Link href="/trainers?province=สกลนคร">สกลนคร</Link>
            <Link href="/trainers?type=mobility">การเคลื่อนไหว</Link>
          </div>
        </div>
      </dialog>
    </header>
  );
}
