# Trainer Profile Calendar Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลดสัดส่วนรูปและชื่อบนหน้าโปรไฟล์เทรนเนอร์ พร้อมเปลี่ยนตารางว่างเป็น Dialog ปฏิทินที่ยืนยันเฉพาะวันและเวลาก่อนเข้าสู่หน้าสร้างการจองเดิม

**Architecture:** เพิ่ม `SlotCalendarDialog` เป็นคอมโพเนนต์เฉพาะสำหรับจัดกลุ่ม `AvailabilitySlot` ตามวันในเขตเวลา Asia/Bangkok และเก็บ slot ที่เลือกเป็น draft จนกด “ยืนยันเวลานี้” จากนั้น `ProfileBookingPanel` รับค่าที่เลือกและคงลิงก์ `/booking?trainer=<slug>&slot=<id>` เดิมไว้ CSS ปรับเฉพาะสัดส่วน profile commerce และ responsive Dialog โดยใช้ token เดิมทั้งหมด

**Tech Stack:** Next.js 16.3.0 App Router, React 19.2.8, TypeScript 6, Radix/shadcn Dialog และ Button ที่ติดตั้งแล้ว, Vitest 4, Testing Library, CSS tokens ใน `tokens.css`

## Global Constraints

- ไม่เพิ่ม dependency, API endpoint, PHP, migration, table หรือสถานะธุรกิจใหม่
- เวลา 10 นาทีเริ่มหลังสมาชิกยืนยันสร้างการจองในหน้า `/booking` สำเร็จเท่านั้น
- Dialog ยืนยันเฉพาะวันและเวลา การปิดโดยไม่ยืนยันต้องไม่เปลี่ยนค่าที่เลือกเดิม
- ใช้ข้อมูลจาก `trainer.slots` และลิงก์ `/booking?trainer=<slug>&slot=<id>` เดิม
- คงราคา สถานะตรวจ ใบรับรอง รีวิว และ stale-slot protection เดิมครบ
- ไม่เพิ่มจังหวัด พื้นที่ให้บริการ หรือสถานที่นัดฝึก
- ใช้สี ฟอนต์ ระยะ radius และ z-index ผ่าน token เดิม ห้ามใส่ค่าสีใหม่ในคอมโพเนนต์
- ปุ่มสูงอย่างน้อย 44px ข้อความปุ่มไม่ขึ้นสองบรรทัด และไม่มี horizontal overflow ที่ 1280, 768, 414, 375 และ 320px รวมถึง 200% zoom
- Dialog ต้องรองรับ Escape, backdrop, ปุ่มปิด, ปุ่มยกเลิก, focus trap, focus return และ reduced motion
- รักษา `"use client"` ที่ขอบคอมโพเนนต์ interactive ตามคู่มือ Next.js 16.3 ที่อยู่ใน `node_modules/next/dist/docs/`
- ไม่แตะหรือ stage `.superpowers/` และ `graphify-out/` ซึ่งเป็นไฟล์ของผู้ใช้

---

### Task 1: Slot calendar Dialog

**Files:**
- Create: `components/slot-calendar-dialog.tsx`
- Create: `components/slot-calendar-dialog.test.tsx`

**Interfaces:**
- Consumes: `AvailabilitySlot` จาก `lib/types.ts`, `formatTime()` จาก `lib/format.ts`, และ shadcn Dialog/Button เดิม
- Produces: `SlotCalendarDialog({ trainerName, slots, selectedSlot, onConfirm, children })`
- `onConfirm(slot: AvailabilitySlot): void` ทำงานเมื่อกด “ยืนยันเวลานี้” เท่านั้น

- [ ] **Step 1: Write failing behavior tests**

สร้าง `components/slot-calendar-dialog.test.tsx` โดยใช้ slot คงที่ในเขตเวลาไทย:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SlotCalendarDialog } from "@/components/slot-calendar-dialog";
import { Button } from "@/components/ui/button";
import type { AvailabilitySlot } from "@/lib/types";

const slots: AvailabilitySlot[] = [
  { id: 1, startsAt: "2026-08-03T02:00:00.000Z", endsAt: "2026-08-03T03:00:00.000Z", available: true },
  { id: 2, startsAt: "2026-08-03T10:00:00.000Z", endsAt: "2026-08-03T11:00:00.000Z", available: true },
  { id: 3, startsAt: "2026-08-04T11:00:00.000Z", endsAt: "2026-08-04T12:00:00.000Z", available: true },
];

