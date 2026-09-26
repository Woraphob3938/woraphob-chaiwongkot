"use client";

import { LockKeyhole, PencilLine, Store } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { AccountProfile, TrainerAccountProfile } from "@/lib/types";

export function TrainerProfileSummary({ profile, onEdit }: { profile: TrainerAccountProfile; onEdit: () => void }) {
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

  const maskedPromptPay = (trainer.promptPayId ?? "").replace(/\D/g, "");
  const promptPayLabel = maskedPromptPay
    ? `${maskedPromptPay.slice(0, 3)}••••${maskedPromptPay.slice(-3)}`
    : "ยังไม่ระบุ";

  return (
    <section className="profile-section" aria-labelledby="trainer-details-title">
      <div className="profile-section__heading profile-section__heading--action">
        <div>
          <h2 id="trainer-details-title">ข้อมูลเทรนเนอร์</h2>
          <p>แก้ไขข้อมูลได้จากหน้านี้ และส่งให้ผู้ดูแลระบบตรวจอีกครั้งก่อนแสดงบนหน้าค้นหา</p>
        </div>
        <button className="button button--accent" type="button" onClick={onEdit}><PencilLine aria-hidden="true" size={17} /> แก้ไขข้อมูล</button>
      </div>

      <div className="profile-readiness" aria-label="ความพร้อมของหน้าร้าน">
        <div><span>สถานะการตรวจ</span><StatusBadge status={trainer.approvalStatus} /></div>
        <div><span>ข้อมูลหน้าร้าน</span><strong>{storefrontComplete ? "ข้อมูลครบ" : "ควรกรอกเพิ่ม"}</strong></div>
        <div><span>ใบรับรอง</span><strong>{trainer.certificates.length} รายการ</strong></div>
      </div>

      {trainer.approvalNote && (
        <p className="profile-approval-note"><strong>หมายเหตุจากผู้ดูแลระบบ</strong>{trainer.approvalNote}</p>
      )}

      <div className="profile-card-grid">
        <section className="profile-card" aria-labelledby="trainer-storefront-title">
          <h3 className="profile-card__title" id="trainer-storefront-title"><Store aria-hidden="true" size={18} /> ข้อมูลหน้าร้าน</h3>
          <p className="profile-card__hint">สมาชิกเห็นข้อมูลนี้บนหน้าค้นหาและหน้าโปรไฟล์</p>
          <dl className="profile-ledger">
            <div><dt>ชื่อที่แสดง</dt><dd>{profile.user.displayName}</dd></div>
            <div><dt>ชื่อเล่น</dt><dd>{trainer.nickname || "ยังไม่ระบุ"}</dd></div>
            <div><dt>ประสบการณ์</dt><dd>{trainer.yearsExperience} ปี</dd></div>
            <div><dt>ค่าฝึกเริ่มต้น</dt><dd>{trainer.priceFrom === null ? "ยังไม่กำหนด" : `${trainer.priceFrom} บาท`}</dd></div>
            <div><dt>แพ็กเกจ 30 วัน</dt><dd>{trainer.monthlyPrice === null ? "ยังไม่เปิด" : `${trainer.monthlyPrice} บาท · ${trainer.monthlySessionCount} ครั้ง`}</dd></div>
          </dl>
        </section>
        <section className="profile-card" aria-labelledby="trainer-private-title">
          <h3 className="profile-card__title" id="trainer-private-title"><LockKeyhole aria-hidden="true" size={18} /> ข้อมูลส่วนตัว</h3>
          <p className="profile-card__hint">เห็นเฉพาะคุณและผู้ดูแลระบบ</p>
          <dl className="profile-ledger">
            <div><dt>ชื่อ-นามสกุลจริง</dt><dd>{trainer.legalName || "ยังไม่ระบุ"}</dd></div>
            <div><dt>เบอร์โทรศัพท์</dt><dd>{trainer.phone || "ยังไม่ระบุ"}</dd></div>
            <div><dt>ชื่อบัญชีพร้อมเพย์</dt><dd>{trainer.paymentAccountName || "ยังไม่ระบุ"}</dd></div>
            <div><dt>พร้อมเพย์</dt><dd>{promptPayLabel}</dd></div>
          </dl>
        </section>
      </div>

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
    </section>
  );
}

export type { AccountProfile };
