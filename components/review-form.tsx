"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MAX_COMMENT_LENGTH = 2_000;

const reviewStatusCopy: Record<NonNullable<Booking["review"]>["status"], string> = {
  published: "เผยแพร่แล้ว",
  hidden: "ซ่อนจากสาธารณะ",
  reported: "มีรายงานให้ตรวจสอบ",
};

type ReviewFormProps = {
  booking: Booking;
  onUpdated: () => Promise<void> | void;
};

export function ReviewForm({ booking, onUpdated }: ReviewFormProps) {
  const formId = useId();
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ rating?: string; comment?: string }>({});
  const [requestError, setRequestError] = useState<"submit" | "refresh" | null>(null);
  const [requestMessage, setRequestMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const busyRef = useRef(false);
  const feedbackRef = useRef<HTMLDivElement | HTMLParagraphElement>(null);

  useEffect(() => {
    if (requestMessage || notice) feedbackRef.current?.focus();
  }, [notice, requestMessage]);

  function validate(): string | null {
    const trimmedComment = comment.trim();
    const commentLength = Array.from(trimmedComment).length;
    const nextErrors: { rating?: string; comment?: string } = {};
    if (rating === null || rating < 1 || rating > 5) {
      nextErrors.rating = "กรุณาเลือกคะแนน 1 ถึง 5 ดาว";
    }
    if (!trimmedComment) {
      nextErrors.comment = "กรุณาเขียนความคิดเห็นก่อนส่งรีวิว";
    } else if (commentLength > MAX_COMMENT_LENGTH) {
      nextErrors.comment = "ความคิดเห็นต้องไม่เกิน 2,000 ตัวอักษร";
    }
    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0 ? trimmedComment : null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || submitted || !booking.actions.canReview) return;
    const trimmedComment = validate();
    if (trimmedComment === null || rating === null) return;

    busyRef.current = true;
    setBusy(true);
    setNotice("");
    setRequestError(null);
    setRequestMessage("");

    try {
      await authenticatedRequest("/v1/reviews", {
        method: "POST",
        body: JSON.stringify({ bookingId: booking.id, rating, comment: trimmedComment }),
      });
      setSubmitted(true);
      setNotice("เผยแพร่รีวิวแล้ว");
    } catch (error) {
      setRequestError("submit");
      setRequestMessage(error instanceof Error ? error.message : "ส่งรีวิวไม่สำเร็จ กรุณาลองอีกครั้ง");
      busyRef.current = false;
      setBusy(false);
      return;
    }

    try {
      await onUpdated();
    } catch {
      setNotice("");
      setRequestError("refresh");
      setRequestMessage("ส่งรีวิวแล้ว แต่โหลดข้อมูลล่าสุดไม่สำเร็จ");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function retryRefresh() {
    if (busyRef.current || !submitted) return;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    setRequestMessage("");
    try {
      await onUpdated();
      setRequestError(null);
      setNotice("โหลดรีวิวล่าสุดแล้ว");
    } catch {
      setRequestError("refresh");
      setRequestMessage("ยังโหลดรีวิวล่าสุดไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const ratingErrorId = `${formId}-rating-error`;
  const commentErrorId = `${formId}-comment-error`;
  const commentGuideId = `${formId}-comment-guide`;
  const showForm = booking.actions.canReview && !submitted;
  const visibleReviewStatus = submitted
    ? reviewStatusCopy.published
    : booking.review
      ? reviewStatusCopy[booking.review.status]
      : "ยังไม่มีรีวิวที่เผยแพร่";

  return (
    <section className="review-form guided-transaction-panel" aria-labelledby={`${formId}-title`}>
      <div className="transaction-status-summary">
        <span>สถานะรีวิว</span>
        <strong id={`${formId}-title`}>{visibleReviewStatus}</strong>
        {booking.review && (
          <div className="published-review-summary">
            <span>{booking.review.rating} จาก 5 ดาว</span>
            <p>{booking.review.comment}</p>
          </div>
        )}
      </div>
      {showForm && (
        <form className="booking-fields transaction-primary-action" onSubmit={submit} aria-busy={busy} noValidate>
          <div className="transaction-primary-action__heading">
            <strong>เขียนรีวิวหลังการฝึก</strong>
            <span>รีวิวจะเผยแพร่หลังส่งสำเร็จ</span>
          </div>
          <fieldset className="field" aria-describedby={fieldErrors.rating ? ratingErrorId : undefined}>
            <legend>คะแนนการฝึก</legend>
            <div className="ledger-actions">
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} htmlFor={`${formId}-rating-${value}`}>
                  <input
                    id={`${formId}-rating-${value}`}
                    name={`${formId}-rating`}
                    type="radio"
                    value={value}
                    checked={rating === value}
                    disabled={busy || !booking.actions.canReview}
                    onChange={() => {
                      setRating(value);
                      setFieldErrors((current) => ({ ...current, rating: undefined }));
                    }}
                  />
                  {value} ดาว
                </label>
              ))}
            </div>
            {fieldErrors.rating && <small className="field-error" id={ratingErrorId}>{fieldErrors.rating}</small>}
          </fieldset>
          <div className="field">
            <Label htmlFor={`${formId}-comment`}>ความคิดเห็น</Label>
            <Textarea
              id={`${formId}-comment`}
              value={comment}
              disabled={busy || !booking.actions.canReview}
              aria-invalid={Boolean(fieldErrors.comment)}
              aria-describedby={`${commentGuideId}${fieldErrors.comment ? ` ${commentErrorId}` : ""}`}
              onChange={(event) => {
                setComment(event.target.value);
                setFieldErrors((current) => ({ ...current, comment: undefined }));
              }}
            />
            <small id={commentGuideId}>เขียน 1 ถึง 2,000 ตัวอักษร ขณะนี้ {Array.from(comment).length.toLocaleString("th-TH")} ตัวอักษร</small>
            {fieldErrors.comment && <small className="field-error" id={commentErrorId}>{fieldErrors.comment}</small>}
          </div>
          <Button className="button button--accent" type="submit" disabled={busy || !booking.actions.canReview}>
            {busy ? "กำลังส่งรีวิว…" : requestError === "submit" ? "ลองส่งอีกครั้ง" : "ส่งรีวิว"}
          </Button>
        </form>
      )}

      {!booking.actions.canReview && !submitted && (
        <div className="ledger-row"><span>การเขียนรีวิว</span><strong>ยังเขียนรีวิวไม่ได้ตามสถานะการจองนี้</strong></div>
      )}
      {requestMessage && (
        <div ref={feedbackRef as React.RefObject<HTMLDivElement>} className="workbench-error" role="alert" tabIndex={-1}>
          <span>{requestMessage}</span>
          {requestError === "refresh" && (
            <button type="button" disabled={busy} onClick={() => void retryRefresh()}>
              <RefreshCw aria-hidden="true" size={15} /> {busy ? "กำลังโหลด…" : "ลองโหลดรีวิวใหม่"}
            </button>
          )}
        </div>
      )}
      {notice && <p ref={feedbackRef as React.RefObject<HTMLParagraphElement>} className="queue-notice" role="status" tabIndex={-1}>{notice}</p>}
    </section>
  );
}