function renderDialog(onConfirm = vi.fn(), selectedSlot: AvailabilitySlot | null = null) {
  render(
    <SlotCalendarDialog
      trainerName="เทรนเนอร์ทดสอบ"
      slots={slots}
      selectedSlot={selectedSlot}
      onConfirm={onConfirm}
    >
      <Button type="button">ดูตารางว่างทั้งหมด</Button>
    </SlotCalendarDialog>,
  );
  return onConfirm;
}

describe("SlotCalendarDialog", () => {
  it("selects a Bangkok date and confirms exactly one available time", async () => {
    const onConfirm = renderDialog();
    const trigger = screen.getByRole("button", { name: "ดูตารางว่างทั้งหมด" });
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "เลือกวันและเวลาฝึก" });
    fireEvent.click(within(dialog).getByRole("button", { name: /วันที่ 3 สิงหาคม 2569.*2 ช่วงว่าง/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: /17:00 ถึง 18:00/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันเวลานี้" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(slots[1]);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("preserves the prior slot when the dialog closes without confirmation", async () => {
    const onConfirm = renderDialog(vi.fn(), slots[0]);
    const trigger = screen.getByRole("button", { name: "ดูตารางว่างทั้งหมด" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: /17:00 ถึง 18:00/ }));
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });
});
```

- [ ] **Step 2: Run the focused test and record RED**

Run:

```powershell
rtk npm test -- components/slot-calendar-dialog.test.tsx
```

Expected: FAIL เพราะ `@/components/slot-calendar-dialog` ยังไม่มี

- [ ] **Step 3: Implement the minimum calendar model and Dialog**

สร้าง `components/slot-calendar-dialog.tsx` ด้วย API นี้:

```tsx
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

type Props = {
  trainerName: string;
  slots: AvailabilitySlot[];
  selectedSlot: AvailabilitySlot | null;
  onConfirm: (slot: AvailabilitySlot) => void;
  children: ReactElement;
};

type CalendarDate = { key: string; year: number; month: number; day: number };

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

function monthDays(key: string) {
  const [year, month] = key.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= count ? { year, month, day } : null;
  });
}
```

ภายในคอมโพเนนต์:

```tsx
const availableSlots = useMemo(
  () => slots.filter((slot) => slot.available).sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
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
  () => [...new Set(availableSlots.map((slot) => monthKey(calendarDate(slot.startsAt))))],
  [availableSlots],
);

const seed = selectedSlot ?? availableSlots[0] ?? null;
const [open, setOpen] = useState(false);
const [visibleMonth, setVisibleMonth] = useState(seed ? monthKey(calendarDate(seed.startsAt)) : "");
const [selectedDay, setSelectedDay] = useState(seed ? calendarDate(seed.startsAt).key : "");
const [draftSlot, setDraftSlot] = useState<AvailabilitySlot | null>(selectedSlot);
const selectedDayRef = useRef<HTMLButtonElement>(null);

