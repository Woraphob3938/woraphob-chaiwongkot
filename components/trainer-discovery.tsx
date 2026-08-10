"use client";

import { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";

import { DemoNotice } from "@/components/demo-notice";
import { TrainerMarketplaceCard } from "@/components/trainer-marketplace-card";
import {
  TrainerMarketplaceFilters,
  type TrainerPriceRange,
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
  isDemo: boolean;
  initialQuery?: string;
  initialType?: string;
};

type SortMode = "availability" | "price_asc" | "price_desc";

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
  isDemo,
  initialQuery = "",
  initialType = "",
}: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [trainingType, setTrainingType] = useState(initialType);
  const [priceRange, setPriceRange] = useState<TrainerPriceRange>("all");
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("availability");

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
      return Date.parse(left.slots[0]?.startsAt ?? "9999-12-31")
        - Date.parse(right.slots[0]?.startsAt ?? "9999-12-31");
    });
  }, [availableOnly, initialTrainers, priceRange, query, sortMode, trainingType, verifiedOnly]);

  const filterProps = {
    trainingTypes,
    trainingType,
    priceRange,
    verifiedOnly,
    availableOnly,
    onTrainingTypeChange: setTrainingType,
    onPriceRangeChange: setPriceRange,
    onVerifiedOnlyChange: setVerifiedOnly,
    onAvailableOnlyChange: setAvailableOnly,
  };

  return (
    <>
      <section className="marketplace-intro" aria-labelledby="marketplace-title">
        <div>
          <p className="label">ค้นหา · เปรียบเทียบ · เลือกเวลา</p>
          <h1 id="marketplace-title">ค้นหาเทรนเนอร์ที่เหมาะกับคุณ</h1>
        </div>
        <p>ดูความเชี่ยวชาญ ค่าฝึกต่อครั้ง และเวลาว่าง ก่อนเปิดโปรไฟล์เพื่อนัดหมาย</p>
      </section>

      {isDemo && <DemoNotice />}

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
              <Button className="marketplace-filter-trigger" variant="outline">
                <Filter aria-hidden="true" /> เปิดตัวกรอง
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
            </NativeSelect>
          </div>
        </div>

        <div className="trainer-marketplace__layout">
          <aside className="marketplace-filter-rail" aria-label="ตัวกรองเทรนเนอร์">
            <div>
              <strong>ตัวกรอง</strong>
              <span>เลือกได้มากกว่าหนึ่งข้อ</span>
            </div>
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
                  <TrainerMarketplaceCard key={trainer.id} trainer={trainer} priority={index === 0} />
                ))}
              </ul>
            ) : (
              <div className="marketplace-empty-state" role="status">
                <strong>ยังไม่พบเทรนเนอร์ที่ตรงครบทุกข้อ</strong>
                <p>ลองเปลี่ยนคำค้นหรือลดตัวกรองบางข้อ</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </>
  );
}
