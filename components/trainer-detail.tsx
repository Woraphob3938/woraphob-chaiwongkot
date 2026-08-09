"use client";

import Image from "next/image";
import { useState } from "react";
import { MapPin, MessageSquareText } from "lucide-react";
import { AvailabilityPanel } from "@/components/availability-panel";
import { BookingStrip } from "@/components/booking-strip";
import { CredentialCard } from "@/components/credential-card";
import { DemoNotice } from "@/components/demo-notice";
import { formatMoney } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

export function TrainerDetail({ trainer, isDemo }: { trainer: Trainer; isDemo: boolean }) {
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);

  return (
    <>
      {isDemo && <DemoNotice />}
      <div className="trainer-detail-layout">
        <section className="trainer-detail-hero">
          <div className="trainer-detail-photo">
            {trainer.image && <Image src={trainer.image} alt={`ภาพบุคคลสังเคราะห์ของ${trainer.displayName} ใช้เพื่อสาธิต`} fill priority loading="eager" fetchPriority="high" sizes="(max-width: 900px) 100vw, 48vw" />}
            <div className="portrait-stamp">ภาพสังเคราะห์ · สาธิต</div>
          </div>
          <div className="trainer-detail-copy">
            <p className="profile-id">โปรไฟล์เทรนเนอร์ #{String(trainer.id).padStart(3, "0")}</p>
            <h1>{trainer.displayName}</h1>
            <p className="lead">{trainer.headline}</p>
            <p>{trainer.bio}</p>
            <div className="detail-meta">
              <span><MapPin aria-hidden="true" size={17} /> {trainer.province.nameTh}</span>
              <span><MessageSquareText aria-hidden="true" size={17} /> ยังไม่มีรีวิวจริง</span>
              <strong>{trainer.priceFrom == null ? "รอยืนยันราคา" : `เริ่มต้น ${formatMoney(trainer.priceFrom)}`}</strong>
            </div>
          </div>
        </section>
        <div className="trainer-detail-evidence"><CredentialCard trainer={trainer} /></div>
        <div className="trainer-detail-schedule"><AvailabilityPanel trainer={trainer} selectedSlot={slot} onSelectSlot={setSlot} /></div>
      </div>
      <BookingStrip trainer={trainer} slot={slot} />
    </>
  );
}