function handleOpenChange(nextOpen: boolean) {
  if (nextOpen) {
    const nextSeed = selectedSlot ?? availableSlots[0] ?? null;
    setDraftSlot(selectedSlot);
    setSelectedDay(nextSeed ? calendarDate(nextSeed.startsAt).key : "");
    setVisibleMonth(nextSeed ? monthKey(calendarDate(nextSeed.startsAt)) : months[0] ?? "");
  }
  setOpen(nextOpen);
}
```

Render contract:

```tsx
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
      <DialogTitle>เลือกวันและเวลาฝึก</DialogTitle>
      <DialogDescription>
        เลือกวันที่ก่อน แล้วเลือกช่วงเวลาที่สะดวกกับ {trainerName} · เวลาประเทศไทย
      </DialogDescription>
    </DialogHeader>

    <div className="slot-calendar-dialog__body">
      <section className="slot-calendar" aria-label="ปฏิทินวันว่าง">
        <div className="slot-calendar__toolbar">
          <Button type="button" size="icon" variant="outline" aria-label="เดือนก่อนหน้า" disabled={months.indexOf(visibleMonth) <= 0} onClick={() => setVisibleMonth(months[months.indexOf(visibleMonth) - 1])}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <h3>{monthName.format(new Date(`${visibleMonth}-15T00:00:00+07:00`))}</h3>
          <Button type="button" size="icon" variant="outline" aria-label="เดือนถัดไป" disabled={months.indexOf(visibleMonth) === months.length - 1} onClick={() => setVisibleMonth(months[months.indexOf(visibleMonth) + 1])}>
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
                aria-label={`วันที่ ${date.day} ${monthName.format(new Date(`${date.year}-${String(date.month).padStart(2, "0")}-15T00:00:00+07:00`))} ${daySlots.length} ช่วงว่าง`}
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
            <button
              key={slot.id}
              type="button"
              className={`slot-calendar-time${draftSlot?.id === slot.id ? " is-selected" : ""}`}
              aria-pressed={draftSlot?.id === slot.id}
              aria-label={`${formatTime(slot.startsAt)} ถึง ${formatTime(slot.endsAt)}`}
              onClick={() => setDraftSlot(slot)}
            >
              {formatTime(slot.startsAt)} ถึง {formatTime(slot.endsAt)} น.
            </button>
          ))}
        </div>
      </section>
    </div>

    <DialogFooter className="slot-calendar-dialog__footer">
      <Button type="button" variant="outline" onClick={() => setOpen(false)}>ยกเลิก</Button>
      <Button type="button" className="button--accent" disabled={!draftSlot} onClick={() => {
        if (!draftSlot) return;
        onConfirm(draftSlot);
        setOpen(false);
      }}>ยืนยันเวลานี้</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

หาก `months.length === 0` ตัว trigger จาก Task 2 จะ disabled จึงไม่เปิด Dialog

- [ ] **Step 4: Run the focused test and reach GREEN**

Run:

```powershell
rtk npm test -- components/slot-calendar-dialog.test.tsx
```

Expected: PASS 2 tests และไม่มี warning เรื่อง accessible Dialog title/description

- [ ] **Step 5: Commit Task 1**

```powershell
rtk git add -- components/slot-calendar-dialog.tsx components/slot-calendar-dialog.test.tsx
rtk git commit -m "feat: add trainer slot calendar dialog"
```

---

### Task 2: Integrate the calendar with profile booking

**Files:**
- Modify: `components/profile-booking-panel.tsx`
- Modify: `components/profile-booking-panel.test.tsx`
- Modify: `components/trainer-detail.test.tsx`

**Interfaces:**
- Consumes: `SlotCalendarDialog` จาก Task 1
- Produces: แผงจองที่เปิด Dialog เพียงจุดเดียว แสดงสรุป slot ที่ยืนยัน และคง URL หน้าจองเดิม

- [ ] **Step 1: Replace stale disclosure expectations with failing Dialog integration tests**

แก้ `components/profile-booking-panel.test.tsx` ให้มี stateful harness:

```tsx
function BookingPanelHarness({ trainer = { ...trainers[0], demo: false } }) {
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  return (
    <ProfileBookingPanel
      trainer={trainer}
      selectedSlot={selectedSlot}
      onSelectSlot={setSelectedSlot}
    />
  );
}

it("chooses a slot in the calendar, closes it, and exposes the existing booking URL", async () => {
  const trainer = { ...trainers[0], demo: false };
  render(<BookingPanelHarness trainer={trainer} />);

  expect(screen.queryByText("ตารางว่างทั้งหมด")?.closest("details")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /ดูตารางว่างทั้งหมด/ }));
  const dialog = screen.getByRole("dialog", { name: "เลือกวันและเวลาฝึก" });
  fireEvent.click(within(dialog).getByRole("button", { name: /09:00 ถึง 10:00/ }));
  fireEvent.click(within(dialog).getByRole("button", { name: "ยืนยันเวลานี้" }));

  expect(await screen.findByText(/09:00/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "เปลี่ยนเวลา" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "จองเวลานี้" })).toHaveAttribute(
    "href",
    `/booking?trainer=${trainer.slug}&slot=${trainer.slots[0].id}`,
  );
});

it("explains when no available slot can be selected", () => {
  const trainer = { ...trainers[0], slots: trainers[0].slots.map((slot) => ({ ...slot, available: false })) };
  render(<BookingPanelHarness trainer={trainer} />);
  expect(screen.getByRole("button", { name: /ยังไม่มีเวลาว่างให้จอง/ })).toBeDisabled();
  expect(screen.getByRole("button", { name: "เลือกเวลาก่อน" })).toBeDisabled();
});
```

