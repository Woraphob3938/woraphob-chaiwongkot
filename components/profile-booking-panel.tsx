"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Clock3, ShieldCheck } from "lucide-react";
import { SlotCalendarDialog } from "@/components/slot-calendar-dialog";
import { Button } from "@/components/ui/button";
import { formatMoney, formatTimeRange } from "@/lib/format";
import { apiAssetUrl } from "@/lib/api";
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

      {trainer.paymentQrUrl && (
        <details className="profile-payment-qr">
          <summary>ดู QR รับเงินของเทรนเนอร์</summary>
          <div>
            <Image src={apiAssetUrl(trainer.paymentQrUrl) as string} alt={`QR รับเงินของ ${trainer.displayName}`} width={180} height={180} unoptimized />
            <p>ใช้หลังระบบแสดงยอดชำระแล้ว และตรวจชื่อผู้รับในแอปธนาคารก่อนโอนทุกครั้ง</p>
          </div>
        </details>
      )}

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
        <p>ยืนยันแล้วระบบกันเวลานัดแรกไว้ 10 นาที ต้องส่งสลิปให้{trainer.serviceMode === "freelance" ? "เทรนเนอร์ฟรีแลนซ์" : "ผู้ดูแลระบบ"}ตรวจอนุมัติ หากไม่ส่งทันเวลาการจองจะหมดอายุและคืนเวลาอัตโนมัติ</p>
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
        <Button className="button button--wide" type="button" disabled>
          {isMonthly && !monthlyAvailable
            ? "ยังไม่มีแพ็กเกจรายเดือน"
            : !isMonthly && !hasPrice
            ? "ยังจองไม่ได้"
            : trainer.verification !== "verified"
              ? "รอตรวจคุณสมบัติ"
              : isMonthly
                ? "เลือกเวลานัดแรก"
                : "เลือกเวลาก่อน"}
        </Button>
      )}
    </aside>
  );
}
