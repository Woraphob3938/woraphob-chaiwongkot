"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatTrainingTypeName } from "@/lib/format";
import type { Trainer, TrainingType } from "@/lib/types";

export type TrainerPriceBasis = "session" | "monthly";
export type TrainerPriceRange =
  | "all"
  | "under_700" | "701_1000" | "over_1000"
  | "m_under_5000" | "m_5001_10000" | "m_over_10000";
export type TrainerAvailabilityDay = "all" | "any" | "today" | "tomorrow" | "week" | "date";
export type TrainerTimeOfDay = "all" | "morning" | "afternoon" | "evening";
export type TrainerRatingFilter = "all" | "4_plus" | "4_5_plus";
export type TrainerExperienceFilter = "all" | "under_2" | "2_5" | "over_5";

/** บทที่ 1: members filter trainers by experience level. */
export const experienceFilterOptions: { value: TrainerExperienceFilter; label: string }[] = [
  { value: "all", label: "ทุกระดับประสบการณ์" },
  { value: "under_2", label: "น้อยกว่า 2 ปี" },
  { value: "2_5", label: "2–5 ปี" },
  { value: "over_5", label: "มากกว่า 5 ปี" },
];

export function matchExperience(trainer: Trainer, experience: TrainerExperienceFilter) {
  if (experience === "all") return true;
  const years = trainer.yearsExperience ?? 0;
  if (experience === "under_2") return years < 2;
  if (experience === "2_5") return years >= 2 && years <= 5;
  return years > 5;
}

/** Per day is the per-session price (one session a day); per month is the 30-day package. */
export const priceBasisOptions: { value: TrainerPriceBasis; label: string }[] = [
  { value: "session", label: "ต่อวัน" },
  { value: "monthly", label: "ต่อเดือน" },
];

export const priceRangeOptionsByBasis: Record<TrainerPriceBasis, { value: TrainerPriceRange; label: string }[]> = {
  session: [
    { value: "all", label: "ทุกช่วงราคา" },
    { value: "under_700", label: "ไม่เกิน ฿700 ต่อวัน" },
    { value: "701_1000", label: "฿701–฿1,000 ต่อวัน" },
    { value: "over_1000", label: "มากกว่า ฿1,000 ต่อวัน" },
  ],
  monthly: [
    { value: "all", label: "ทุกช่วงราคา" },
    { value: "m_under_5000", label: "ไม่เกิน ฿5,000 ต่อเดือน" },
    { value: "m_5001_10000", label: "฿5,001–฿10,000 ต่อเดือน" },
    { value: "m_over_10000", label: "มากกว่า ฿10,000 ต่อเดือน" },
  ],
};

/** Every range value, for validating a value read back from the URL. */
export const priceRangeOptions = [...priceRangeOptionsByBasis.session, ...priceRangeOptionsByBasis.monthly.slice(1)];

export const availabilityDayOptions: { value: TrainerAvailabilityDay; label: string }[] = [
  { value: "all", label: "ไม่กรองตามเวลาว่าง" },
  { value: "any", label: "มีเวลาว่างวันใดก็ได้" },
  { value: "today", label: "ว่างวันนี้" },
  { value: "tomorrow", label: "ว่างพรุ่งนี้" },
  { value: "week", label: "ว่างภายใน 7 วัน" },
  { value: "date", label: "เลือกวันที่เอง" },
];

export const timeOfDayOptions: { value: TrainerTimeOfDay; label: string; hint: string }[] = [
  { value: "all", label: "ทั้งวัน", hint: "" },
  { value: "morning", label: "เช้า", hint: "ก่อน 12:00" },
  { value: "afternoon", label: "บ่าย", hint: "12:00–17:00" },
  { value: "evening", label: "เย็น", hint: "หลัง 17:00" },
];

const bangkokParts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });

