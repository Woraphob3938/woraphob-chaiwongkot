"use client";

import { useMemo, useRef, useState, type ReactElement } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { crossesBangkokDay, formatDay, formatTime } from "@/lib/format";
import type { AvailabilitySlot } from "@/lib/types";

type BaseProps = {
  trainerName: string;
  slots: AvailabilitySlot[];
  children: ReactElement;
};

type Props = BaseProps & {
  selectedSlot: AvailabilitySlot | null;
  onConfirm: (slot: AvailabilitySlot) => void;
  monthlyFirstSession?: boolean;
};

type CalendarDate = {
  key: string;
  year: number;
  month: number;
  day: number;
};

const dateParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const monthName = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  month: "long",
  year: "numeric",
});

const weekdays = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];

function calendarDate(value: string): CalendarDate {
  const parts = Object.fromEntries(
    dateParts.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    key: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function monthKey(date: CalendarDate) {
  return `${date.year}-${String(date.month).padStart(2, "0")}`;
}

function formatMonth(key: string) {
  if (!key) return "";
  return monthName.format(new Date(`${key}-15T00:00:00+07:00`));
}

function monthDays(key: string) {
  if (!key) return [];
  const [year, month] = key.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= count ? { year, month, day } : null;
  });
}

export function SlotCalendarDialog(props: Props) {
  const { trainerName, slots, children } = props;
  const selectedSlot = props.selectedSlot;
  const availableSlots = useMemo(
    () => slots
      .filter((slot) => slot.available)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [slots],
  );
  const slotsByDay = useMemo(() => {
    const grouped = new Map<string, AvailabilitySlot[]>();
    for (const slot of availableSlots) {
      const key = calendarDate(slot.startsAt).key;
      grouped.set(key, [...(grouped.get(key) ?? []), slot]);
    }
    return grouped;
  }, [availableSlots]);
  const months = useMemo(
    () => [...new Set(
      availableSlots.map((slot) => monthKey(calendarDate(slot.startsAt))),
    )],
    [availableSlots],
  );

  const seed = selectedSlot ?? availableSlots[0] ?? null;
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    seed ? monthKey(calendarDate(seed.startsAt)) : "",
  );
  const [selectedDay, setSelectedDay] = useState(
    seed ? calendarDate(seed.startsAt).key : "",
  );
  const [draftSlot, setDraftSlot] = useState<AvailabilitySlot | null>(selectedSlot);
  const selectedDayRef = useRef<HTMLButtonElement>(null);
  const monthIndex = months.indexOf(visibleMonth);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const nextSeed = selectedSlot ?? availableSlots[0] ?? null;
      setDraftSlot(selectedSlot);
      setSelectedDay(nextSeed ? calendarDate(nextSeed.startsAt).key : "");
      setVisibleMonth(
        nextSeed ? monthKey(calendarDate(nextSeed.startsAt)) : (months[0] ?? ""),
      );
    }
    setOpen(nextOpen);
  }

  function showMonth(nextMonth: string) {
    const firstSlot = availableSlots.find(
      (slot) => monthKey(calendarDate(slot.startsAt)) === nextMonth,
    ) ?? null;
    setVisibleMonth(nextMonth);
    setSelectedDay(firstSlot ? calendarDate(firstSlot.startsAt).key : "");
    setDraftSlot(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="slot-calendar-dialog"
        aria-modal="true"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectedDayRef.current?.focus();
        }}
      >
        <DialogHeader className="slot-calendar-dialog__header">
          <DialogTitle>{props.monthlyFirstSession ? "เลือกวันและเวลานัดแรก" : "เลือกวันและเวลาฝึก"}</DialogTitle>
          <DialogDescription>
            {props.monthlyFirstSession
              ? `เลือกนัดแรกกับ ${trainerName} ก่อน นัดที่เหลือจัดเวลาได้หลังชำระเงินผ่าน · เวลาประเทศไทย`
              : `เลือกวันที่ก่อน แล้วเลือกช่วงเวลาที่สะดวกกับ ${trainerName} · เวลาประเทศไทย`}
          </DialogDescription>
        </DialogHeader>

        <div className="slot-calendar-dialog__body">
          <section className="slot-calendar" aria-label="ปฏิทินวันว่าง">
            <div className="slot-calendar__toolbar">
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="เดือนก่อนหน้า"
                disabled={monthIndex <= 0}
                onClick={() => showMonth(months[monthIndex - 1])}
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
              <h3>{formatMonth(visibleMonth)}</h3>
              <Button
                type="button"
                size="icon"
                variant="outline"
                aria-label="เดือนถัดไป"
                disabled={monthIndex === months.length - 1}
                onClick={() => showMonth(months[monthIndex + 1])}
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            </div>

            <div className="slot-calendar__weekdays" aria-hidden="true">
              {weekdays.map((day) => <span key={day}>{day}</span>)}
            </div>

            <div className="slot-calendar__days">
              {monthDays(visibleMonth).map((date, index) => {
                if (!date) return <span key={`blank-${index}`} aria-hidden="true" />;
                const key = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
                const daySlots = slotsByDay.get(key) ?? [];
                const active = key === selectedDay;
                return (
                  <button
                    key={key}
                    ref={active ? selectedDayRef : undefined}
                    type="button"
                    className={`slot-calendar__day${active ? " is-selected" : ""}`}
                    disabled={daySlots.length === 0}
                    aria-pressed={active}
                    aria-label={`วันที่ ${date.day} ${formatMonth(monthKey({ ...date, key }))} ${daySlots.length} ช่วงว่าง`}
                    onClick={() => {
                      setSelectedDay(key);
                      setDraftSlot(null);
                    }}
                  >
                    <span>{date.day}</span>
                    {daySlots.length > 0 && <small>{daySlots.length} ช่วง</small>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="slot-calendar-times" aria-label="เวลาว่างของวันที่เลือก">
            <div>
              <CalendarDays aria-hidden="true" />
              <h3>เวลาว่าง</h3>
            </div>
            <div className="slot-calendar-times__list">
              {(slotsByDay.get(selectedDay) ?? []).map((slot) => (
                (() => {
                  const selected = draftSlot?.id === slot.id;
                  const crossesDay = crossesBangkokDay(slot.startsAt, slot.endsAt);
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      className={`slot-calendar-time${selected ? " is-selected" : ""}`}
                      aria-pressed={selected}
                      aria-label={`${formatTime(slot.startsAt)} ถึง ${formatTime(slot.endsAt)}${crossesDay ? ` สิ้นสุดวันถัดไป ${formatDay(slot.endsAt)}` : ""}`}
                      onClick={() => {
                        setDraftSlot(slot);
                      }}
                    >
                      {formatTime(slot.startsAt)} ถึง {formatTime(slot.endsAt)} น.
                      {crossesDay && <small>สิ้นสุดวันถัดไป · {formatDay(slot.endsAt)}</small>}
                    </button>
                  );
                })()
              ))}
            </div>
          </section>
        </div>

        <DialogFooter className="slot-calendar-dialog__footer">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            className="button--accent"
            disabled={!draftSlot}
            onClick={() => {
              if (!draftSlot) return;
              props.onConfirm(draftSlot);
              setOpen(false);
            }}
          >
            {props.monthlyFirstSession ? "ยืนยันเวลานัดแรก" : "ยืนยันเวลานี้"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
