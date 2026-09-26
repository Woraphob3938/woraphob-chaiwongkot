"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarPlus, LoaderCircle } from "lucide-react";
import { SlotCalendarDialog } from "@/components/slot-calendar-dialog";
import { Button } from "@/components/ui/button";
import { authenticatedRequest } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { AvailabilitySlot, Booking, Trainer } from "@/lib/types";

export function MonthlySessionScheduler({ booking, onUpdated }: { booking: Booking; onUpdated: () => Promise<void> }) {
  const [trainer, setTrainer] = useState<Trainer | null>(null);
  const [selected, setSelected] = useState<AvailabilitySlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function loadTrainer() {
    setLoading(true);
    setMessage("");
    try {
      setTrainer(await authenticatedRequest<Trainer>(`/v1/trainers/${encodeURIComponent(booking.trainer.slug)}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "โหลดเวลาว่างไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void authenticatedRequest<Trainer>(`/v1/trainers/${encodeURIComponent(booking.trainer.slug)}`)
      .then((data) => { if (active) setTrainer(data); })
      .catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "โหลดเวลาว่างไม่สำเร็จ"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [booking.trainer.slug]);

  const slots = useMemo(() => {
    if (!trainer || !booking.periodStart || !booking.periodEnd) return [];
    const used = new Set((booking.sessions ?? []).map((session) => session.id));
    const start = new Date(booking.periodStart).getTime();
    const end = new Date(booking.periodEnd).getTime();
    return trainer.slots.filter((slot) => slot.available && !used.has(slot.id)
      && new Date(slot.startsAt).getTime() >= start && new Date(slot.endsAt).getTime() <= end);
  }, [booking.periodEnd, booking.periodStart, booking.sessions, trainer]);

  const scheduled = booking.sessions?.length ?? 0;
  const total = booking.sessionCount ?? scheduled;

  async function addSession() {
    if (!selected || pending) return;
    setPending(true);
    setMessage("");
    try {
      await authenticatedRequest(`/v1/bookings/${encodeURIComponent(booking.id)}/sessions`, {
        method: "POST",
        body: JSON.stringify({ slotId: selected.id }),
      });
      setSelected(null);
      await onUpdated();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "เพิ่มนัดหมายไม่สำเร็จ");
      await loadTrainer();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="monthly-session-scheduler" aria-label="จัดเวลาที่เหลือในแพ็กเกจ">
      <div>
        <strong>จัดเวลาที่เหลือ</strong>
        <span>กำหนดแล้ว {scheduled} จาก {total} ครั้ง · ภายใน 30 วันจากนัดแรก</span>
      </div>
      {loading ? <p aria-live="polite"><LoaderCircle className="spin" aria-hidden="true" /> กำลังโหลดเวลาว่าง…</p> : (
        <>
          {slots.length > 0 ? (
            <SlotCalendarDialog trainerName={booking.trainer.displayName} slots={slots} selectedSlot={selected} onConfirm={setSelected}>
              <Button type="button" variant="outline"><CalendarPlus aria-hidden="true" /> {selected ? "เปลี่ยนเวลา" : `จัดเวลานัดที่ ${scheduled + 1}`}</Button>
            </SlotCalendarDialog>
          ) : <p>ยังไม่มีช่วงว่างในระยะเวลาแพ็กเกจ</p>}
          {selected && <p className="monthly-session-scheduler__selection">นัดที่เลือก: {formatDateTime(selected.startsAt)}</p>}
          {selected && <Button type="button" disabled={pending} onClick={() => void addSession()}>{pending ? "กำลังเพิ่ม…" : "ยืนยันเพิ่มนัดนี้"}</Button>}
        </>
      )}
      {message && <p className="field-error" role="alert">{message} <button type="button" onClick={() => void loadTrainer()}>ลองใหม่</button></p>}
    </section>
  );
}