แก้ `components/trainer-detail.test.tsx` ให้คาดว่า schedule ไม่ใช่ `<details>` และเปิด Dialog ได้จากปุ่ม

- [ ] **Step 2: Run focused integration tests and record RED**

Run:

```powershell
rtk npm test -- components/profile-booking-panel.test.tsx components/trainer-detail.test.tsx
```

Expected: FAIL เพราะแผงปัจจุบันยังใช้ `DisclosureSection` และ `AvailabilityPanel`

- [ ] **Step 3: Replace the schedule disclosure with one Dialog trigger**

ใน `components/profile-booking-panel.tsx`:

```tsx
import { CalendarDays, Clock3, ShieldCheck } from "lucide-react";
import { SlotCalendarDialog } from "@/components/slot-calendar-dialog";
```

ลบ import `AvailabilityPanel` และ `DisclosureSection` แล้วแทน schedule เดิมด้วย:

```tsx
{selectedSlot ? (
  <div className="profile-booking-selection" aria-live="polite">
    <Clock3 aria-hidden="true" size={18} />
    <span>
      <strong>เลือกเวลาแล้ว</strong>
      {formatDay(selectedSlot.startsAt)} · {formatTime(selectedSlot.startsAt)} ถึง {formatTime(selectedSlot.endsAt)} น.
    </span>
    <SlotCalendarDialog
      trainerName={trainer.displayName}
      slots={availableSlots}
      selectedSlot={selectedSlot}
      onConfirm={onSelectSlot}
    >
      <Button type="button" variant="outline">เปลี่ยนเวลา</Button>
    </SlotCalendarDialog>
  </div>
) : (
  <SlotCalendarDialog
    trainerName={trainer.displayName}
    slots={availableSlots}
    selectedSlot={null}
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
        <strong>{availableSlots.length > 0 ? "ดูตารางว่างทั้งหมด" : "ยังไม่มีเวลาว่างให้จอง"}</strong>
        <small>{availableSlots.length} ช่วงพร้อมจอง</small>
      </span>
    </Button>
  </SlotCalendarDialog>
)}
```

เปลี่ยนข้อความ policy เป็น:

```tsx
<p>เวลา 10 นาทีเริ่มหลังยืนยันการจองในขั้นตอนถัดไป</p>
```

คงเงื่อนไข `canBook`, ราคา, verification และลิงก์ `/booking?trainer=${trainer.slug}&slot=${selectedSlot.id}` เดิมทุกประการ

- [ ] **Step 4: Run Task 1 and Task 2 tests together**

Run:

```powershell
rtk npm test -- components/slot-calendar-dialog.test.tsx components/profile-booking-panel.test.tsx components/trainer-detail.test.tsx
```

Expected: PASS และไม่มี slot list ซ้ำใน DOM นอก Dialog

- [ ] **Step 5: Commit Task 2**

```powershell
rtk git add -- components/profile-booking-panel.tsx components/profile-booking-panel.test.tsx components/trainer-detail.test.tsx
rtk git commit -m "feat: select trainer time from calendar"
```

---

### Task 3: Reduce profile scale and style the responsive Dialog

**Files:**
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: class namesจาก Task 1 และ Task 2
- Produces: profile proportions 26/44/30, 28rem desktop portrait, 3.5rem heading cap, centered responsive Dialog

- [ ] **Step 1: Record the visual baseline before editing CSS**

เปิดหน้าโปรไฟล์ปัจจุบันที่ 1280 และ 320px บันทึก computed width, portrait height, h1 font-size และ page scrollWidth เพื่อใช้เทียบหลังแก้ ไม่เพิ่ม source-text test เพราะการค้นหาตัวเลขใน CSS ไม่พิสูจน์ rendered behavior

- [ ] **Step 2: Apply the approved profile scale**

แก้บล็อก profile commerce ใน `app/globals.css`:

