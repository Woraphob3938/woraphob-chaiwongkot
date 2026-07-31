import { CalendarDays, Clock3 } from "lucide-react";
import { formatDay, formatTime } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

type Props = {
  trainer: Trainer;
  selectedSlot: AvailabilitySlot | null;
  onSelectSlot: (slot: AvailabilitySlot) => void;
};

export function AvailabilityPanel({ trainer, selectedSlot, onSelectSlot }: Props) {
  return (
    <section className="availability-panel" aria-labelledby="availability-title">
      <div className="section-line-heading">
        <div>
          <p className="label">ตารางพร้อมจอง</p>
          <h2 id="availability-title">เลือกเวลาที่เข้ากับคุณ</h2>
        </div>
        <CalendarDays aria-hidden="true" size={22} />
      </div>
      <p className="panel-note">เวลาประเทศไทย · แสดงเฉพาะช่วงว่างของ {trainer.displayName}</p>

      <div className="slot-list">
        {trainer.slots.filter((slot) => slot.available).map((slot) => {
          const selected = selectedSlot?.id === slot.id;
          return (
            <button
              className={`slot-button${selected ? " is-selected" : ""}`}
              type="button"
              key={slot.id}
              aria-pressed={selected}
              onClick={() => onSelectSlot(slot)}
            >
              <span>{formatDay(slot.startsAt)}</span>
              <strong><Clock3 aria-hidden="true" size={16} /> {formatTime(slot.startsAt)}–{formatTime(slot.endsAt)}</strong>
            </button>
          );
        })}
      </div>
      <p className="availability-help">เทรนเนอร์จะตรวจคำขออีกครั้งก่อนเข้าสู่ขั้นตอนชำระเงิน</p>
    </section>
  );
}