/** `YYYY-MM-DD` and the hour of an instant, read on the Bangkok clock. */
function bangkokDateAndHour(value: Date): { date: string; hour: number } {
  const parts = Object.fromEntries(bangkokParts.formatToParts(value).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDaysKey(key: string, days: number) {
  const date = new Date(`${key}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return bangkokDateAndHour(date).date;
}

function matchesTimeOfDay(hour: number, timeOfDay: TrainerTimeOfDay) {
  if (timeOfDay === "morning") return hour < 12;
  if (timeOfDay === "afternoon") return hour >= 12 && hour < 17;
  if (timeOfDay === "evening") return hour >= 17;
  return true;
}

export function matchAvailability(
  trainer: Trainer,
  day: TrainerAvailabilityDay,
  timeOfDay: TrainerTimeOfDay,
  pickedDate: string,
  now: Date = new Date(),
) {
  if (day === "all" && timeOfDay === "all") return true;
  const today = bangkokDateAndHour(now).date;
  const lastDay = addDaysKey(today, 6);
  return trainer.slots.some((slot) => {
    const start = new Date(slot.startsAt);
    // The API only lists future open slots, so every slot counts as free.
    if (Number.isNaN(start.getTime())) return false;
    const { date, hour } = bangkokDateAndHour(start);
    const dayMatches = day === "today" ? date === today
      : day === "tomorrow" ? date === addDaysKey(today, 1)
        : day === "week" ? date >= today && date <= lastDay
          : day === "date" ? !pickedDate || date === pickedDate
            : true;
    return dayMatches && matchesTimeOfDay(hour, timeOfDay);
  });
}

export const ratingFilterOptions: { value: TrainerRatingFilter; label: string }[] = [
  { value: "all", label: "ทุกคะแนน" },
  { value: "4_plus", label: "4.0 ดาวขึ้นไป" },
  { value: "4_5_plus", label: "4.5 ดาวขึ้นไป" },
];

export function matchPrice(trainer: Trainer, priceRange: TrainerPriceRange) {
  if (priceRange === "all") return true;
  if (priceRange.startsWith("m_")) {
    const monthly = trainer.monthlyPrice;
    if (monthly == null) return false;
    if (priceRange === "m_under_5000") return monthly <= 5_000;
    if (priceRange === "m_5001_10000") return monthly > 5_000 && monthly <= 10_000;
    return monthly > 10_000;
  }
  if (trainer.priceFrom == null) return false;
  if (priceRange === "under_700") return trainer.priceFrom <= 700;
  if (priceRange === "701_1000") return trainer.priceFrom > 700 && trainer.priceFrom <= 1_000;
  return trainer.priceFrom > 1_000;
}

export function matchRating(trainer: Trainer, ratingFilter: TrainerRatingFilter) {
  if (ratingFilter === "all") return true;
  return (trainer.rating ?? 0) >= (ratingFilter === "4_5_plus" ? 4.5 : 4.0);
}

export function matchesQuery(trainer: Trainer, query: string) {
  const normalized = query.trim().toLocaleLowerCase("th-TH");
  if (!normalized) return true;
  return [
    trainer.displayName,
    trainer.nickname ?? "",
    trainer.headline,
    ...trainer.trainingTypes.map((type) => type.nameTh),
  ].join(" ").toLocaleLowerCase("th-TH").includes(normalized);
}

export type TrainerFilterState = {
  query: string;
  trainingType: string;
  priceRange: TrainerPriceRange;
  ratingFilter: TrainerRatingFilter;
  /** Optional so older callers keep working; missing means every level. */
  experience?: TrainerExperienceFilter;
  verifiedOnly: boolean;
  /** Legacy `?available=1`; treated as "free on any day". */
  availableOnly: boolean;
  priceBasis?: TrainerPriceBasis;
  availabilityDay?: TrainerAvailabilityDay;
  availabilityDate?: string;
  timeOfDay?: TrainerTimeOfDay;
};

function matchesAll(trainer: Trainer, filters: TrainerFilterState, overrides: Partial<TrainerFilterState> = {}) {
  const state = { ...filters, ...overrides };
  return matchesQuery(trainer, state.query)
    && (!state.trainingType || trainer.trainingTypes.some((type) => type.slug === state.trainingType))
    && matchPrice(trainer, state.priceRange)
    && matchRating(trainer, state.ratingFilter)
    && matchExperience(trainer, state.experience ?? "all")
    && (!state.verifiedOnly || trainer.verification === "verified")
    && matchAvailability(
      trainer,
      state.availableOnly && (state.availabilityDay ?? "all") === "all" ? "any" : state.availabilityDay ?? "all",
      state.timeOfDay ?? "all",
      state.availabilityDate ?? "",
    );
}

export function filterTrainers(trainers: Trainer[], filters: TrainerFilterState) {
  return trainers.filter((trainer) => matchesAll(trainer, filters));
}

/**
 * How many trainers each option would leave, holding every other filter as it
 * is. The count ignores the filter it belongs to — otherwise every option would
 * report the same number as the current selection.
 */
function countBy<Value>(trainers: Trainer[], filters: TrainerFilterState, values: Value[], override: (value: Value) => Partial<TrainerFilterState>) {
  return new Map(values.map((value) => [value, trainers.filter((trainer) => matchesAll(trainer, filters, override(value))).length]));
}

// Every known type is counted, so one nobody offers reports 0 instead of nothing.
export function countByTrainingType(trainers: Trainer[], filters: TrainerFilterState, trainingTypes: TrainingType[]) {
  return countBy(trainers, filters, ["", ...trainingTypes.map((type) => type.slug)], (trainingType) => ({ trainingType }));
}

export function countByPriceRange(trainers: Trainer[], filters: TrainerFilterState) {
  return countBy(trainers, filters, priceRangeOptionsByBasis[filters.priceBasis ?? "session"].map((option) => option.value), (priceRange) => ({ priceRange }));
}

export function countByRating(trainers: Trainer[], filters: TrainerFilterState) {
  return countBy(trainers, filters, ratingFilterOptions.map((option) => option.value), (ratingFilter) => ({ ratingFilter }));
}

export function countByAvailabilityDay(trainers: Trainer[], filters: TrainerFilterState) {
  return countBy(trainers, filters, availabilityDayOptions.map((option) => option.value), (availabilityDay) => ({ availableOnly: false, availabilityDay }));
}

export function countByExperience(trainers: Trainer[], filters: TrainerFilterState) {
  return countBy(trainers, filters, experienceFilterOptions.map((option) => option.value), (experience) => ({ experience }));
}

type TrainerMarketplaceFiltersProps = {
  experience?: TrainerExperienceFilter;
  onExperienceChange?: (value: TrainerExperienceFilter) => void;
  experienceCounts?: Map<TrainerExperienceFilter, number>;
  ratingFilter?: TrainerRatingFilter;
  onRatingFilterChange?: (value: TrainerRatingFilter) => void;
  idPrefix: "desktop" | "mobile";
  trainingTypes: TrainingType[];
  trainingType: string;
  priceRange: TrainerPriceRange;
  verifiedOnly: boolean;
  priceBasis?: TrainerPriceBasis;
  onPriceBasisChange?: (value: TrainerPriceBasis) => void;
  availabilityDay?: TrainerAvailabilityDay;
  availabilityDate?: string;
  timeOfDay?: TrainerTimeOfDay;
  availabilityCounts?: Map<TrainerAvailabilityDay, number>;
  onAvailabilityDayChange?: (value: TrainerAvailabilityDay) => void;
  onAvailabilityDateChange?: (value: string) => void;
  onTimeOfDayChange?: (value: TrainerTimeOfDay) => void;
  trainingTypeCounts?: Map<string, number>;
  priceCounts?: Map<TrainerPriceRange, number>;
  ratingCounts?: Map<TrainerRatingFilter, number>;
  resultCount?: number;
  onTrainingTypeChange: (value: string) => void;
  onPriceRangeChange: (value: TrainerPriceRange) => void;
  onVerifiedOnlyChange: (value: boolean) => void;
};

/** `ทั้งหมด (12)` reads as a fact; the bare label makes the reader guess. */
function withCount(label: string, count: number | undefined) {
  return count === undefined ? label : `${label} (${count})`;
}

export function TrainerMarketplaceFilters({
  idPrefix,
  trainingTypes,
  trainingType,
  priceRange,
  ratingFilter,
  experience,
  onExperienceChange,
  experienceCounts,
  verifiedOnly,
  priceBasis = "session",
  onPriceBasisChange,
  availabilityDay = "all",
  availabilityDate = "",
  timeOfDay = "all",
  availabilityCounts,
  onAvailabilityDayChange,
  onAvailabilityDateChange,
  onTimeOfDayChange,
  trainingTypeCounts,
  priceCounts,
  ratingCounts,
  resultCount,
  onRatingFilterChange,
  onTrainingTypeChange,
  onPriceRangeChange,
  onVerifiedOnlyChange,
}: TrainerMarketplaceFiltersProps) {
  const trainingTypeId = `${idPrefix}-training-type`;
  const priceRangeId = `${idPrefix}-price-range`;
  const verifiedId = `${idPrefix}-verified-only`;
  const availabilityDayId = `${idPrefix}-availability-day`;
  const availabilityDateId = `${idPrefix}-availability-date`;
  const today = bangkokDateAndHour(new Date()).date;

  return (
    <div className="marketplace-filter-fields">
      <div className="field">
        <Label htmlFor={trainingTypeId}>หมวดหมู่ความเชี่ยวชาญ</Label>
        <NativeSelect id={trainingTypeId} value={trainingType} onChange={(event) => onTrainingTypeChange(event.target.value)}>
          <NativeSelectOption value="">{withCount("ทุกหมวดหมู่", trainingTypeCounts?.get(""))}</NativeSelectOption>
          {trainingTypes.map((type) => (
            <NativeSelectOption key={type.id} value={type.slug}>
              {withCount(formatTrainingTypeName(type.nameTh), trainingTypeCounts?.get(type.slug))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="field">
        <Label htmlFor={priceRangeId}>ราคาค่าจ้างต่อวัน/เดือน</Label>
        {onPriceBasisChange && (
          <div className="marketplace-segment" role="group" aria-label="คิดราคาค่าจ้าง">
            {priceBasisOptions.map((option) => (
              <button key={option.value} type="button" aria-pressed={priceBasis === option.value} onClick={() => onPriceBasisChange(option.value)}>{option.label}</button>
            ))}
          </div>
        )}
        <NativeSelect id={priceRangeId} value={priceRange} onChange={(event) => onPriceRangeChange(event.target.value as TrainerPriceRange)}>
          {priceRangeOptionsByBasis[priceBasis].map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {withCount(option.label, priceCounts?.get(option.value))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {onRatingFilterChange && (
        <div className="field">
          <Label htmlFor={`${idPrefix}-rating-filter`}>คะแนนรีวิว</Label>
          <NativeSelect id={`${idPrefix}-rating-filter`} value={ratingFilter ?? "all"} onChange={(event) => onRatingFilterChange(event.target.value as TrainerRatingFilter)}>
            {ratingFilterOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {withCount(option.label, ratingCounts?.get(option.value))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}

      {onExperienceChange && (
        <div className="field">
          <Label htmlFor={`${idPrefix}-experience-filter`}>ระดับประสบการณ์</Label>
          <NativeSelect id={`${idPrefix}-experience-filter`} value={experience ?? "all"} onChange={(event) => onExperienceChange(event.target.value as TrainerExperienceFilter)}>
            {experienceFilterOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {withCount(option.label, experienceCounts?.get(option.value))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}

      <label className="marketplace-check-row" htmlFor={verifiedId}>
        <input id={verifiedId} type="checkbox" checked={verifiedOnly} onChange={(event) => onVerifiedOnlyChange(event.target.checked)} />
        <span>เฉพาะโปรไฟล์ที่ตรวจแล้ว</span>
      </label>

      {onAvailabilityDayChange && (
        <fieldset className="field marketplace-availability">
          <legend>ตารางเวลาที่ว่าง</legend>
          <Label htmlFor={availabilityDayId} className="sr-only">วันที่ว่าง</Label>
          <NativeSelect id={availabilityDayId} value={availabilityDay} onChange={(event) => onAvailabilityDayChange(event.target.value as TrainerAvailabilityDay)}>
            {availabilityDayOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.value === "date" ? option.label : withCount(option.label, availabilityCounts?.get(option.value))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {availabilityDay === "date" && onAvailabilityDateChange && (
            <label className="marketplace-availability__date" htmlFor={availabilityDateId}>
              <span>วันที่ต้องการฝึก</span>
              <input id={availabilityDateId} type="date" lang="th-TH" min={today} value={availabilityDate} onChange={(event) => onAvailabilityDateChange(event.target.value)} />
            </label>
          )}
          {onTimeOfDayChange && (
            <div className="marketplace-segment marketplace-segment--time" role="group" aria-label="ช่วงเวลาที่ว่าง">
              {timeOfDayOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={timeOfDay === option.value}
                  title={option.hint || undefined}
                  onClick={() => onTimeOfDayChange(option.value)}
                >
                  {option.label}
                  {option.hint && <span className="sr-only"> {option.hint}</span>}
                </button>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <p className="marketplace-filter-note" role="status" aria-live="polite">
        ตัวเลขในวงเล็บคือจำนวนเทรนเนอร์ที่ตัวเลือกนั้นจะเหลือ
        {resultCount !== undefined && ` · ขณะนี้แสดง ${resultCount} รายการ`}
      </p>
    </div>
  );
}
