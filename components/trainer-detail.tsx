"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MessageSquareText, Pencil } from "lucide-react";
import { AvailabilityPanel } from "@/components/availability-panel";
import { BookingStrip } from "@/components/booking-strip";
import { CredentialCard } from "@/components/credential-card";
import { DemoNotice } from "@/components/demo-notice";
import { DisclosureSection } from "@/components/disclosure-section";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authenticatedRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { AvailabilitySlot, Trainer, TrainerWorkspace } from "@/lib/types";

export function TrainerDetail({ trainer, isDemo }: { trainer: Trainer; isDemo: boolean }) {
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [priceOverride, setPriceOverride] = useState<{ trainerId: number; value: number } | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(trainer.priceFrom ?? ""));
  const [savingPrice, setSavingPrice] = useState(false);
  const [editableTrainerId, setEditableTrainerId] = useState<number | null>(null);
  const [priceMessage, setPriceMessage] = useState("");
  const [priceError, setPriceError] = useState(false);
  const headingId = `trainer-profile-heading-${trainer.id}`;
  const currentPrice = priceOverride?.trainerId === trainer.id
    ? priceOverride.value
    : (trainer.priceFrom ?? null);
  const canEditPrice = editableTrainerId === trainer.id;

  useEffect(() => {
    let active = true;
    const stored = localStorage.getItem("fitconnect_user");
    if (!stored) return () => { active = false; };

    try {
      const user = JSON.parse(stored) as { role?: string };
      if (user.role !== "trainer") return () => { active = false; };
    } catch {
      return () => { active = false; };
    }

    void authenticatedRequest<TrainerWorkspace>("/v1/trainer/me")
      .then((workspace) => {
        if (active) setEditableTrainerId(workspace.profile?.id ?? null);
      })
      .catch(() => {
        if (active) setEditableTrainerId(null);
      });

    return () => { active = false; };
  }, [trainer.id]);

  async function savePrice() {
    const value = Number(priceInput);
    if (priceInput.trim() === "" || !Number.isFinite(value) || value <= 0) {
      setPriceError(true);
      setPriceMessage("กรุณาระบุราคาเริ่มต้นที่มากกว่า 0 บาท");
      return;
    }

    setSavingPrice(true);
    setPriceError(false);
    setPriceMessage("");
    try {
      await authenticatedRequest<TrainerWorkspace>("/v1/trainer/me", {
        method: "PATCH",
        body: JSON.stringify({ priceFrom: value }),
      });
      setPriceOverride({ trainerId: trainer.id, value });
      setEditingPrice(false);
      setPriceMessage("บันทึกราคาเริ่มต้นแล้ว");
    } catch (error) {
      setPriceError(true);
      setPriceMessage(error instanceof Error ? error.message : "บันทึกราคาเริ่มต้นไม่สำเร็จ");
    } finally {
      setSavingPrice(false);
    }
  }

  const currentTrainer = { ...trainer, priceFrom: currentPrice };

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
              <span><MessageSquareText aria-hidden="true" size={17} /> ยังไม่มีรีวิวจริง</span>
              <div className="price-editor-inline">
                <strong>{currentPrice == null ? "รอยืนยันราคา" : `เริ่มต้น ${formatMoney(currentPrice)}`}</strong>
                {canEditPrice && !editingPrice && (
                  <Button type="button" className="button button--dark" onClick={() => {
                    setPriceInput(String(currentPrice ?? ""));
                    setEditingPrice(true);
                    setPriceMessage("");
                    setPriceError(false);
                  }}>
                    <Pencil aria-hidden="true" size={16} /> ปรับราคา
                  </Button>
                )}
              </div>
              {canEditPrice && editingPrice && (
                <div className="price-input-group">
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    value={priceInput}
                    onChange={(event) => setPriceInput(event.target.value)}
                    className="price-edit-input"
                    aria-label="ราคาเริ่มต้น"
                    aria-invalid={priceError}
                  />
                  <Button type="button" className="button button--accent" disabled={savingPrice} onClick={() => void savePrice()}>
                    {savingPrice ? "กำลังบันทึก…" : "บันทึก"}
                  </Button>
                  <Button type="button" className="button button--dark" disabled={savingPrice} onClick={() => {
                    setEditingPrice(false);
                    setPriceInput(String(currentPrice ?? ""));
                    setPriceMessage("");
                    setPriceError(false);
                  }}>
                    ยกเลิก
                  </Button>
                </div>
              )}
              {priceMessage && (
                <p className={priceError ? "field-error" : "queue-notice"} role={priceError ? "alert" : "status"}>
                  {priceMessage}
                </p>
              )}
            </div>
          </div>
        </section>
        <BookingStrip trainer={currentTrainer} slot={slot} />
        <DisclosureSection
          title="ใบรับรองและคุณสมบัติ"
          summary={`${trainer.certificates.length} รายการ · ประสบการณ์ ${trainer.yearsExperience} ปี`}
          className="trainer-detail-disclosure trainer-detail-evidence"
        >
          <CredentialCard trainer={currentTrainer} />
        </DisclosureSection>
        <DisclosureSection
          title="ตารางว่างทั้งหมด"
          summary={`${trainer.slots.filter((item) => item.available).length} ช่วงพร้อมจอง`}
          className="trainer-detail-disclosure trainer-detail-schedule"
        >
          <AvailabilityPanel trainer={currentTrainer} selectedSlot={slot} onSelectSlot={setSlot} />
        </DisclosureSection>
      </div>
    </>
  );
}
