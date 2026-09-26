"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { formatTrainingTypeName } from "@/lib/format";
import type { Trainer, TrainingType } from "@/lib/types";

export type TrainerPriceRange = "all" | "under_700" | "701_1000" | "over_1000";
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

export const priceRangeOptions: { value: TrainerPriceRange; label: string }[] = [
  { value: "all", label: "ทุกช่วงราคา" },
  { value: "under_700", label: "ไม่เกิน ฿700" },
  { value: "701_1000", label: "฿701–฿1,000" },
  { value: "over_1000", label: "มากกว่า ฿1,000" },
];

export const ratingFilterOptions: { value: TrainerRatingFilter; label: string }[] = [
  { value: "all", label: "ทุกคะแนน" },
  { value: "4_plus", label: "4.0 ดาวขึ้นไป" },
  { value: "4_5_plus", label: "4.5 ดาวขึ้นไป" },
];

export function matchPrice(trainer: Trainer, priceRange: TrainerPriceRange) {
  if (priceRange === "all") return true;
  if (trainer.priceFrom == null) return false;
  if (priceRange === "under_700") return trainer.priceFrom <= 700;
  if (priceRange === "701_1000") return trainer.priceFrom >= 701 && trainer.priceFrom <= 1_000;
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
  availableOnly: boolean;
};

function matchesAll(trainer: Trainer, filters: TrainerFilterState, overrides: Partial<TrainerFilterState> = {}) {
  const state = { ...filters, ...overrides };
  return matchesQuery(trainer, state.query)
    && (!state.trainingType || trainer.trainingTypes.some((type) => type.slug === state.trainingType))
    && matchPrice(trainer, state.priceRange)
    && matchRating(trainer, state.ratingFilter)
    && matchExperience(trainer, state.experience ?? "all")
    && (!state.verifiedOnly || trainer.verification === "verified")
    && (!state.availableOnly || trainer.slots.length > 0);
}

export function filterTrainers(trainers: Trainer[], filters: TrainerFilterState) {
  return trainers.filter((trainer) => matchesAll(trainer, filters));
}

/**
 * How many trainers each option would leave, holding every other filter as it
 * is. The count ignores the filter it belongs to — otherwise every option would
 * report the same number as the current selection.
 */
export function countByTrainingType(trainers: Trainer[], filters: TrainerFilterState, trainingTypes: TrainingType[]) {
  const counts = new Map<string, number>();
  counts.set("", filterTrainers(trainers, { ...filters, trainingType: "" }).length);
  // Seed every known type so one nobody offers reports 0 instead of nothing.
  for (const type of trainingTypes) {
    counts.set(type.slug, filterTrainers(trainers, { ...filters, trainingType: type.slug }).length);
  }
  return counts;
}

export function countByPriceRange(trainers: Trainer[], filters: TrainerFilterState) {
  const counts = new Map<TrainerPriceRange, number>();
  for (const option of priceRangeOptions) {
    counts.set(option.value, filterTrainers(trainers, { ...filters, priceRange: option.value }).length);
  }
  return counts;
}

export function countByRating(trainers: Trainer[], filters: TrainerFilterState) {
  const counts = new Map<TrainerRatingFilter, number>();
  for (const option of ratingFilterOptions) {
    counts.set(option.value, filterTrainers(trainers, { ...filters, ratingFilter: option.value }).length);
  }
  return counts;
}

export function countByExperience(trainers: Trainer[], filters: TrainerFilterState) {
  const counts = new Map<TrainerExperienceFilter, number>();
  for (const option of experienceFilterOptions) {
    counts.set(option.value, filterTrainers(trainers, { ...filters, experience: option.value }).length);
  }
  return counts;
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
  availableOnly: boolean;
  trainingTypeCounts?: Map<string, number>;
  priceCounts?: Map<TrainerPriceRange, number>;
  ratingCounts?: Map<TrainerRatingFilter, number>;
  resultCount?: number;
  onTrainingTypeChange: (value: string) => void;
  onPriceRangeChange: (value: TrainerPriceRange) => void;
  onVerifiedOnlyChange: (value: boolean) => void;
  onAvailableOnlyChange: (value: boolean) => void;
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
  availableOnly,
  trainingTypeCounts,
  priceCounts,
  ratingCounts,
  resultCount,
  onRatingFilterChange,
  onTrainingTypeChange,
  onPriceRangeChange,
  onVerifiedOnlyChange,
  onAvailableOnlyChange,
}: TrainerMarketplaceFiltersProps) {
  const trainingTypeId = `${idPrefix}-training-type`;
  const priceRangeId = `${idPrefix}-price-range`;
  const verifiedId = `${idPrefix}-verified-only`;
  const availableId = `${idPrefix}-available-only`;

  return (
    <div className="marketplace-filter-fields">
      <div className="field">
        <Label htmlFor={trainingTypeId}>ประเภทการฝึก</Label>
        <NativeSelect
          id={trainingTypeId}
          value={trainingType}
          onChange={(event) => onTrainingTypeChange(event.target.value)}
        >
          <NativeSelectOption value="">{withCount("ทุกประเภท", trainingTypeCounts?.get(""))}</NativeSelectOption>
          {trainingTypes.map((type) => (
            <NativeSelectOption key={type.id} value={type.slug}>
              {withCount(formatTrainingTypeName(type.nameTh), trainingTypeCounts?.get(type.slug))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className="field">
        <Label htmlFor={priceRangeId}>ค่าฝึกต่อครั้ง</Label>
        <NativeSelect
          id={priceRangeId}
          value={priceRange}
          onChange={(event) => onPriceRangeChange(event.target.value as TrainerPriceRange)}
        >
          {priceRangeOptions.map((option) => (
            <NativeSelectOption key={option.value} value={option.value}>
              {withCount(option.label, priceCounts?.get(option.value))}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {onRatingFilterChange && (
        <div className="field">
          <Label htmlFor={`${idPrefix}-rating-filter`}>คะแนนรีวิว</Label>
          <NativeSelect
            id={`${idPrefix}-rating-filter`}
            value={ratingFilter ?? "all"}
            onChange={(event) => onRatingFilterChange(event.target.value as TrainerRatingFilter)}
          >
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
          <NativeSelect
            id={`${idPrefix}-experience-filter`}
            value={experience ?? "all"}
            onChange={(event) => onExperienceChange(event.target.value as TrainerExperienceFilter)}
          >
            {experienceFilterOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {withCount(option.label, experienceCounts?.get(option.value))}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
      )}

      <label className="marketplace-check-row" htmlFor={verifiedId}>
        <input
          id={verifiedId}
          type="checkbox"
          checked={verifiedOnly}
          onChange={(event) => onVerifiedOnlyChange(event.target.checked)}
        />
        <span>เฉพาะโปรไฟล์ที่ตรวจแล้ว</span>
      </label>

      <label className="marketplace-check-row" htmlFor={availableId}>
        <input
          id={availableId}
          type="checkbox"
          checked={availableOnly}
          onChange={(event) => onAvailableOnlyChange(event.target.checked)}
        />
        <span>เฉพาะเทรนเนอร์ที่มีเวลาว่าง</span>
      </label>

      <p className="marketplace-filter-note" role="status" aria-live="polite">
        ตัวเลขในวงเล็บคือจำนวนเทรนเนอร์ที่ตัวเลือกนั้นจะเหลือ
        {resultCount !== undefined && ` · ขณะนี้แสดง ${resultCount} รายการ`}
      </p>
    </div>
  );
}
