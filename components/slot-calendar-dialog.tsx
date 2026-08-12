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
import { formatTime } from "@/lib/format";
import type { AvailabilitySlot } from "@/lib/types";

type BaseProps = {
  trainerName: string;
  slots: AvailabilitySlot[];
  children: ReactElement;
};

type Props = BaseProps & ({
  selectedSlot: AvailabilitySlot | null;
  onConfirm: (slot: AvailabilitySlot) => void;
} | {
  selectedSlots: AvailabilitySlot[];
  selectionLimit: number;
  onConfirm: (slots: AvailabilitySlot[]) => void;
});

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
  const multiple = "selectedSlots" in props;
  const confirmedSlots = multiple ? props.selectedSlots : [];
  const selectedSlot = multiple ? null : props.selectedSlot;
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
  const [draftSlots, setDraftSlots] = useState<AvailabilitySlot[]>(confirmedSlots);
  const [selectionMessage, setSelectionMessage] = useState("");
  const selectedDayRef = useRef<HTMLButtonElement>(null);
  const monthIndex = months.indexOf(visibleMonth);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      const nextSeed = selectedSlot ?? availableSlots[0] ?? null;
      setDraftSlot(selectedSlot);
      setDraftSlots(confirmedSlots);
      setSelectionMessage("");
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
    if (!multiple) setDraftSlot(null);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent
        className="slot-calendar-dialog"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectedDayRef.current?.focus();
        }}
      >
        <DialogHeader className="slot-calendar-dialog__header">
          <DialogTitle>{multiple ? "เลือกวันและเวลาฝึกในแพ็กเกจ" : "เลือกวันและเวลาฝึก"}</DialogTitle>
          <DialogDescription>
            {multiple
              ? `เลือกให้ครบ ${props.selectionLimit} ครั้งภายใน 30 วันกับ ${trainerName} · เวลาประเทศไทย`
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
                  const selected = multiple
                    ? draftSlots.some((item) => item.id === slot.id)
                    : draftSlot?.id === slot.id;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      className={`slot-calendar-time${selected ? " is-selected" : ""}`}
                      aria-pressed={selected}
                      aria-label={`${formatTime(slot.startsAt)} ถึง ${formatTime(slot.endsAt)}`}
                      onClick={() => {
                        if (!multiple) {
                          setDraftSlot(slot);
                          return;
                        }
                        setDraftSlots((current) => {
                          if (selected) {
                            setSelectionMessage("");
                            return current.filter((item) => item.id !== slot.id);
                          }
                          if (current.length >= props.selectionLimit) return current;

                          const next = [...current, slot].sort((left, right) => left.startsAt.localeCompare(right.startsAt));
                          const firstStart = new Date(next[0].startsAt).getTime();
                          const lastEnd = Math.max(...next.map((item) => new Date(item.endsAt).getTime()));
                          if (lastEnd > firstStart + 30 * 24 * 60 * 60 * 1000) {
                            setSelectionMessage("เลือกช่วงเวลาภายใน 30 วันนับจากครั้งแรก");
                            return current;
                          }

                          setSelectionMessage("");
                          return next;
                        });
                      }}
                    >
                      {formatTime(slot.startsAt)} ถึง {formatTime(slot.endsAt)} น.
                    </button>
                  );
                })()
              ))}
            </div>
            {multiple && (
              <>
                <p className="slot-calendar-times__count" aria-live="polite">
                  เลือกแล้ว {draftSlots.length} จาก {props.selectionLimit} ครั้ง
                </p>
                {selectionMessage && <p className="field-error" role="alert">{selectionMessage}</p>}
              </>
            )}
          </section>
        </div>

        <DialogFooter className="slot-calendar-dialog__footer">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            ยกเลิก
          </Button>
          <Button
            type="button"
            className="button--accent"
            disabled={multiple ? draftSlots.length !== props.selectionLimit : !draftSlot}
            onClick={() => {
              if (multiple) {
                if (draftSlots.length !== props.selectionLimit) return;
                props.onConfirm(draftSlots);
              } else {
                if (!draftSlot) return;
                props.onConfirm(draftSlot);
              }
              setOpen(false);
            }}
          >
            {multiple ? `ยืนยัน ${props.selectionLimit} ช่วงเวลา` : "ยืนยันเวลานี้"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
