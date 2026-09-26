"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Clock3, ShieldCheck } from "lucide-react";
import { SlotCalendarDialog } from "@/components/slot-calendar-dialog";
import { StartChatButton } from "@/components/start-chat-button";
import { Button } from "@/components/ui/button";
import { formatMoney, formatTimeRange } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

type Props = {
  trainer: Trainer;
  selectedSlot: AvailabilitySlot | null;
  onSelectSlot: (slot: AvailabilitySlot) => void;
};

export function ProfileBookingPanel({ trainer, selectedSlot, onSelectSlot }: Props) {
  const [bookingType, setBookingType] = useState<"single" | "monthly">("single");
  const [monthlyFirstSlot, setMonthlyFirstSlot] = useState<AvailabilitySlot | null>(null);
  const availableSlots = trainer.slots.filter((slot) => slot.available);
  const hasPrice = typeof trainer.priceFrom === "number" && trainer.priceFrom > 0;
  const monthlyAvailable = typeof trainer.monthlyPrice === "number"
    && trainer.monthlyPrice > 0
    && typeof trainer.monthlySessionCount === "number"
    && trainer.monthlySessionCount >= 2;
  const isMonthly = bookingType === "monthly";
  const hasSelectedTimes = isMonthly
    ? Boolean(monthlyFirstSlot)
    : Boolean(selectedSlot);
  const canBook = trainer.verification === "verified"
    && (isMonthly ? monthlyAvailable : hasPrice)
    && hasSelectedTimes;
  // The button label is the short reason; the sentence under it says what to do.
  const blockedReason = isMonthly && !monthlyAvailable
    ? "ยังไม่มีแพ็กเกจรายเดือน"
    : !isMonthly && !hasPrice
      ? "ยังจองไม่ได้"
      : trainer.verification !== "verified"
        ? "รอตรวจโปรไฟล์"
        : isMonthly
          ? "เลือกเวลานัดแรก"
          : "เลือกเวลาก่อน";
  const changeTimeButtonRef = useRef<HTMLButtonElement>(null);
  const previousSlotId = useRef(selectedSlot?.id ?? null);

  useEffect(() => {
    const currentSlotId = selectedSlot?.id ?? null;
    const isFirstSelection = previousSlotId.current === null && currentSlotId !== null;
    previousSlotId.current = currentSlotId;
    if (isFirstSelection) changeTimeButtonRef.current?.focus();
  }, [selectedSlot]);

  return (
    <aside id="booking-panel" className="profile-booking-panel" aria-label="เลือกเวลาฝึก">
      <div className="profile-booking-panel__heading">
        <p className="label">จองโดยตรง</p>
        <h2>เลือกเวลาฝึก</h2>
        <p>เลือกช่วงที่ว่าง แล้วตรวจรายละเอียดอีกครั้งก่อนเริ่มจับเวลา</p>
      </div>

      <div className="profile-booking-types" role="group" aria-label="รูปแบบการจอง">
        <Button type="button" aria-pressed={!isMonthly} variant={isMonthly ? "outline" : "default"} onClick={() => setBookingType("single")}>รายครั้ง</Button>
        <Button type="button" aria-pressed={isMonthly} variant={isMonthly ? "default" : "outline"} disabled={!monthlyAvailable} onClick={() => setBookingType("monthly")}>แพ็กเกจ 30 วัน</Button>
      </div>

      <dl className="profile-booking-price">
        <div>
          <dt>{isMonthly ? "ราคาแพ็กเกจ" : "ค่าฝึกต่อครั้ง"}</dt>
          <dd>{isMonthly
            ? (monthlyAvailable ? formatMoney(trainer.monthlyPrice as number) : "—")
            : (hasPrice ? formatMoney(trainer.priceFrom as number) : "—")}</dd>
        </div>
      </dl>

      {/* A payment QR used to sit here, before any booking existed. It invited a
          scan off-platform — no hold, no slip, no record — and the amount is only
          known once a booking exists. The trainer's uploaded QR now appears in
          the payment step instead, where the amount and the review are attached. */}

      {isMonthly && monthlyAvailable && (
        <div className="profile-booking-package-facts">
          <strong>{trainer.monthlySessionCount} ครั้ง ภายใน 30 วัน</strong>
          <span>เลือกนัดแรกก่อน อีก {(trainer.monthlySessionCount as number) - 1} นัดจัดเวลาได้หลังชำระเงินผ่าน</span>
        </div>
      )}

      {!isMonthly && !hasPrice && (
        <p className="profile-booking-warning" role="status">
          เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก
        </p>
      )}

      {isMonthly ? (
        <div className="profile-booking-selection" aria-live="polite">
          <CalendarDays aria-hidden="true" size={18} />
          <span>
            <strong>{monthlyFirstSlot ? "เลือกเวลานัดแรกแล้ว" : "เลือกเวลานัดแรก"}</strong>
            {monthlyFirstSlot ? formatTimeRange(monthlyFirstSlot.startsAt, monthlyFirstSlot.endsAt) : `นัดแรก 1 จาก ${trainer.monthlySessionCount ?? 0} ครั้ง`}
          </span>
          {monthlyAvailable && (
            <SlotCalendarDialog
              trainerName={trainer.displayName}
              slots={availableSlots}
              selectedSlot={monthlyFirstSlot}
              monthlyFirstSession
              onConfirm={setMonthlyFirstSlot}
            >
              <Button type="button" variant="outline">{monthlyFirstSlot ? "เปลี่ยนเวลานัดแรก" : "เลือกเวลานัดแรก"}</Button>
            </SlotCalendarDialog>
          )}
        </div>
      ) : selectedSlot ? (
        <div className="profile-booking-selection" aria-live="polite">
          <Clock3 aria-hidden="true" size={18} />
          <span>
            <strong>เลือกเวลาแล้ว</strong>
            {formatTimeRange(selectedSlot.startsAt, selectedSlot.endsAt)}
          </span>
          <SlotCalendarDialog
            trainerName={trainer.displayName}
            slots={availableSlots}
            selectedSlot={selectedSlot}
            onConfirm={onSelectSlot}
          >
            <Button ref={changeTimeButtonRef} type="button" variant="outline">
              เปลี่ยนเวลา
            </Button>
          </SlotCalendarDialog>
        </div>
      ) : (
        <SlotCalendarDialog
          trainerName={trainer.displayName}
          slots={availableSlots}
          selectedSlot={selectedSlot}
          onConfirm={onSelectSlot}
        >
          <Button
            type="button"
            variant="outline"
            className="profile-booking-calendar-trigger"
            disabled={availableSlots.length === 0}
          >
            <CalendarDays aria-hidden="true" />
            <span>
              <strong>
                {availableSlots.length > 0
                  ? "ดูตารางว่างทั้งหมด"
                  : "ยังไม่มีเวลาว่างให้จอง"}
              </strong>
              <small>{availableSlots.length} ช่วงพร้อมจอง</small>
            </span>
          </Button>
        </SlotCalendarDialog>
      )}

      <div className="profile-booking-policy">
        <ShieldCheck aria-hidden="true" size={18} />
        <p>เทรนเนอร์ตอบรับแล้ว ระบบจะแจ้งยืนยันในรอบ 12:00 หรือ 18:00 น. จากนั้นมีเวลา 10 นาทีส่งสลิปให้เทรนเนอร์ตรวจและยืนยัน หากไม่ทันการจองจะหมดอายุและคืนเวลาอัตโนมัติ</p>
      </div>

      {canBook ? (
        <Button className="button button--accent button--wide" asChild>
          <Link href={isMonthly
            ? `/booking?trainer=${trainer.slug}&type=monthly&slots=${monthlyFirstSlot?.id}`
            : `/booking?trainer=${trainer.slug}&slot=${selectedSlot?.id}`}>
            {isMonthly ? "จองแพ็กเกจนี้" : "จองเวลานี้"} <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </Button>
      ) : (
        <>
          {/* A disabled button that only repeats its own state reads like a
              broken control, so the panel says what is still missing. */}
          <Button className="button button--wide" type="button" disabled aria-describedby="booking-blocked-reason">
            {blockedReason}
          </Button>
          <p className="profile-booking-blocked" id="booking-blocked-reason">
            {isMonthly && !monthlyAvailable
              ? "เทรนเนอร์รายนี้ยังไม่เปิดแพ็กเกจ 30 วัน เลือกแบบรายครั้งได้"
              : !isMonthly && !hasPrice
                ? "เทรนเนอร์ยังไม่ประกาศค่าฝึก จึงยังจองไม่ได้"
                : trainer.verification !== "verified"
                  ? "ผู้ดูแลระบบยังตรวจใบสมัครของเทรนเนอร์ไม่เสร็จ"
                  : isMonthly
                    ? "เลือกเวลานัดแรกจากตารางว่างด้านบนก่อนจึงจะจองได้"
                    : "เลือกเวลาจากตารางว่างด้านบนก่อนจึงจะจองได้"}
          </p>
        </>
      )}

      {trainer.verification === "verified" && (
        <StartChatButton trainerId={trainer.id} trainerSlug={trainer.slug} trainerName={trainer.displayName} />
      )}
    </aside>
  );
}