```css
.trainer-commerce-layout {
  grid-template-columns: minmax(0, 26fr) minmax(22rem, 44fr) minmax(20rem, 30fr);
}

.trainer-commerce-layout .trainer-detail-photo {
  min-height: 28rem;
}

.trainer-commerce-layout .trainer-detail-copy {
  min-height: 28rem;
}

.trainer-commerce-layout .trainer-detail-copy h1 {
  font-size: clamp(2.25rem, 3.4vw, 3.5rem);
}
```

ที่ `max-width: 64rem` ลด min-height จาก 30rem เป็น 25rem และที่ `max-width: 40rem` ลดรูปจาก 24rem เป็น 20rem

- [ ] **Step 3: Add Dialog, calendar, time, summary and responsive styles**

เพิ่มต่อจาก profile booking block โดยใช้ token เดิม:

```css
.profile-booking-calendar-trigger {
  width: 100%;
  min-height: 4.5rem;
  justify-content: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  white-space: nowrap;
}

.profile-booking-calendar-trigger > span {
  display: grid;
  min-width: 0;
  gap: var(--space-2xs);
  text-align: left;
}

.profile-booking-calendar-trigger small {
  color: var(--color-muted);
  font-weight: 400;
}

.profile-booking-selection {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
}

.slot-calendar-dialog {
  width: min(56rem, calc(100% - 2rem));
  max-width: 56rem;
  max-height: min(82dvh, 46rem);
  gap: 0;
  overflow-y: auto;
  padding: 0;
  background: var(--color-paper);
  border-radius: var(--radius-sm);
}

.slot-calendar-dialog__header {
  gap: var(--space-xs);
  padding: var(--space-lg);
  border-bottom: 1px solid var(--color-rule);
}

.slot-calendar-dialog__body {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(16rem, 0.75fr);
  min-height: 25rem;
}

.slot-calendar,
.slot-calendar-times {
  min-width: 0;
  padding: var(--space-lg);
}

.slot-calendar-times {
  background: var(--color-paper-2);
  border-left: 1px solid var(--color-rule);
}

.slot-calendar__toolbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-sm);
}

.slot-calendar__toolbar h3 {
  text-align: center;
}

.slot-calendar__weekdays,
.slot-calendar__days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: var(--space-2xs);
}

.slot-calendar__weekdays {
  margin-top: var(--space-md);
  color: var(--color-muted);
  font-size: var(--text-xs);
  text-align: center;
}

.slot-calendar__day,
.slot-calendar-time {
  min-height: var(--size-control);
  color: var(--color-ink);
  background: var(--color-paper);
  border: 1px solid var(--color-rule);
}

.slot-calendar__day {
  display: grid;
  place-items: center;
  gap: var(--space-3xs);
  padding: var(--space-2xs);
  font-family: var(--font-mono);
}

.slot-calendar__day small {
  color: var(--color-muted);
  font-family: var(--font-body);
  font-size: var(--text-xs);
}

.slot-calendar__day.is-selected,
.slot-calendar-time.is-selected {
  color: var(--color-accent-ink);
  background: var(--color-accent);
  border-color: var(--color-focus);
}

.slot-calendar__day:disabled {
  color: var(--color-neutral);
  background: var(--color-paper-2);
  cursor: not-allowed;
  opacity: 0.55;
}

.slot-calendar-times > div:first-child,
.slot-calendar-times__list {
  display: grid;
  gap: var(--space-sm);
}

.slot-calendar-times > div:first-child {
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  margin-bottom: var(--space-md);
}

.slot-calendar-time {
  padding-inline: var(--space-md);
  font-family: var(--font-mono);
  font-weight: 700;
  white-space: nowrap;
}

.slot-calendar-dialog__footer {
  margin: 0;
  padding: var(--space-md) var(--space-lg);
  border-radius: 0;
}

@media (max-width: 48rem) {
  .slot-calendar-dialog {
    max-height: calc(100dvh - 2rem);
  }

  .slot-calendar-dialog__body {
    grid-template-columns: minmax(0, 1fr);
  }

  .slot-calendar-times {
    border-top: 1px solid var(--color-rule);
    border-left: 0;
  }
}

@media (max-width: 40rem) {
  .profile-booking-selection {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .profile-booking-selection [data-slot="dialog-trigger"] {
    grid-column: 1 / -1;
    width: 100%;
  }

  .slot-calendar,
  .slot-calendar-times,
  .slot-calendar-dialog__header {
    padding: var(--space-md);
  }
}
```

