import Link from "next/link";
import { MessageSquareText } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { hasValidBookingPeriod } from "@/lib/dashboard-actions";
import { formatDateTime, formatMoney, formatTime, initials } from "@/lib/format";
import type { Booking } from "@/lib/types";

/** The button that opened a dialog, so focus can return to it on close. */
export type Trigger = { currentTarget: HTMLElement };

/** reject: an unanswered request · cancel: a booking past the request. */
export type DecisionKind = "reject" | "cancel";

export const decisionCopy: Record<DecisionKind, { title: string; verb: string; confirm: string; done: string }> = {
  reject: { title: "ปฏิเสธคำขอจอง", verb: "ปฏิเสธ", confirm: "ยืนยันปฏิเสธ", done: "ปฏิเสธคำขอ" },
  cancel: { title: "ยกเลิกการจอง", verb: "ยกเลิก", confirm: "ยืนยันยกเลิกการจอง", done: "ยกเลิกการจอง" },
};

export function isPendingTrainer(booking: { status: string }) {
  return booking.status === "pending_trainer";
}

/** Whether the trainer is the one who has to act next on this booking. */
export function needsTrainer(booking: Booking) {
  return isPendingTrainer(booking) || booking.status === "payment_review";
}

/** A trainer may cancel any booking that is not closed yet, per the workflow. */
export const TRAINER_CANCELLABLE_STATUSES = ["pending_trainer", "awaiting_payment", "payment_review", "confirmed"];

export function canTrainerCancel(booking: Booking) {
  return booking.actions.canCancelBooking ?? TRAINER_CANCELLABLE_STATUSES.includes(booking.status);
}

/** One line telling the trainer what this request is waiting on. */
export function requestHint(booking: Booking): string {
  if (booking.status === "pending_trainer") return "ตอบรับแล้วสมาชิกชำระเงินได้ทันทีภายใน 10 นาที เวลาฝึกยังเป็นเวลาที่สมาชิกขอ";
  if (booking.status === "awaiting_payment") return "รอสมาชิกชำระเงินออนไลน์ภายใน 10 นาทีหลังคุณตอบรับ";
  if (booking.status === "payment_review") return "รายการชำระเงินเดิมรอตรวจสอบ";
  return "";
}

export function requestedStart(booking: Booking) {
  return booking.requestedStartsAt ?? booking.startsAt;
}

/** "ช่วงเวลาที่ยืนยัน" as one readable range, or null before the trainer answered. */
export function confirmedPeriodLabel(booking: Booking): string | null {
  const start = booking.confirmedStartsAt;
  return start ? `${formatDateTime(start)} – ${formatTime(booking.confirmedEndsAt ?? start)} น.` : null;
}

export function requestedPeriodLabel(booking: Booking): string {
  return `${formatDateTime(requestedStart(booking))} – ${formatTime(booking.endsAt)} น.`;
}

export function AppointmentRow({ booking, session, isBusy, onComplete, onDetails }: {
  booking: Booking;
  session?: { startsAt: string };
  isBusy: boolean;
  onComplete: (event: Trigger) => void;
  onDetails: (event: Trigger) => void;
}) {
  const validPeriod = hasValidBookingPeriod(booking);
  const canComplete = validPeriod && booking.actions.canComplete;
  return (
    <article className="trainer-appointment-row" id={`booking-${booking.id}`} aria-busy={isBusy}>
      <div className="trainer-appointment-row__who"><span className="trainer-avatar" aria-hidden="true">{initials(booking.member?.displayName ?? "สมาชิก")}</span><span><strong>{booking.member?.displayName ?? "สมาชิก FitConnect"}</strong><small>{booking.id}</small></span></div>
      <div className="trainer-appointment-row__when"><span>{formatDateTime(session?.startsAt ?? booking.startsAt)}</span><small className={canComplete ? "trainer-appointment-row__pending" : undefined}>{canComplete ? "รอบันทึกผลการฝึก" : session ? "นัดที่กำลังจะถึง" : "รอจัดเวลาที่เหลือ / ตรวจรายละเอียด"}</small></div>
      {/* The row carries the action it is asking for, so the next-action card
          does not hand the trainer a place where the action does not exist. */}
      <div className="queue-actions">
        {canComplete && (
          <button
            type="button"
            className="queue-actions__primary"
            disabled={isBusy}
            aria-label={`บันทึกผลการฝึก ${booking.id}`}
            onClick={onComplete}
          >
            {isBusy ? "กำลังบันทึก…" : "บันทึกผลการฝึก"}
          </button>
        )}
        {!validPeriod && <span>ข้อมูลเวลาไม่ถูกต้อง</span>}
        <button type="button" className="queue-actions__quiet" onClick={onDetails}>ดูรายละเอียด</button>
      </div>
    </article>
  );
}

