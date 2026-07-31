import Link from "next/link";
import { ArrowRight, CalendarCheck2, ShieldCheck } from "lucide-react";
import { formatDay, formatMoney, formatTime } from "@/lib/format";
import type { AvailabilitySlot, Trainer } from "@/lib/types";

type Props = {
  trainer: Trainer | null;
  slot: AvailabilitySlot | null;
};

export function BookingStrip({ trainer, slot }: Props) {
  const ready = Boolean(trainer && slot && trainer.verification === "verified");
  const params = new URLSearchParams();
  if (trainer) params.set("trainer", trainer.slug);
  if (slot) params.set("slot", String(slot.id));

  return (
    <aside className="booking-strip" aria-label="สรุปการจอง">
      <div className="booking-strip__inner">
        <div className="booking-state">
          <span className="booking-state__icon"><CalendarCheck2 aria-hidden="true" size={21} /></span>
          <div>
            <p className="label">แถบจองของคุณ</p>
            <strong>{trainer ? trainer.displayName : "เลือกเทรนเนอร์เพื่อเริ่มต้น"}</strong>
            <span className="booking-mobile-meta">
              {trainer?.verification === "verified" ? "ตรวจคุณสมบัติแล้ว" : "ยังไม่ยืนยันคุณสมบัติ"}
              {" · "}
              {slot ? `${formatDay(slot.startsAt)} ${formatTime(slot.startsAt)}` : "ยังไม่เลือกเวลา"}
            </span>
          </div>
        </div>
        <div className="booking-detail">
          <span>วันและเวลา</span>
          <strong>{slot ? `${formatDay(slot.startsAt)} · ${formatTime(slot.startsAt)}` : "ยังไม่ได้เลือก"}</strong>
        </div>
        <div className="booking-detail">
          <span>ราคาเริ่มต้น</span>
          <strong>{trainer ? formatMoney(trainer.priceFrom) : "—"}</strong>
        </div>
        <div className="booking-trust">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>{trainer?.verification === "verified" ? "คุณสมบัติตรวจแล้ว" : "เลือกโปรไฟล์ที่ตรวจแล้ว"}</span>
        </div>
        {ready ? (
          <Link className="button button--accent booking-cta" href={`/booking?${params.toString()}`}>
            ส่งคำขอจอง <ArrowRight aria-hidden="true" size={18} />
          </Link>
        ) : (
          <button className="button button--disabled booking-cta" type="button" disabled>
            {!trainer ? "เลือกเทรนเนอร์" : trainer.verification !== "verified" ? "รอการตรวจคุณสมบัติ" : "เลือกเวลา"}
          </button>
        )}
      </div>
    </aside>
  );
}
