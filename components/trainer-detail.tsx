"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Award, CalendarClock, ChevronLeft, ChevronRight, Dumbbell, Expand, MessageSquareText, Pencil, Star } from "lucide-react";
import { CredentialCard } from "@/components/credential-card";
import { DisclosureSection } from "@/components/disclosure-section";
import { ProfileBookingPanel } from "@/components/profile-booking-panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiAssetUrl, authenticatedRequest } from "@/lib/api";
import { formatMoney, formatShortDay, formatTrainingTypeName } from "@/lib/format";
import type { AvailabilitySlot, PublicTrainerReview, Trainer, TrainerWorkspace } from "@/lib/types";

function RatingStars({ value, size = 16 }: { value: number; size?: number }) {
  return (
    <span className="review-stars" role="img" aria-label={`${value} จาก 5 ดาว`}>
      {[1, 2, 3, 4, 5].map((index) => (
        <Star key={index} aria-hidden="true" size={size} className={index <= Math.round(value) ? "is-filled" : undefined} />
      ))}
    </span>
  );
}

function TrainerReview({ review }: { review: PublicTrainerReview }) {
  return (
    <article className="trainer-review trainer-review-card">
      <header>
        <RatingStars value={review.rating} />
        <time dateTime={review.createdAt}>{formatShortDay(review.createdAt)}</time>
      </header>
      <p>{review.comment}</p>
      <small>รีวิวจากการฝึกที่เสร็จแล้ว</small>
    </article>
  );
}

/** Page numbers around the current one, so 20 pages never print 20 buttons. */
function reviewPageWindow(page: number, pages: number): number[] {
  const first = Math.max(1, Math.min(page - 2, pages - 4));
  return Array.from({ length: Math.min(5, pages) }, (_, index) => first + index);
}

