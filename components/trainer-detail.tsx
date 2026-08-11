"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { MessageSquareText, Pencil } from "lucide-react";
import { CredentialCard } from "@/components/credential-card";
import { DisclosureSection } from "@/components/disclosure-section";
import { ProfileBookingPanel } from "@/components/profile-booking-panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authenticatedRequest } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { AvailabilitySlot, PublicTrainerReview, Trainer, TrainerWorkspace } from "@/lib/types";

const reviewDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

function TrainerReview({ review }: { review: PublicTrainerReview }) {
  return (
    <article className="trainer-review">
      <strong>{review.rating} จาก 5 ดาว</strong>
      <time dateTime={review.createdAt}>{reviewDate.format(new Date(review.createdAt))}</time>
      <p>{review.comment}</p>
    </article>
  );
}

export function TrainerDetail({ trainer }: { trainer: Trainer }) {
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
  const reviews = trainer.reviews ?? [];
  const visibleReviews = reviews.slice(0, 3);
  const additionalReviews = reviews.slice(3);
  const reviewSummary = trainer.reviewCount > 0 && trainer.rating != null
    ? `${trainer.rating} จาก 5 · ${trainer.reviewCount} รีวิว`
    : "ยังไม่มีรีวิวจากการฝึกที่เสร็จแล้ว";

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
      setPriceMessage("กรุณาระบุค่าฝึกต่อครั้งที่มากกว่า 0 บาท");
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
      setPriceMessage("บันทึกค่าฝึกต่อครั้งแล้ว");
    } catch (error) {
      setPriceError(true);
      setPriceMessage(error instanceof Error ? error.message : "บันทึกค่าฝึกต่อครั้งไม่สำเร็จ");
    } finally {
      setSavingPrice(false);
    }
  }

  const currentTrainer = { ...trainer, priceFrom: currentPrice };

  return (
    <>
      <div className="trainer-detail-layout trainer-commerce-layout">
        <section className="trainer-detail-media" aria-label={`ภาพโปรไฟล์ของ ${trainer.displayName}`}>
          <div className="trainer-detail-photo">
            {trainer.image && (
              <Image
                src={trainer.image}
                alt={`รูปโปรไฟล์ของ${trainer.displayName}`}
                fill
                priority
                loading="eager"
                fetchPriority="high"
                sizes="(max-width: 768px) 50vw, 31vw"
              />
            )}
            {trainer.demo && <span className="trainer-demo-label">ภาพสาธิต</span>}
          </div>
        </section>

        <section className="trainer-detail-copy trainer-profile-summary" aria-labelledby={headingId}>
          <h1 id={headingId}>{trainer.displayName}</h1>
          <p className="lead">{trainer.headline}</p>
          <p>{trainer.bio}</p>
          <div className="trainer-detail-status"><StatusBadge status={trainer.verification} /></div>
          <div className="detail-meta">
            <span><MessageSquareText aria-hidden="true" size={17} /> {reviewSummary}</span>
            <div className="price-session">
              <span className="label">ค่าฝึกต่อครั้ง</span>
              <div className="price-editor-inline">
                <strong>{currentPrice == null ? "เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก" : formatMoney(currentPrice)}</strong>
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
                    aria-label="ค่าฝึกต่อครั้ง"
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

          <DisclosureSection
            title="ใบรับรองและคุณสมบัติ"
            summary={`${trainer.certificates.length} รายการ · ประสบการณ์ ${trainer.yearsExperience} ปี`}
            className="trainer-detail-disclosure trainer-detail-evidence"
          >
            <CredentialCard trainer={currentTrainer} />
          </DisclosureSection>
        </section>

        <ProfileBookingPanel trainer={currentTrainer} selectedSlot={slot} onSelectSlot={setSlot} />
      </div>
      {reviews.length > 0 && (
        <section className="trainer-reviews" aria-labelledby="trainer-reviews-heading">
          <header className="trainer-reviews__heading">
            <div>
              <h2 id="trainer-reviews-heading">รีวิวจากสมาชิก</h2>
              <p>เฉพาะรีวิวจากการจองที่ฝึกเสร็จแล้ว</p>
            </div>
            <strong>{reviewSummary}</strong>
          </header>

          <div className="trainer-review-list">
            {visibleReviews.map((review) => (
              <TrainerReview key={`${review.createdAt}-${review.comment}`} review={review} />
            ))}
          </div>

          {additionalReviews.length > 0 && (
            <details className="trainer-reviews__more">
              <summary>ดูรีวิวเพิ่มเติม ({additionalReviews.length})</summary>
              <div className="trainer-review-list">
                {additionalReviews.map((review) => (
                  <TrainerReview key={`${review.createdAt}-${review.comment}`} review={review} />
                ))}
              </div>
            </details>
          )}

          <a className="trainer-reviews__booking-link" href="#booking-panel">กลับไปเลือกเวลา</a>
        </section>
      )}
    </>
  );
}
