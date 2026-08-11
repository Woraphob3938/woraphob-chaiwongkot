"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, CalendarDays, Clock3, ShieldCheck } from "lucide-react";
import { SlotCalendarDialog } from "@/components/slot-calendar-dialog";
import { Button } from "@/components/ui/button";
import { formatDay, formatMoney, formatTime } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

type Props = {
  trainer: Trainer;
  selectedSlot: AvailabilitySlot | null;
  onSelectSlot: (slot: AvailabilitySlot) => void;
};

export function ProfileBookingPanel({ trainer, selectedSlot, onSelectSlot }: Props) {
  const availableSlots = trainer.slots.filter((slot) => slot.available);
  const hasPrice = typeof trainer.priceFrom === "number" && trainer.priceFrom > 0;
  const canBook = trainer.verification === "verified" && hasPrice && selectedSlot;
  const changeTimeButtonRef = useRef<HTMLButtonElement>(null);
  const previousSlotId = useRef(selectedSlot?.id ?? null);

  useEffect(() => {
    const currentSlotId = selectedSlot?.id ?? null;
    const isFirstSelection = previousSlotId.current === null && currentSlotId !== null;
    previousSlotId.current = currentSlotId;
    if (isFirstSelection) changeTimeButtonRef.current?.focus();
  }, [selectedSlot]);

  return (
    <aside className="profile-booking-panel" aria-label="เลือกเวลาฝึก">
      <div className="profile-booking-panel__heading">
        <p className="label">จองโดยตรง</p>
        <h2>เลือกเวลาฝึก</h2>
        <p>เลือกช่วงที่ว่าง แล้วตรวจรายละเอียดอีกครั้งก่อนเริ่มจับเวลา</p>
      </div>

      <dl className="profile-booking-price">
        <div>
          <dt>ค่าฝึกต่อครั้ง</dt>
          <dd>{hasPrice ? formatMoney(trainer.priceFrom as number) : "—"}</dd>
        </div>
      </dl>

      {!hasPrice && (
        <p className="profile-booking-warning" role="status">
          เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก
        </p>
      )}

      {selectedSlot ? (
        <div className="profile-booking-selection" aria-live="polite">
          <Clock3 aria-hidden="true" size={18} />
          <span>
            <strong>เลือกเวลาแล้ว</strong>
            {formatDay(selectedSlot.startsAt)} · {formatTime(selectedSlot.startsAt)} ถึง{" "}
            {formatTime(selectedSlot.endsAt)} น.
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
        <p>เวลา 10 นาทีเริ่มหลังยืนยันการจองในขั้นตอนถัดไป</p>
      </div>

      {canBook ? (
        <Button className="button button--accent button--wide" asChild>
          <Link href={`/booking?trainer=${trainer.slug}&slot=${selectedSlot.id}`}>
            จองเวลานี้ <ArrowRight aria-hidden="true" size={18} />
          </Link>
        </Button>
      ) : (
        <Button className="button button--wide" type="button" disabled>
          {!hasPrice
            ? "ยังจองไม่ได้"
            : trainer.verification !== "verified"
              ? "รอตรวจคุณสมบัติ"
              : "เลือกเวลาก่อน"}
        </Button>
      )}
    </aside>
  );
}