export function TrainerDetail({ trainer, returnTo = "/trainers" }: { trainer: Trainer; returnTo?: string }) {
  const backHref = returnTo === "/trainers" || returnTo.startsWith("/trainers?") ? returnTo : "/trainers";
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [priceOverride, setPriceOverride] = useState<{ trainerId: number; value: number } | null>(null);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceInput, setPriceInput] = useState(String(trainer.priceFrom ?? ""));
  const [savingPrice, setSavingPrice] = useState(false);
  const [editableTrainerId, setEditableTrainerId] = useState<number | null>(null);
  const [priceMessage, setPriceMessage] = useState("");
  const [priceError, setPriceError] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const headingId = `trainer-profile-heading-${trainer.id}`;
  const currentPrice = priceOverride?.trainerId === trainer.id
    ? priceOverride.value
    : (trainer.priceFrom ?? null);
  const canEditPrice = editableTrainerId === trainer.id;
  const reviews = trainer.reviews ?? [];
  const reviewsPerPage = 4;
  const reviewPageCount = Math.max(1, Math.ceil(reviews.length / reviewsPerPage));
  const currentReviewPage = Math.min(reviewPage, reviewPageCount);
  const visibleReviews = reviews.slice((currentReviewPage - 1) * reviewsPerPage, currentReviewPage * reviewsPerPage);
  const reviewSummary = trainer.reviewCount > 0 && trainer.rating != null
    ? `${trainer.rating} จาก 5 · ${trainer.reviewCount} รีวิว`
    : "ยังไม่มีรีวิวจากการฝึกที่เสร็จแล้ว";
  // The distribution is only drawn when the API sent every review; bars built
  // from a partial list would misstate the score.
  const hasEveryReview = reviews.length > 0 && reviews.length === trainer.reviewCount;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: reviews.filter((review) => Math.round(review.rating) === star).length,
  }));
  const firstShown = (currentReviewPage - 1) * reviewsPerPage + 1;
  const lastShown = Math.min(reviews.length, currentReviewPage * reviewsPerPage);

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
  // Live profiles carry a relative `/v1/profile-images/...` path that
  // `next/image` would resolve against the Next origin and refuse with a 400.
  const imageUrl = apiAssetUrl(trainer.image ?? null);
  const gallery = [imageUrl, ...(trainer.photos ?? []).map((photo) => apiAssetUrl(photo.url))]
    .filter((url): url is string => Boolean(url));
  const activeImage = gallery[Math.min(activeIndex, gallery.length - 1)] ?? null;
  const shownIndex = Math.min(activeIndex, Math.max(0, gallery.length - 1));
  function stepImage(delta: number) {
    if (gallery.length < 2) return;
    setActiveIndex((current) => (current + delta + gallery.length) % gallery.length);
  }

  return (
    <>
      <div className="trainer-detail-toolbar">
        <Button asChild variant="outline">
          <Link href={backHref}><ArrowLeft aria-hidden="true" size={17} /> ย้อนกลับ</Link>
        </Button>
      </div>
      <div className="trainer-detail-layout trainer-commerce-layout">
        <section className="trainer-detail-media" aria-label={`ภาพโปรไฟล์ของ ${trainer.displayName}`}>
          <div className="trainer-detail-photo">
            {activeImage && (
              <button type="button" className="trainer-detail-photo__zoom" aria-label="ขยายรูป" onClick={() => setLightboxOpen(true)}>
              <Image
                key={activeImage}
                src={activeImage}
                alt={activeIndex === 0 ? `รูปโปรไฟล์ของ${trainer.displayName}` : `รูปที่ ${activeIndex + 1} ของ${trainer.displayName}`}
                fill
                priority={activeIndex === 0}
                loading={activeIndex === 0 ? "eager" : undefined}
                fetchPriority={activeIndex === 0 ? "high" : undefined}
                sizes="(max-width: 768px) 90vw, 24vw"
              />
              <span className="trainer-detail-photo__hint" aria-hidden="true"><Expand size={16} /> แตะเพื่อขยาย</span>
              </button>
            )}
            {gallery.length > 1 && <span className="trainer-gallery__count">{activeIndex + 1} / {gallery.length}</span>}
          </div>
          {gallery.length > 1 && (
            <ul className="trainer-gallery__thumbs" aria-label="รูปทั้งหมดของเทรนเนอร์">
              {gallery.map((url, index) => (
                <li key={url}>
                  <button
                    type="button"
                    className={index === activeIndex ? "is-active" : undefined}
                    aria-label={`ดูรูปที่ ${index + 1}`}
                    aria-pressed={index === activeIndex}
                    onClick={() => setActiveIndex(index)}
                  >
                    <Image src={url} alt="" fill sizes="80px" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="trainer-detail-copy trainer-profile-summary" aria-labelledby={headingId}>
          <h1 id={headingId}>{trainer.displayName}</h1>
          {trainer.nickname && <p className="trainer-nickname">ชื่อเล่น {trainer.nickname}</p>}
          <p className="lead">{trainer.headline}</p>
          <p>{trainer.bio}</p>
          <div className="trainer-detail-status"><StatusBadge status={trainer.verification} /></div>
          {trainer.trainingTypes.length > 0 && (
            <ul className="trainer-type-chips" aria-label="ความเชี่ยวชาญ">
              {trainer.trainingTypes.map((type) => (
                <li key={type.id}>{formatTrainingTypeName(type.nameTh)}</li>
              ))}
            </ul>
          )}
          <dl className="trainer-quick-facts">
            <div>
              <dt><Award aria-hidden="true" size={16} /> ประสบการณ์</dt>
              <dd>{trainer.yearsExperience} <small>ปี</small></dd>
            </div>
            <div>
              <dt><Star aria-hidden="true" size={16} /> คะแนนรีวิว</dt>
              <dd>{trainer.reviewCount > 0 && trainer.rating != null ? trainer.rating.toFixed(1) : "–"} <small>{trainer.reviewCount} รีวิว</small></dd>
            </div>
            <div>
              <dt><Dumbbell aria-hidden="true" size={16} /> ใบรับรอง</dt>
              <dd>{trainer.certificates.length} <small>รายการ</small></dd>
            </div>
          </dl>
          <div className="detail-meta">
            {reviews.length > 0
              ? <a className="trainer-review-jump" href="#trainer-reviews"><MessageSquareText aria-hidden="true" size={17} /> {reviewSummary}</a>
              : <span><MessageSquareText aria-hidden="true" size={17} /> {reviewSummary}</span>}
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
      <a className="trainer-mobile-booking-action" href="#booking-panel">
        <CalendarClock aria-hidden="true" /> เลือกเวลาฝึก
      </a>
      <Dialog open={lightboxOpen && activeImage !== null} onOpenChange={setLightboxOpen}>
        <DialogContent
          className="trainer-lightbox"
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") { event.preventDefault(); stepImage(1); }
            if (event.key === "ArrowLeft") { event.preventDefault(); stepImage(-1); }
          }}
        >
          <DialogTitle className="sr-only">รูปของ{trainer.displayName}</DialogTitle>
          <DialogDescription className="sr-only">ใช้ปุ่มลูกศรซ้ายขวาเพื่อเปลี่ยนรูป</DialogDescription>
          <div className="trainer-lightbox__frame">
            {activeImage && (
              <Image
                key={`zoom-${activeImage}`}
                src={activeImage}
                alt={`รูปขยาย ${shownIndex + 1} จาก ${gallery.length} ของ${trainer.displayName}`}
                fill
                sizes="90vw"
              />
            )}
          </div>
          {gallery.length > 1 && (
            <div className="trainer-lightbox__controls">
              <button type="button" aria-label="รูปก่อนหน้า" onClick={() => stepImage(-1)}><ChevronLeft aria-hidden="true" size={20} /></button>
              <span aria-live="polite">{shownIndex + 1} / {gallery.length}</span>
              <button type="button" aria-label="รูปถัดไป" onClick={() => stepImage(1)}><ChevronRight aria-hidden="true" size={20} /></button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <section id="trainer-reviews" className="trainer-reviews trainer-reviews--cards" aria-labelledby="trainer-reviews-heading">
          <header className="trainer-reviews__heading">
            <div>
              <h2 id="trainer-reviews-heading">รีวิวจากสมาชิก</h2>
              <p>เฉพาะรีวิวจากการจองที่ฝึกเสร็จแล้ว</p>
            </div>
            <strong>{reviewSummary}</strong>
          </header>

          {reviews.length > 0 ? (
            <div className="trainer-reviews__body">
              <aside className="trainer-reviews__score-card" aria-label="สรุปคะแนนรีวิว">
                <strong className="trainer-reviews__average">{trainer.rating != null ? trainer.rating.toFixed(1) : "–"}</strong>
                <RatingStars value={trainer.rating ?? 0} size={20} />
                <span>จาก {trainer.reviewCount} รีวิว</span>
                {hasEveryReview && (
                  <dl className="trainer-reviews__bars">
                    {distribution.map(({ star, count }) => (
                      <div key={star}>
                        <dt>{star} ดาว</dt>
                        <dd>
                          <span className="trainer-reviews__bar"><span style={{ width: `${Math.round((count / reviews.length) * 100)}%` }} /></span>
                          <span>{count}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </aside>
              <div className="trainer-reviews__main">
                <div className="trainer-review-list">
                  {visibleReviews.map((review) => (
                    <TrainerReview key={`${review.createdAt}-${review.comment}`} review={review} />
                  ))}
                </div>
                {reviewPageCount > 1 && (
                  <nav className="trainer-review-pagination" aria-label="หน้ารายการรีวิว">
                    <span className="trainer-review-pagination__range">แสดง {firstShown}–{lastShown} จาก {reviews.length}</span>
                    <div>
                      <button type="button" aria-label="หน้ารีวิวก่อนหน้า" disabled={currentReviewPage === 1} onClick={() => setReviewPage(currentReviewPage - 1)}>
                        <ChevronLeft aria-hidden="true" size={16} />
                      </button>
                      {reviewPageWindow(currentReviewPage, reviewPageCount).map((page) => (
                        <button
                          key={page}
                          type="button"
                          className={page === currentReviewPage ? "is-current" : undefined}
                          aria-label={`หน้ารีวิว ${page}`}
                          aria-current={page === currentReviewPage ? "page" : undefined}
                          onClick={() => setReviewPage(page)}
                        >
                          {page}
                        </button>
                      ))}
                      <button type="button" aria-label="หน้ารีวิวถัดไป" disabled={currentReviewPage === reviewPageCount} onClick={() => setReviewPage(currentReviewPage + 1)}>
                        <ChevronRight aria-hidden="true" size={16} />
                      </button>
                    </div>
                  </nav>
                )}
              </div>
            </div>
          ) : (
            <p className="trainer-reviews__empty">ยังไม่มีรีวิวจากการฝึกที่เสร็จแล้ว</p>
          )}

          <a className="trainer-reviews__booking-link" href="#booking-panel">กลับไปเลือกเวลา</a>
      </section>
    </>
  );
}
