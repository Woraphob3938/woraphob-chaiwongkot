"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  addDays, calendarDateFormatter, calendarMonthFormatter, calendarWeekdays, hourLabel, localDateKey, monthDays,
  monthKey, overlapsHour, slotHours, slotStateCopy,
} from "@/components/trainer-schedule";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, authenticatedRequest } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { leaveExpiredSession } from "@/lib/session";
import type { TrainerAvailabilitySlot } from "@/lib/types";

/**
 * Adds one-hour availability slots: pick a day, then one or more start hours.
 * The parent gives it a new `key` each time it opens, so every opening starts
 * from the day and hour it was opened with.
 */
export function AddSlotDialog({ open, day, hour, slots, now, maxDate, reload, onClose, onNotice, onCloseAutoFocus }: {
  open: boolean;
  day?: Date;
  hour?: number;
  slots: TrainerAvailabilitySlot[];
  now: Date;
  maxDate: Date;
  reload: () => Promise<void>;
  onClose: () => void;
  onNotice: (text: string) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const navigate = useRouter().push;
  const [slotDate, setSlotDate] = useState(day ? localDateKey(day) : "");
  const [slotTimes, setSlotTimes] = useState<string[]>(day && hour !== undefined ? [hourLabel(hour)] : []);
  const [copyNextDay, setCopyNextDay] = useState(false);
  const [visibleSlotMonth, setVisibleSlotMonth] = useState(() => monthKey(day ?? now));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const slotMonths = useMemo(() => {
    const months: string[] = [];
    const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(maxDate.getFullYear(), maxDate.getMonth(), 1);
    while (cursor <= last) {
      months.push(monthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [maxDate, now]);
  const selectedStarts = slotDate
    ? slotTimes
      .map((time) => new Date(`${slotDate}T${time}`))
      .filter((start) => start > now && start <= maxDate)
    : [];
  const selectedSlotIsValid = selectedStarts.length > 0;
  const slotsOnSelectedDay = slotDate
    ? slots.filter((slot) => localDateKey(new Date(slot.startsAt)) === slotDate)
    : [];

  async function createSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaveError("");
    onNotice("");
    setFieldErrors({});
    setSaving(true);
    try {
      if (!slotDate || selectedStarts.length === 0) {
        setFieldErrors({ startsAt: "เลือกวันและเวลาในอนาคตภายในสองเดือน" });
        return;
      }
      const starts = [...selectedStarts];
      if (copyNextDay) {
        for (const start of selectedStarts) {
          const copied = addDays(start, 1);
          if (copied > now && copied <= maxDate) starts.push(copied);
        }
      }
      for (const start of starts) {
        await authenticatedRequest<TrainerAvailabilitySlot>("/v1/availability-slots", {
          method: "POST",
          body: JSON.stringify({ startsAt: start.toISOString() }),
        });
      }
      await reload();
      onClose();
      onNotice(starts.length === 1 ? "เพิ่มช่วงเวลาว่างแล้ว" : `เพิ่ม ${starts.length} ช่วงเวลาว่างแล้ว`);
    } catch (error) {
      if (leaveExpiredSession(error, navigate)) return;
      if (error instanceof ApiError) setFieldErrors(error.fields ?? {});
      setSaveError(error instanceof Error ? error.message : "เพิ่มช่วงเวลาไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent
        className="slot-calendar-dialog availability-calendar-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="slot-calendar-dialog__header">
          <DialogTitle>เพิ่มช่วงเวลาว่าง</DialogTitle>
          <DialogDescription>เลือกวันและเวลาเริ่มต้น ระบบจะกำหนดเวลาสิ้นสุดให้อัตโนมัติอีก 1 ชั่วโมง</DialogDescription>
        </DialogHeader>
        <form className="availability-calendar-form" onSubmit={createSlot}>
          <div className="slot-calendar-dialog__body">
            <section className="slot-calendar" aria-label="ปฏิทินวันเริ่มต้น">
              <div className="slot-calendar__toolbar">
                <Button type="button" size="icon" variant="outline" aria-label="เดือนก่อนหน้า" disabled={slotMonths.indexOf(visibleSlotMonth) <= 0} onClick={() => setVisibleSlotMonth(slotMonths[slotMonths.indexOf(visibleSlotMonth) - 1])}>
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <h3>{calendarMonthFormatter.format(new Date(`${visibleSlotMonth}-15T12:00:00`))}</h3>
                <Button type="button" size="icon" variant="outline" aria-label="เดือนถัดไป" disabled={slotMonths.indexOf(visibleSlotMonth) >= slotMonths.length - 1} onClick={() => setVisibleSlotMonth(slotMonths[slotMonths.indexOf(visibleSlotMonth) + 1])}>
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
              <div className="slot-calendar__weekdays" aria-hidden="true">{calendarWeekdays.map((day) => <span key={day}>{day}</span>)}</div>
              <div className="slot-calendar__days">
                {monthDays(visibleSlotMonth).map((date, index) => {
                  if (!date) return <span key={`blank-${index}`} aria-hidden="true" />;
                  const key = localDateKey(date);
                  const enabled = date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
                    && date <= new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
                  const selected = key === slotDate;
                  return (
                    <button key={key} type="button" className={`slot-calendar__day${selected ? " is-selected" : ""}`} disabled={!enabled} aria-pressed={selected} aria-label={`เลือกวันที่ ${calendarDateFormatter.format(date)}`} onClick={() => {
                      setSlotDate(key);
                      setFieldErrors({});
                    }}>
                      <span>{date.getDate()}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="slot-calendar-times availability-calendar-time" aria-label="เวลาเริ่มต้นที่เลือก">
              <div><CalendarDays aria-hidden="true" /><h3>เวลาเริ่มต้น</h3></div>
              {slotDate ? (
                <ul className="slot-calendar-times__list">
                  {slotHours.map((hour) => {
                    const value = hourLabel(hour);
                    const start = new Date(`${slotDate}T${value}`);
                    const taken = slotsOnSelectedDay.some((slot) => overlapsHour(slot, start));
                    const enabled = start > now && start <= maxDate && !taken;
                    const selected = slotTimes.includes(value);
                    return (
                      <li key={value}>
                        <button
                          type="button"
                          className={`slot-calendar-time${selected ? " is-selected" : ""}`}
                          disabled={!enabled || saving}
                          aria-pressed={selected}
                          aria-label={taken ? `${value} มีช่วงนี้อยู่แล้ว` : `เริ่ม ${value} น.`}
                          onClick={() => {
                            setSlotTimes((current) => (
                              current.includes(value)
                                ? current.filter((time) => time !== value)
                                : [...current, value].sort()
                            ));
                            setFieldErrors({});
                          }}
                        >
                          {value}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : <p>เลือกวันเพื่อดูชั่วโมงที่เปิดได้</p>}
              {slotsOnSelectedDay.length > 0 && (
                <p className="availability-day-slots">วันนี้มีอยู่แล้ว {slotsOnSelectedDay.map((slot) => `${formatTime(slot.startsAt)} น. · ${slotStateCopy[slot.state]}`).join(" · ")}</p>
              )}
              {selectedStarts.length > 0
                ? <p className="availability-calendar-time__end">จะเพิ่ม {selectedStarts.length} ช่วง · แต่ละช่วงสิ้นสุดใน 1 ชั่วโมง</p>
                : <p>เลือกวันและชั่วโมงได้มากกว่าหนึ่งช่อง</p>}
              <label className="availability-copy-next">
                <input type="checkbox" checked={copyNextDay} disabled={selectedStarts.length === 0 || saving} onChange={(event) => setCopyNextDay(event.target.checked)} />
                คัดลอกชั่วโมงเหล่านี้ไปวันถัดไป
              </label>
              {fieldErrors.startsAt && <small id="availability-start-error" className="field-error">{fieldErrors.startsAt}</small>}
              {saveError && <p className="row-error" role="alert">{saveError}</p>}
            </section>
          </div>
          <DialogFooter className="slot-calendar-dialog__footer">
            <DialogClose asChild><Button type="button" variant="outline" disabled={saving}>ยกเลิก</Button></DialogClose>
            <Button className="button button--accent" type="submit" disabled={!selectedSlotIsValid || saving}>
              {saving ? "กำลังเพิ่ม…" : selectedStarts.length > 1 ? `ยืนยันเพิ่ม ${selectedStarts.length} ช่วงเวลา` : "ยืนยันเพิ่มช่วงเวลา"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