/** A booking still waiting on the trainer's decision or its payment step. */
export function RequestCard({ booking, isBusy, onAccept, onDecide, onDetails }: {
  booking: Booking;
  isBusy: boolean;
  onAccept: (event: Trigger) => void;
  onDecide: (kind: DecisionKind, event: Trigger) => void;
  onDetails: (event: Trigger) => void;
}) {
  const pending = isPendingTrainer(booking);
  const confirmedLabel = confirmedPeriodLabel(booking);
  return (
    <article className={`trainer-booking-card${needsTrainer(booking) ? "" : " is-waiting"}`} id={`request-${booking.id}`} aria-busy={isBusy}>
      <div className="trainer-booking-card__identity">
        <span className="trainer-avatar" aria-hidden="true">{initials(booking.member?.displayName ?? "สมาชิก")}</span>
        <div>
          <h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3>
          <span className="trainer-booking-card__meta"><span>{booking.id}</span><span>{booking.bookingType === "monthly" ? `แพ็กเกจ ${booking.sessionCount} ครั้ง` : "รายครั้ง"}</span></span>
        </div>
        <StatusBadge status={booking.status} />
      </div>
      <p className="trainer-booking-card__hint">{requestHint(booking)}</p>
      <dl>
        {confirmedLabel ? (
          <div className="trainer-booking-card__confirmed"><dt>ช่วงเวลาที่ยืนยัน</dt><dd><strong>{confirmedLabel}</strong></dd></div>
        ) : (
          <div><dt>ช่วงเวลาที่ต้องการ</dt><dd>{formatDateTime(requestedStart(booking))} – {formatTime(booking.endsAt)} น.</dd></div>
        )}
        <div><dt>ค่าฝึก</dt><dd>{formatMoney(booking.quotedPrice ?? undefined)}</dd></div>
      </dl>
      {booking.note && (
        <div className="trainer-booking-card__note">
          <span>บันทึกเพิ่มเติมจากสมาชิก</span>
          <p>{booking.note}</p>
        </div>
      )}
      <div className="queue-actions">
        {pending && (booking.actions.canAccept ?? true) && (
          <button
            type="button"
            className="queue-actions__primary"
            disabled={isBusy}
            aria-label={`ตอบรับ ${booking.id}`}
            onClick={onAccept}
          >
            ตอบรับ
          </button>
        )}
        {pending && (booking.actions.canReject ?? true) && (
          <button
            type="button"
            disabled={isBusy}
            aria-label={`ปฏิเสธ ${booking.id}`}
            onClick={(event) => onDecide("reject", event)}
          >
            ปฏิเสธ
          </button>
        )}
        {!pending && canTrainerCancel(booking) && (
          <button
            type="button"
            disabled={isBusy}
            aria-label={`ยกเลิกการจอง ${booking.id}`}
            onClick={(event) => onDecide("cancel", event)}
          >
            ยกเลิกการจอง
          </button>
        )}
        <button type="button" className="queue-actions__quiet" onClick={onDetails}>ดูรายละเอียด</button>
      </div>
    </article>
  );
}

