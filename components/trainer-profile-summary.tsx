"use client";

import Link from "next/link";
import { PencilLine } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { AccountProfile, TrainerAccountProfile } from "@/lib/types";

/**
 * The account profile no longer duplicates the professional editor. Trainers
 * read their approval state, certificates and storefront readiness here and
 * make changes on the application page, so one submit path owns the record and
 * every change is re-reviewed.
 */
export function TrainerProfileSummary({ profile, onEdit }: { profile: TrainerAccountProfile; onEdit?: () => void }) {
  const { trainer } = profile;
  const storefrontComplete = Boolean(
    profile.user.displayName.trim()
    && trainer.headline.trim()
    && trainer.bio.trim()
    && trainer.priceFrom
    && (trainer.paymentAccountName ?? "").trim()
    && (trainer.promptPayId ?? "").trim()
    && trainer.trainingTypeIds.length > 0,
  );

  return (
    <section className="profile-section" aria-labelledby="trainer-details-title">
      <div className="profile-section__heading">
        <h2 id="trainer-details-title">ข้อมูลเทรนเนอร์</h2>
        <p>ข้อมูลวิชาชีพทั้งหมดแก้ที่หน้าใบสมัคร เพื่อให้ผู้ดูแลระบบตรวจก่อนขึ้นหน้าร้าน</p>
      </div>

      <div className="profile-readiness" aria-label="ความพร้อมของหน้าร้าน">
        <div><span>สถานะการตรวจ</span><StatusBadge status={trainer.approvalStatus} /></div>
        <div><span>ข้อมูลหน้าร้าน</span><strong>{storefrontComplete ? "ข้อมูลครบ" : "ควรกรอกเพิ่ม"}</strong></div>
        <div><span>ใบรับรอง</span><strong>{trainer.certificates.length} รายการ</strong></div>
      </div>

      <dl className="profile-ledger">
        <div><dt>ชื่อที่แสดง</dt><dd>{profile.user.displayName}</dd></div>
        <div><dt>ชื่อ-นามสกุลจริง</dt><dd>{trainer.legalName || "ยังไม่ระบุ"}</dd></div>
        <div><dt>เบอร์โทรศัพท์</dt><dd>{trainer.phone || "ยังไม่ระบุ"}</dd></div>
        <div><dt>ประสบการณ์</dt><dd>{trainer.yearsExperience} ปี</dd></div>
        <div><dt>ค่าฝึกเริ่มต้น</dt><dd>{trainer.priceFrom === null ? "ยังไม่กำหนด" : `${trainer.priceFrom} บาท`}</dd></div>
        <div><dt>แพ็กเกจ 30 วัน</dt><dd>{trainer.monthlyPrice === null ? "ยังไม่เปิด" : `${trainer.monthlyPrice} บาท · ${trainer.monthlySessionCount} ครั้ง`}</dd></div>
        <div><dt>บัญชีรับเงิน</dt><dd>{trainer.paymentAccountName || "ยังไม่ระบุ"}</dd></div>
        <div>
          <dt>สถานะการตรวจ</dt>
          <dd><StatusBadge status={trainer.approvalStatus} /></dd>
        </div>
        {trainer.approvalNote && (
          <div><dt>หมายเหตุจากผู้ดูแลระบบ</dt><dd>{trainer.approvalNote}</dd></div>
        )}
        <div className="profile-ledger__stack">
          <dt className="sr-only">ใบรับรอง</dt>
          <dd>
            <details className="profile-certificates-disclosure">
              <summary>
                <span>
                  <strong>ใบรับรองและคุณสมบัติ</strong>
                  <small>{trainer.certificates.length} รายการ</small>
                </span>
                <span aria-hidden="true">ดูรายละเอียด</span>
              </summary>
              <div className="profile-certificates-disclosure__content">
                {trainer.certificates.length === 0
                  ? <p className="profile-certificates-empty">ยังไม่มีใบรับรอง แนบเอกสารได้จากหน้าใบสมัคร</p>
                  : (
                    <ul className="profile-certificates">
                      {trainer.certificates.map((certificate) => (
                        <li key={certificate.id}>
                          <span>
                            <strong>{certificate.name}</strong>
                            <small>{certificate.issuer}{certificate.issuedYear ? ` · ${certificate.issuedYear}` : ""}</small>
                          </span>
                          <StatusBadge status={certificate.status} />
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            </details>
          </dd>
        </div>
      </dl>

      <div className="trainer-apply-actions">
        {onEdit
          ? <button className="button button--accent" type="button" onClick={onEdit}><PencilLine aria-hidden="true" size={17} /> แก้ข้อมูลวิชาชีพ</button>
          : <Link className="button button--accent" href="/trainer/apply"><PencilLine aria-hidden="true" size={17} /> แก้ข้อมูลวิชาชีพ</Link>}
      </div>
    </section>
  );
}

export type { AccountProfile };
