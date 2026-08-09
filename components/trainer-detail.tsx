"use client";

import Image from "next/image";
import { useState } from "react";
import { MapPin, MessageSquareText } from "lucide-react";
import { AvailabilityPanel } from "@/components/availability-panel";
import { BookingStrip } from "@/components/booking-strip";
import { CredentialCard } from "@/components/credential-card";
import { DemoNotice } from "@/components/demo-notice";
import { DisclosureSection } from "@/components/disclosure-section";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

export function TrainerDetail({ trainer, isDemo }: { trainer: Trainer; isDemo: boolean }) {
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const headingId = `trainer-profile-heading-${trainer.id}`;

  return (
    <>
      {isDemo && <DemoNotice />}
      <div className="trainer-detail-layout trainer-profile-guided">
        <section className="trainer-detail-hero" aria-labelledby={headingId}>
          <div className="trainer-detail-photo">
            {trainer.image && (
              <Image
                src={trainer.image}
                alt={trainer.demo
                  ? `ภาพสังเคราะห์ของ${trainer.displayName} ใช้เพื่อสาธิต`
                  : `ภาพบุคคลของ${trainer.displayName}`}
                fill
                priority
                loading="eager"
                fetchPriority="high"
                sizes="(max-width: 900px) 100vw, 48vw"
              />
            )}
            {trainer.demo && <div className="portrait-stamp">ภาพสังเคราะห์ · สาธิต</div>}
          </div>
          <div className="trainer-detail-copy trainer-profile-summary">
            <p className="profile-id">โปรไฟล์เทรนเนอร์ #{String(trainer.id).padStart(3, "0")}</p>
            <h1 id={headingId}>{trainer.displayName}</h1>
            <p className="lead">{trainer.headline}</p>
            <p>{trainer.bio}</p>
            <div className="trainer-detail-status"><StatusBadge status={trainer.verification} /></div>
            <div className="detail-meta">
              <span><MapPin aria-hidden="true" size={17} /> {trainer.province.nameTh}</span>
              <span><MessageSquareText aria-hidden="true" size={17} /> ยังไม่มีรีวิวจริง</span>
              <strong>{trainer.priceFrom == null ? "รอยืนยันราคา" : `เริ่มต้น ${formatMoney(trainer.priceFrom)}`}</strong>
            </div>
          </div>
        </section>
        <BookingStrip trainer={trainer} slot={slot} />
        <DisclosureSection
          title="ใบรับรองและคุณสมบัติ"
          summary={`${trainer.certificates.length} รายการ · ประสบการณ์ ${trainer.yearsExperience} ปี`}
          className="trainer-detail-disclosure trainer-detail-evidence"
        >
          <CredentialCard trainer={trainer} />
        </DisclosureSection>
        <DisclosureSection
          title="ตารางว่างทั้งหมด"
          summary={`${trainer.slots.filter((item) => item.available).length} ช่วงพร้อมจอง`}
          className="trainer-detail-disclosure trainer-detail-schedule"
        >
          <AvailabilityPanel trainer={trainer} selectedSlot={slot} onSelectSlot={setSlot} />
        </DisclosureSection>
      </div>
    </>
  );
}
