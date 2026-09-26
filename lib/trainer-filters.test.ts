import { describe, expect, it } from "vitest";
import { filterTrainers, matchExperience, matchesQuery, type TrainerFilterState } from "@/components/trainer-marketplace-filters";
import { trainers } from "@/lib/demo-data";
import type { Trainer } from "@/lib/types";

const base: TrainerFilterState = {
  query: "",
  trainingType: "",
  priceRange: "all",
  ratingFilter: "all",
  verifiedOnly: false,
  availableOnly: false,
};

function withYears(years: number, nickname: string | null = null): Trainer {
  return { ...trainers[0], yearsExperience: years, nickname };
}

describe("trainer search filters", () => {
  it("finds a trainer by nickname", () => {
    expect(matchesQuery(withYears(3, "โค้ชบอย"), "บอย")).toBe(true);
    expect(matchesQuery(withYears(3, null), "บอย")).toBe(false);
  });

  it("buckets experience levels", () => {
    expect(matchExperience(withYears(1), "under_2")).toBe(true);
    expect(matchExperience(withYears(2), "2_5")).toBe(true);
    expect(matchExperience(withYears(5), "2_5")).toBe(true);
    expect(matchExperience(withYears(6), "over_5")).toBe(true);
    expect(matchExperience(withYears(6), "under_2")).toBe(false);
  });

  it("applies the experience filter with the others", () => {
    const list = [withYears(1), withYears(8)];
    expect(filterTrainers(list, { ...base, experience: "over_5" })).toHaveLength(1);
    expect(filterTrainers(list, base)).toHaveLength(2);
  });
});