/** Everything about one booking, shown in the appointment dialog. */
export function BookingDetail({ booking, isBusy, onCancel, onComplete }: {
  booking: Booking;
  isBusy: boolean;
  onCancel: (event: Trigger) => void;
  onComplete: () => void;
}) {
  const validPeriod = hasValidBookingPeriod(booking);
  const confirmedLabel = confirmedPeriodLabel(booking);
  const cancellationReason = booking.cancellationReason;
  return (
    <article className="trainer-booking-card" aria-busy={isBusy}>
      <div className="trainer-booking-card__identity"><span>{booking.id}</span><h3>{booking.member?.displayName ?? "สมาชิก FitConnect"}</h3></div>
      <dl>
        {/* The period the trainer confirmed leads: when it differs from the
            request it is the time both sides now work from. */}
        {confirmedLabel && (
          <div className="trainer-booking-card__confirmed"><dt>ช่วงเวลาที่ยืนยัน</dt><dd><strong>{confirmedLabel}</strong></dd></div>
        )}
        <div><dt>เริ่มฝึก</dt><dd>{formatDateTime(booking.startsAt)}</dd></div>
        <div><dt>สิ้นสุด</dt><dd>{formatDateTime(booking.endsAt)}</dd></div>
        {/* A booking carries its own price and the review state that makes the
            money real, so nothing has to be recalled from an aggregate. */}
        <div><dt>ค่าฝึก</dt><dd>{formatMoney(booking.quotedPrice ?? undefined)}</dd></div>
        <div><dt>การชำระเงิน</dt><dd><StatusBadge status={booking.status} /></dd></div>
      </dl>
      {(booking.member?.goals || booking.member?.medicalNote || booking.member?.weight || booking.member?.height) && (
        <div className="trainer-booking-card__health text-sm space-y-1 my-2 p-2 bg-muted/40 rounded">
          {booking.member.goals && <div><span className="font-semibold text-xs text-muted-foreground">เป้าหมาย:</span> {booking.member.goals}</div>}
          {(booking.member.weight || booking.member.height) && (
            <div className="text-xs text-muted-foreground">
              {booking.member.weight && <span>น้ำหนัก: {booking.member.weight} กก. </span>}
              {booking.member.height && <span>ส่วนสูง: {booking.member.height} ซม.</span>}
            </div>
          )}
          {booking.member.medicalNote && <div className="text-destructive text-xs"><span>ข้อควรระวัง:</span> {booking.member.medicalNote}</div>}
        </div>
      )}
      {booking.note && (
        <div className="trainer-booking-card__note">
          <span>บันทึกเพิ่มเติมจากสมาชิก</span>
          <p>{booking.note}</p>
        </div>
      )}
      {cancellationReason && (
        <div className="trainer-booking-card__note text-sm my-2 p-2 bg-accent/20 rounded">
          <span className="font-semibold text-xs text-muted-foreground">เหตุผลที่ยกเลิก:</span>
          <p>{cancellationReason}</p>
        </div>
      )}
      {booking.bookingType === "monthly" && (
        <div className="monthly-booking-sessions">
          <strong>แพ็กเกจ 30 วัน · {booking.sessionCount ?? booking.sessions?.length ?? 0} ครั้ง</strong>
          <ol>{(booking.sessions ?? []).map((session) => <li key={`${session.id}-${session.startsAt}`}>{formatDateTime(session.startsAt)}</li>)}</ol>
        </div>
      )}
      <div className="queue-actions">
        {!validPeriod && <span className="booking-time-error">ข้อมูลเวลาไม่ถูกต้อง</span>}
        {canTrainerCancel(booking) && (
          <button
            type="button"
            disabled={isBusy}
            aria-label={`ยกเลิกการจอง ${booking.id}`}
            onClick={onCancel}
          >
            ยกเลิกการจอง
          </button>
        )}
        {validPeriod && !booking.actions.canComplete && <span>บันทึกผลได้หลัง {formatDateTime(booking.endsAt)}</span>}
        {booking.actions.canReadChat && (
          <Link href={`/chat?booking=${encodeURIComponent(booking.id)}`}>
            <MessageSquareText aria-hidden="true" size={17} /> เปิดการสนทนา
          </Link>
        )}
        {validPeriod && <button type="button" disabled={!booking.actions.canComplete || isBusy} aria-label={`${booking.actions.canComplete ? "บันทึกผลการฝึก" : "รอสิ้นสุดการฝึก"} ${booking.id}`} onClick={onComplete}>
          {isBusy ? "กำลังบันทึก…" : booking.actions.canComplete ? "บันทึกผลการฝึก" : "รอสิ้นสุดการฝึก"}
        </button>}
      </div>
    </article>
  );
}
