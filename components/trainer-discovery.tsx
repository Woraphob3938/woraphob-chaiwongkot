"use client";

import { useEffect, useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";

import { TrainerMarketplaceCard } from "@/components/trainer-marketplace-card";
import {
  TrainerMarketplaceFilters,
  type TrainerPriceRange,
  type TrainerRatingFilter,
} from "@/components/trainer-marketplace-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function matchesPrice(trainer: Trainer, priceRange: TrainerPriceRange) {
  if (priceRange === "all") return true;
  if (trainer.priceFrom == null) return false;
  if (priceRange === "under_700") return trainer.priceFrom <= 700;
  if (priceRange === "701_1000") return trainer.priceFrom >= 701 && trainer.priceFrom <= 1_000;
  return trainer.priceFrom > 1_000;
}

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
    typeof initialFilters.price === "string" && ["under_700", "701_1000", "over_1000"].includes(initialFilters.price) ? initialFilters.price as TrainerPriceRange : "all",
  );
  const [ratingFilter, setRatingFilter] = useState<TrainerRatingFilter>(
    typeof initialFilters.rating === "string" && ["4_plus", "4_5_plus"].includes(initialFilters.rating) ? initialFilters.rating as TrainerRatingFilter : "all",
  );
  const [verifiedOnly, setVerifiedOnly] = useState(initialFilters.verified === "1");
  const [availableOnly, setAvailableOnly] = useState(initialFilters.available === "1");
  const [sortMode, setSortMode] = useState<SortMode>(
    typeof initialFilters.sort === "string" && ["price_asc", "price_desc", "rating_desc"].includes(initialFilters.sort) ? initialFilters.sort as SortMode : "availability",
  );
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (trainingType) search.set("type", trainingType);
  if (priceRange !== "all") search.set("price", priceRange);
  if (ratingFilter !== "all") search.set("rating", ratingFilter);
  if (verifiedOnly) search.set("verified", "1");
  if (availableOnly) search.set("available", "1");
  if (sortMode !== "availability") search.set("sort", sortMode);
  const returnTo = `/trainers${search.size ? `?${search}` : ""}`;

  useEffect(() => {
    window.history.replaceState(null, "", returnTo);
  }, [returnTo]);

  const activeFilterCount = [
    Boolean(trainingType),
    priceRange !== "all",
    ratingFilter !== "all",
    verifiedOnly,
    availableOnly,
  ].filter(Boolean).length;
  const hasActiveFilters = Boolean(query.trim()) || activeFilterCount > 0;

  function clearFilters() {
    setQuery("");
    setTrainingType("");
    setPriceRange("all");
    setRatingFilter("all");
    setVerifiedOnly(false);
    setAvailableOnly(false);
  }

  const visibleTrainers = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("th-TH");
    const matches = initialTrainers.filter((trainer) => {
      const searchText = [
        trainer.displayName,
        trainer.headline,
        ...trainer.trainingTypes.map((type) => type.nameTh),
      ].join(" ").toLocaleLowerCase("th-TH");

      return (!normalizedQuery || searchText.includes(normalizedQuery))
        && (!trainingType || trainer.trainingTypes.some((type) => type.slug === trainingType))
        && matchesPrice(trainer, priceRange)
        && (ratingFilter === "all" || (trainer.rating ?? 0) >= (ratingFilter === "4_5_plus" ? 4.5 : 4.0))
        && (!verifiedOnly || trainer.verification === "verified")
        && (!availableOnly || trainer.slots.length > 0);
    });

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
  }, [availableOnly, initialTrainers, priceRange, query, ratingFilter, sortMode, trainingType, verifiedOnly]);

  const filterProps = {
    trainingTypes,
    trainingType,
    priceRange,
    ratingFilter,
    verifiedOnly,
    availableOnly,
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
              <Input
                id="trainer-marketplace-query"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ชื่อหรือความเชี่ยวชาญ"
                aria-label="ค้นหาชื่อหรือความเชี่ยวชาญ"
              />
            </div>
          </div>

          <Sheet>
            <SheetTrigger asChild>
              <Button
                className="marketplace-filter-trigger"
                variant="outline"
                aria-label={activeFilterCount > 0
                  ? `เปิดตัวกรอง (${activeFilterCount} เงื่อนไข)`
                  : "เปิดตัวกรอง"}
              >
                <Filter aria-hidden="true" /> เปิดตัวกรอง
                {activeFilterCount > 0 && (
                  <span className="marketplace-filter-count" aria-hidden="true">{activeFilterCount}</span>
                )}
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

        <div className="trainer-marketplace__layout">
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
                <p>ลองเปลี่ยนคำค้นหรือลดตัวกรองบางข้อ</p>
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
