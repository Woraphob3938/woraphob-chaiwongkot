import Link from "next/link";
import { ArrowRight, Clock3, ShieldCheck } from "lucide-react";
import { AvailabilityPanel } from "@/components/availability-panel";
import { DisclosureSection } from "@/components/disclosure-section";
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

      <DisclosureSection
        title="ตารางว่างทั้งหมด"
        summary={`${availableSlots.length} ช่วงพร้อมจอง`}
        defaultOpen
        className="profile-booking-schedule"
      >
        <AvailabilityPanel
          trainer={trainer}
          selectedSlot={selectedSlot}
          onSelectSlot={onSelectSlot}
        />
      </DisclosureSection>

      {selectedSlot && (
        <div className="profile-booking-selection" aria-live="polite">
          <Clock3 aria-hidden="true" size={18} />
          <span>
            <strong>{formatDay(selectedSlot.startsAt)}</strong>
            {formatTime(selectedSlot.startsAt)}–{formatTime(selectedSlot.endsAt)} น.
          </span>
        </div>
      )}

      <div className="profile-booking-policy">
        <ShieldCheck aria-hidden="true" size={18} />
        <p>ระบบจะเก็บเวลาที่เลือกไว้ 10 นาทีหลังยืนยัน</p>
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