ครอบ hover เฉพาะ `@media (hover: hover) and (pointer: fine)` และคง global `:focus-visible` เดิม ไม่ใช้ `transition-all`, animation ความสูง หรือสีดิบ

- [ ] **Step 4: Run focused UI tests, typecheck and lint**

Run:

```powershell
rtk npm test -- components/slot-calendar-dialog.test.tsx components/profile-booking-panel.test.tsx components/trainer-detail.test.tsx
rtk npm run typecheck
rtk npm run lint
```

Expected: PASS ทุกคำสั่ง

- [ ] **Step 5: Commit Task 3**

```powershell
rtk git add -- app/globals.css
rtk git commit -m "style: compact trainer profile booking"
```

---

### Task 4: Final verification and browser review

**Files:**
- Modify only if a verified defect is found: files from Tasks 1 to 3
- Do not modify: backend, database, scripts, unrelated routes, `.superpowers/`, `graphify-out/`

**Interfaces:**
- Consumes: completed profile and calendar UI
- Produces: test, static-analysis, build, detector and visual evidence at final HEAD

- [ ] **Step 1: Run the full automated gate once**

Run:

```powershell
rtk npm test
rtk npm run lint
rtk npm run typecheck
rtk npm run build
```

Expected: all tests PASS, lint/typecheck exit 0, Next.js 16.3 build completes all existing routes

- [ ] **Step 2: Run the Impeccable mechanical detector once at final UI**

Run:

```powershell
rtk node C:\Users\HP\.agents\skills\impeccable\scripts\detect.mjs --json components/slot-calendar-dialog.tsx components/profile-booking-panel.tsx components/trainer-detail.tsx app/globals.css
```

Expected: `[]` or only documented findings that are existing and outside this diff

- [ ] **Step 3: Inspect the live profile in one bounded browser matrix**

Start a fresh local server and open one real trainer profile. At 1280, 768, 414, 375 and 320px verify:

```text
Profile: portrait and h1 visibly smaller; evidence, price and booking panel remain readable
Dialog: centred; no clipping; calendar then times; buttons stay at least 44px
Selection: choose date, choose time, confirm, Dialog closes, summary and Change time appear
Booking: existing /booking?trainer=<slug>&slot=<id> URL remains correct
Keyboard: trigger, date, time, confirm, Escape and focus return
Zoom: 200% reaches all controls without page-level horizontal scrolling
Motion: prefers-reduced-motion removes spatial Dialog motion
```

Do not press the final create-booking action in browser review, so no database row is created

- [ ] **Step 4: Run final hygiene checks**

Run:

```powershell
rtk git diff --check
rtk git status --short
rtk git log -4 --oneline
```

Expected: no whitespace errors; only intended commits; `.superpowers/` and `graphify-out/` remain untracked and unstaged

- [ ] **Step 5: Commit only if browser review required a focused fix**

If and only if browser evidence found a defect, add one failing regression test, apply one focused fix, rerun the relevant focused test and one visual confirmation, then:

```powershell
rtk git add -- app/globals.css components/slot-calendar-dialog.tsx components/slot-calendar-dialog.test.tsx components/profile-booking-panel.tsx components/profile-booking-panel.test.tsx components/trainer-detail.test.tsx
rtk git commit -m "fix: keep trainer calendar usable"
```

Do not create an empty final commit when no fix was required

## Self-review

- Spec coverage: Tasks 1 to 3 cover popup selection, draft confirmation, selected summary, profile scale, empty state, responsive and accessibility. Task 4 covers all required viewports, zoom, keyboard, reduced motion and overflow
- Placeholder scan: ทุกขั้นมีชื่อไฟล์ คำสั่ง และ implementation ที่ระบุชัด ไม่มีช่องให้เติมภายหลัง
- Type consistency: `SlotCalendarDialog` consumes `AvailabilitySlot[]`, returns the confirmed `AvailabilitySlot` through `onConfirm`, and `ProfileBookingPanel` passes that same object to its existing `onSelectSlot`
- Scope: no backend, database, new workflow, new dependency, province or appointment-location work is included
