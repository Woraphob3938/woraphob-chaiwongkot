"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MapPin, MessageSquareText, Pencil } from "lucide-react";
import { AvailabilityPanel } from "@/components/availability-panel";
import { BookingStrip } from "@/components/booking-strip";
import { CredentialCard } from "@/components/credential-card";
import { DemoNotice } from "@/components/demo-notice";
import { authenticatedRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

export function TrainerDetail({ trainer, isDemo }: { trainer: Trainer; isDemo: boolean }) {
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [currentPrice, setCurrentPrice] = useState<number>(trainer.priceFrom ?? 0);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState<string>(String(trainer.priceFrom ?? 0));
  const [savingPrice, setSavingPrice] = useState(false);
  const [isTrainer, setIsTrainer] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("fitconnect_user");
    if (stored) {
      try {
        const u = JSON.parse(stored);
        if (u.role === "trainer") setIsTrainer(true);
      } catch {}
    }
  }, []);

  async function savePrice() {
    const val = Number(priceInput);
    if (!Number.isFinite(val) || val < 0) return;
    setSavingPrice(true);
    setCurrentPrice(val);
    setEditingPrice(false);
    try {
      await authenticatedRequest("/v1/trainer/me", {
        method: "PATCH",
        body: JSON.stringify({ priceFrom: val }),
      });
    } catch {
      // ignore API failure in demo/offline mode so UI still updates smoothly
    } finally {
      setSavingPrice(false);
    }
  }

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
              <span><MessageSquareText aria-hidden="true" size={17} /> ยังไม่มีรีวิวจริง</span>
              <div className="price-editor-inline">
                <strong>เริ่มต้น {formatMoney(currentPrice)}</strong>
                {isTrainer && (
                  editingPrice ? (
                    <span className="price-input-group">
                      <input
                        type="number"
                        min="0"
                        value={priceInput}
                        onChange={(e) => setPriceInput(e.target.value)}
                        className="price-edit-input"
                        aria-label="ราคาเริ่มต้น"
                      />
                      <button type="button" className="button button--accent button--sm" disabled={savingPrice} onClick={savePrice}>
                        {savingPrice ? "กำลังบันทึก…" : "บันทึก"}
                      </button>
                      <button type="button" className="button button--dark button--sm" onClick={() => setEditingPrice(false)}>
                        ยกเลิก
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="button button--dark button--sm" onClick={() => setEditingPrice(true)}>
                      <Pencil aria-hidden="true" size={14} /> ปรับราคา
                    </button>
                  )
                )}
              </div>
            </div>
          </div>
        </section>
        <div className="trainer-detail-evidence"><CredentialCard trainer={{ ...trainer, priceFrom: currentPrice }} /></div>
        <div className="trainer-detail-schedule"><AvailabilityPanel trainer={{ ...trainer, priceFrom: currentPrice }} selectedSlot={slot} onSelectSlot={setSlot} /></div>
      </div>
      <BookingStrip trainer={{ ...trainer, priceFrom: currentPrice }} slot={slot} />
    </>
  );
}
