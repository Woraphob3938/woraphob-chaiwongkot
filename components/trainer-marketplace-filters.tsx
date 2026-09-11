"use client";

import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { TrainingType } from "@/lib/types";

export type TrainerPriceRange = "all" | "under_700" | "701_1000" | "over_1000";
export type TrainerRatingFilter = "all" | "4_plus" | "4_5_plus";

type TrainerMarketplaceFiltersProps = {
  ratingFilter?: TrainerRatingFilter;
  onRatingFilterChange?: (value: TrainerRatingFilter) => void;
  idPrefix: "desktop" | "mobile";
  trainingTypes: TrainingType[];
  trainingType: string;
  priceRange: TrainerPriceRange;
  verifiedOnly: boolean;
  availableOnly: boolean;
  onTrainingTypeChange: (value: string) => void;
  onPriceRangeChange: (value: TrainerPriceRange) => void;
  onVerifiedOnlyChange: (value: boolean) => void;
  onAvailableOnlyChange: (value: boolean) => void;
};

export function TrainerMarketplaceFilters({
  idPrefix,
  trainingTypes,
  trainingType,
  priceRange,
  ratingFilter,
  verifiedOnly,
  availableOnly,
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
          <NativeSelectOption value="">ทุกประเภท</NativeSelectOption>
          {trainingTypes.map((type) => (
            <NativeSelectOption key={type.id} value={type.slug}>{type.nameTh}</NativeSelectOption>
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
          <NativeSelectOption value="all">ทุกช่วงราคา</NativeSelectOption>
          <NativeSelectOption value="under_700">ไม่เกิน ฿700</NativeSelectOption>
          <NativeSelectOption value="701_1000">฿701–฿1,000</NativeSelectOption>
          <NativeSelectOption value="over_1000">มากกว่า ฿1,000</NativeSelectOption>
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
            <NativeSelectOption value="all">ทุกคะแนน</NativeSelectOption>
            <NativeSelectOption value="4_plus">4.0 ดาวขึ้นไป</NativeSelectOption>
            <NativeSelectOption value="4_5_plus">4.5 ดาวขึ้นไป</NativeSelectOption>
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
    </div>
  );
}
