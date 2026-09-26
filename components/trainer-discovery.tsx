"use client";

import { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";

import { TrainerMarketplaceCard } from "@/components/trainer-marketplace-card";
import {
  TrainerMarketplaceFilters,
  countByExperience,
  countByPriceRange,
  countByRating,
  countByTrainingType,
  filterTrainers,
  priceRangeOptions,
  ratingFilterOptions,
  experienceFilterOptions,
  type TrainerExperienceFilter,
  type TrainerFilterState,
  type TrainerPriceRange,
  type TrainerRatingFilter,
} from "@/components/trainer-marketplace-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTrainingTypeName } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Trainer, TrainingType } from "@/lib/types";

type Props = {
  initialTrainers: Trainer[];
  trainingTypes: TrainingType[];
  initialQuery?: string;
  initialType?: string;
  initialFilters?: Record<string, string | string[] | undefined>;
};

type SortMode = "availability" | "price_asc" | "price_desc" | "rating_desc";

const sortModes: SortMode[] = ["availability", "price_asc", "price_desc", "rating_desc"];
const priceRanges: TrainerPriceRange[] = priceRangeOptions.map((option) => option.value);
const ratingFilters: TrainerRatingFilter[] = ratingFilterOptions.map((option) => option.value);
const experienceFilters: TrainerExperienceFilter[] = experienceFilterOptions.map((option) => option.value);

export function TrainerDiscovery({
  initialTrainers,
  trainingTypes,
  initialQuery = "",
  initialType = "",
  initialFilters = {},
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [trainingType, setTrainingType] = useState(initialType);
  const [priceRange, setPriceRange] = useState<TrainerPriceRange>(
    typeof initialFilters.price === "string" && priceRanges.includes(initialFilters.price as TrainerPriceRange)
      ? initialFilters.price as TrainerPriceRange
      : "all",
  );
  const [ratingFilter, setRatingFilter] = useState<TrainerRatingFilter>(
    typeof initialFilters.rating === "string" && ratingFilters.includes(initialFilters.rating as TrainerRatingFilter)
      ? initialFilters.rating as TrainerRatingFilter
      : "all",
  );
  const [experience, setExperience] = useState<TrainerExperienceFilter>(
    typeof initialFilters.experience === "string" && experienceFilters.includes(initialFilters.experience as TrainerExperienceFilter)
      ? initialFilters.experience as TrainerExperienceFilter
      : "all",
  );
  const [verifiedOnly, setVerifiedOnly] = useState(initialFilters.verified === "1");
  const [availableOnly, setAvailableOnly] = useState(initialFilters.available === "1");
  const [sortMode, setSortMode] = useState<SortMode>(
    typeof initialFilters.sort === "string" && sortModes.includes(initialFilters.sort as SortMode)
      ? initialFilters.sort as SortMode
      : "availability",
  );
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (trainingType) search.set("type", trainingType);
  if (priceRange !== "all") search.set("price", priceRange);
  if (ratingFilter !== "all") search.set("rating", ratingFilter);
  if (experience !== "all") search.set("experience", experience);
  if (verifiedOnly) search.set("verified", "1");
  if (availableOnly) search.set("available", "1");
  if (sortMode !== "availability") search.set("sort", sortMode);
  const returnTo = `/trainers${search.size ? `?${search}` : ""}`;

  const activeFilterCount = [
    Boolean(trainingType),
    priceRange !== "all",
    ratingFilter !== "all",
    experience !== "all",
    verifiedOnly,
    availableOnly,
  ].filter(Boolean).length;
  const hasActiveFilters = Boolean(query.trim()) || activeFilterCount > 0;

  const clearFilters = () => {
    setQuery("");
    setTrainingType("");
    setPriceRange("all");
    setRatingFilter("all");
    setExperience("all");
    setVerifiedOnly(false);
    setAvailableOnly(false);
  };

  // Memoised so the counts below can depend on the object instead of listing the
  // same six values three more times.
  const filters: TrainerFilterState = useMemo(
    () => ({ query, trainingType, priceRange, ratingFilter, experience, verifiedOnly, availableOnly }),
    [availableOnly, experience, priceRange, query, ratingFilter, trainingType, verifiedOnly],
  );

  // Each option reports how many trainers it would leave, holding every other
  // filter as it is. That is what stops someone from picking an option that
  // empties the list and having to start over.
  const trainingTypeCounts = useMemo(
    () => countByTrainingType(initialTrainers, filters, trainingTypes),
    [filters, initialTrainers, trainingTypes],
  );
  const priceCounts = useMemo(
    () => countByPriceRange(initialTrainers, filters),
    [filters, initialTrainers],
  );
  const ratingCounts = useMemo(
    () => countByRating(initialTrainers, filters),
    [filters, initialTrainers],
  );
  const experienceCounts = useMemo(
    () => countByExperience(initialTrainers, filters),
    [filters, initialTrainers],
  );

  const visibleTrainers = useMemo(() => {
    const matches = filterTrainers(initialTrainers, filters);

    return [...matches].sort((left, right) => {
      if (sortMode === "price_asc") {
        return (left.priceFrom ?? Number.POSITIVE_INFINITY) - (right.priceFrom ?? Number.POSITIVE_INFINITY);
      }
      if (sortMode === "price_desc") {
        return (right.priceFrom ?? -1) - (left.priceFrom ?? -1);
      }
      if (sortMode === "rating_desc") {
        return (right.rating ?? 0) - (left.rating ?? 0);
      }
      return Date.parse(left.slots[0]?.startsAt ?? "9999-12-31")
        - Date.parse(right.slots[0]?.startsAt ?? "9999-12-31");
    });
  }, [filters, initialTrainers, sortMode]);

  const filterProps = {
    trainingTypes,
    trainingType,
    priceRange,
    ratingFilter,
    verifiedOnly,
    availableOnly,
    trainingTypeCounts,
    priceCounts,
    ratingCounts,
    experience,
    experienceCounts,
    onExperienceChange: setExperience,
    resultCount: visibleTrainers.length,
    onTrainingTypeChange: setTrainingType,
    onPriceRangeChange: setPriceRange,
    onRatingFilterChange: setRatingFilter,
    onVerifiedOnlyChange: setVerifiedOnly,
    onAvailableOnlyChange: setAvailableOnly,
  };

  return (
    <>
      <h1 className="sr-only">ค้นหาเทรนเนอร์</h1>

      <section className="trainer-marketplace" aria-label="ตลาดค้นหาเทรนเนอร์">
        <div className="trainer-marketplace__toolbar">
          <div className="marketplace-search-field">
            <Label htmlFor="trainer-marketplace-query">ค้นหาเทรนเนอร์</Label>
            <div className="input-with-icon">
              <Search aria-hidden="true" />
              {/* No aria-label here: it would replace the visible label and a
                  voice-control user saying what they see would not match. */}
              <Input
                id="trainer-marketplace-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ชื่อ ชื่อเล่น หรือความเชี่ยวชาญ"
                aria-describedby="trainer-marketplace-query-hint"
              />
            </div>
            <span className="sr-only" id="trainer-marketplace-query-hint">ค้นได้จากชื่อ ชื่อเล่น และความเชี่ยวชาญของเทรนเนอร์</span>
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button className="marketplace-filter-trigger" variant="outline">
                <Filter aria-hidden="true" />
                <span>เปิดตัวกรอง</span>
                {activeFilterCount > 0 && (
                  <span className="marketplace-filter-count" aria-hidden="true">{activeFilterCount}</span>
                )}
                <span className="sr-only">
                  {activeFilterCount > 0 ? ` ใช้อยู่ ${activeFilterCount} เงื่อนไข` : " ยังไม่ได้ใช้ตัวกรอง"}
                </span>
              </Button>
            </SheetTrigger>
            <SheetContent className="marketplace-filter-sheet" side="left">
              <SheetHeader>
                <SheetTitle>ตัวกรองเทรนเนอร์</SheetTitle>
                <SheetDescription>เลือกเฉพาะข้อมูลที่ช่วยตัดสินใจ</SheetDescription>
              </SheetHeader>
              <div className="marketplace-filter-sheet__body">
                <TrainerMarketplaceFilters idPrefix="mobile" {...filterProps} />
              </div>
              <SheetFooter>
                {hasActiveFilters && (
                  <Button type="button" variant="outline" onClick={clearFilters}>
                    ล้างตัวกรองทั้งหมด
                  </Button>
                )}
                <SheetClose asChild>
                  <Button>ดูผลลัพธ์ {visibleTrainers.length} รายการ</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>

          <div className="marketplace-sort-field">
            <Label htmlFor="trainer-sort">เรียงผลลัพธ์</Label>
            <NativeSelect
              id="trainer-sort"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
            >
              <NativeSelectOption value="availability">เวลาว่างเร็วสุด</NativeSelectOption>
              <NativeSelectOption value="price_asc">ราคาต่ำไปสูง</NativeSelectOption>
              <NativeSelectOption value="price_desc">ราคาสูงไปต่ำ</NativeSelectOption>
              <NativeSelectOption value="rating_desc">คะแนนรีวิวสูงสุด</NativeSelectOption>
            </NativeSelect>
          </div>
        </div>

        {/* One tap narrows the list to a training goal; the same choice stays
            in the filter rail so both controls always agree. */}
        {trainingTypes.length > 0 && (
          <div className="marketplace-type-chips" role="group" aria-label="เลือกประเภทการฝึกแบบเร็ว">
            <button
              type="button"
              className="marketplace-type-chip"
              aria-pressed={trainingType === ""}
              onClick={() => setTrainingType("")}
            >
              ทั้งหมด
            </button>
            {trainingTypes.map((type) => (
              <button
                key={type.id}
                type="button"
                className="marketplace-type-chip"
                aria-pressed={trainingType === type.slug}
                onClick={() => setTrainingType(trainingType === type.slug ? "" : type.slug)}
              >
                {formatTrainingTypeName(type.nameTh)}
              </button>
            ))}
          </div>
        )}

        <div className="trainer-marketplace__layout">
          {/* Sticky so the choice stays visible while the results scroll past it. */}
          <aside className="marketplace-filter-rail" aria-label="ตัวกรองเทรนเนอร์">
            <div>
              <strong>ตัวกรอง</strong>
              <span>ใช้ตัวกรองร่วมกันได้</span>
            </div>
            {hasActiveFilters && (
              <Button
                className="marketplace-clear-filters"
                type="button"
                variant="outline"
                onClick={clearFilters}
              >
                ล้างตัวกรองทั้งหมด
              </Button>
            )}
            <TrainerMarketplaceFilters idPrefix="desktop" {...filterProps} />
          </aside>

          <section className="marketplace-results" aria-labelledby="marketplace-results-title">
            <div className="marketplace-results__heading" aria-live="polite">
              <div>
                <h2 id="marketplace-results-title">เทรนเนอร์ที่พบ</h2>
                <span>{visibleTrainers.length} รายการ</span>
              </div>
              <p>เปิดโปรไฟล์เพื่อดูรายละเอียดและเลือกเวลาฝึก</p>
            </div>

            {visibleTrainers.length > 0 ? (
              <ul
                className="trainer-marketplace-grid"
                aria-label={`ผลการค้นหาเทรนเนอร์ ${visibleTrainers.length} รายการ`}
              >
                {visibleTrainers.map((trainer, index) => (
                  <TrainerMarketplaceCard key={trainer.id} trainer={trainer} priority={index === 0} returnTo={returnTo} />
                ))}
              </ul>
            ) : (
              <div className="marketplace-empty-state" role="status">
                <strong>ยังไม่พบเทรนเนอร์ที่ตรงครบทุกข้อ</strong>
                <p>ลองเปลี่ยนคำค้นหรือลดตัวกรองบางข้อ ตัวเลขในตัวกรองบอกว่าจะเหลือกี่รายการ</p>
                {hasActiveFilters && (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4"
                    onClick={clearFilters}
                  >
                    ล้างตัวกรองทั้งหมด
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>
      </section>
    </>
  );
}
