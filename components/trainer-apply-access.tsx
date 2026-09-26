"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { TrainerApplyForm } from "@/components/trainer-apply-form";
import { readStoredUser } from "@/lib/session";
import type { UserRole } from "@/lib/types";

/**
 * `/trainer/apply` writes the professional record, and the API refuses every
 * account that is not a trainer with `403` — so a signed-in member used to fill
 * in the whole form and be told at submit time. The role lives in the browser
 * session, not on the server, so the page renders the form exactly as before
 * for a guest or a trainer and swaps in an honest notice as soon as the session
 * says the account is a member or an administrator.
 */
const blockedCopy: Record<Exclude<UserRole, "trainer">, { heading: string; body: string; href: string; cta: string }> = {
  member: {
    heading: "หน้านี้เป็นของบัญชีเทรนเนอร์",
    body: "บัญชีที่เข้าสู่ระบบเป็นบัญชีสมาชิก จึงส่งข้อมูลวิชาชีพเทรนเนอร์จากบัญชีนี้ไม่ได้ ระบบจะปฏิเสธการส่งข้อมูล",
    href: "/member",
    cta: "ไปที่การฝึกของฉัน",
  },
  admin: {
    heading: "หน้านี้เป็นของบัญชีเทรนเนอร์",
    body: "บัญชีที่เข้าสู่ระบบเป็นบัญชีผู้ดูแลระบบ จึงส่งข้อมูลวิชาชีพเทรนเนอร์จากบัญชีนี้ไม่ได้ ระบบจะปฏิเสธการส่งข้อมูล",
    href: "/admin",
    cta: "ไปที่พื้นที่ผู้ดูแลระบบ",
  },
};

export function TrainerApplyAccess() {
  const [role, setRole] = useState<UserRole | null>(null);

  // The same session source the header reads, so signing in or out in another
  // tab re-decides this page instead of leaving a stale form standing.
  useEffect(() => {
    async function syncRole() {
      setRole(readStoredUser()?.role ?? null);
    }

    void syncRole();
    window.addEventListener("storage", syncRole);
    window.addEventListener("fitconnect:auth", syncRole);
    return () => {
      window.removeEventListener("storage", syncRole);
      window.removeEventListener("fitconnect:auth", syncRole);
    };
  }, []);

  if (role === "member" || role === "admin") {
    const copy = blockedCopy[role];
    return (
      <section className="empty-state" aria-labelledby="trainer-apply-blocked-heading">
        <h1 id="trainer-apply-blocked-heading">{copy.heading}</h1>
        <p>{copy.body}</p>
        <p>หากต้องการเป็นเทรนเนอร์ ต้องใช้บัญชีเทรนเนอร์เท่านั้น สมัครบัญชีใหม่แล้วกลับมากรอกข้อมูลที่หน้านี้</p>
        <div className="role-notice-actions">
          <Link className="button button--accent" href={copy.href}>{copy.cta}</Link>
          <Link className="button" href="/register">สมัครบัญชีเทรนเนอร์</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="form-page-heading">
        <p className="workflow-current">ข้อมูลวิชาชีพ</p>
        <h1>กรอกข้อมูลวิชาชีพให้ครบในที่เดียว</h1>
        <p>ข้อมูลนี้เป็นชุดเดียวกับที่สมาชิกเห็นบนหน้าร้าน เมื่อส่งแล้วโปรไฟล์จะกลับเข้าคิวให้ผู้ดูแลระบบตรวจก่อนกลับมาแสดง พร้อมแนบไฟล์ PDF ใบรับรองเมื่อยังไม่มีเอกสารในระบบ</p>
        <ol><li><span>01</span>ข้อมูลการให้บริการและราคา</li><li><span>02</span>บัญชีรับเงินและใบรับรอง PDF</li><li><span>03</span>ผู้ดูแลระบบตรวจและแจ้งผล</li></ol>
      </section>
      <TrainerApplyForm />
    </>
  );
}
