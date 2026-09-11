---
timestamp: 2026-08-11T09-59-52Z
slug: components-trainer-detail-tsx
---
## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|---:|---|
| 1 | Visibility of System Status | 3 | Booking feedback is clear; public review loading/error states are not designed yet. |
| 2 | Match System / Real World | 3 | Thai copy is natural, but “รีวิวจริง” and visible profile IDs expose system language. |
| 3 | User Control and Freedom | 3 | Booking and disclosure controls are clear; a long review list needs a route back to booking. |
| 4 | Consistency and Standards | 2 | The profile says no reviews while live aggregate data reports 4.8 from 16 reviews. |
| 5 | Error Prevention | 3 | Review eligibility exists; public output still needs explicit published/completed filtering. |
| 6 | Recognition Rather Than Recall | 2 | Review evidence visible in discovery disappears on the profile. |
| 7 | Flexibility and Efficiency | 2 | Booking is direct, but reviews have no concise inspection pattern yet. |
| 8 | Aesthetic and Minimalist Design | 3 | Strong commerce hierarchy; an unrestricted review feed would dilute it. |
| 9 | Error Recovery | 2 | Review retrieval needs an adjacent error and retry without blanking the profile. |
| 10 | Help and Documentation | 2 | The payment timer is explained; review provenance is not. |
| **Total** | | **25/40** | **Acceptable — visually strong, but trust evidence is inconsistent.** |

## Design Specificity Verdict

The current page is authored for FitConnect: athletic typography, evidence-first borders, verification status, fixed price, and direct booking make it feel like an Athlete Credential marketplace rather than a generic fitness directory. Reviews belong here as another auditable evidence ledger. Generic testimonial cards, avatars, quotation marks, yellow-star decoration, or a carousel would weaken that specificity.

The deterministic detector returned `[]`, but manual and browser evidence found important product-integrity, responsive, and semantic issues that the detector does not model.

## Overall Impression

Adding reviews to the trainer profile is the correct decision. Keep the aggregate near the trainer’s identity and put detailed reviews in a full-width section below the three-column commerce layout. This preserves the booking action while making trust inspectable.

## What’s Working

- The identity / evidence / booking composition gives each job a clear zone.
- Verification, fixed price, and the ten-minute payment rule communicate concrete product truth.
- Native disclosures and visible focus styles provide a suitable pattern for long review lists.

## Priority Issues

### [P1] The current review state is factually wrong

`components/trainer-detail.tsx:109` always renders “ยังไม่มีรีวิวจริง,” while the live profile reports `rating: 4.8` and `reviewCount: 16`. This contradicts the marketplace and directly damages trust.

**Fix:** Render `4.8 จาก 5 · 16 รีวิว` dynamically; use `ยังไม่มีรีวิวจากการฝึกที่เสร็จแล้ว` only when the published count is zero.

**Suggested command:** `$impeccable clarify`

### [P1] A public detailed-review contract is missing

The detail payload includes only aggregate rating/count. The public list must not expose internal review, booking, member, or trainer IDs, and must never leak hidden/reported reviews.

**Fix:** Extend only the trainer-detail response with `{ rating, comment, createdAt }`, filtered to published reviews tied to completed bookings, ordered by `created_at DESC, id DESC`. Avoid adding this query to the shared catalog payload to prevent N+1 queries.

**Suggested command:** `$impeccable harden`

### [P1] Review placement must preserve the booking hierarchy

Detailed comments inside the identity block or booking rail would compete with the primary action. Adding them as an ordinary fourth grid child would also create an implicit grid cell.

**Fix:** Add a sibling `<section aria-labelledby>` after `.trainer-commerce-layout`, inside `main.profile-shell`. Show three newest reviews, then a native disclosure `ดูรีวิวเพิ่มเติม (N)`. Keep a restrained `กลับไปเลือกเวลา` route after a long mobile list.

**Suggested command:** `$impeccable layout`

### [P2] The responsive contract and heading order need correction

At 768px the live page remains two columns despite the documented one-column contract. Opening credentials also yields H1 → H3/H3 → H2.

**Fix:** Stack the profile at 768px and below; make credential headings structurally subordinate to the section H2 before adding a review H2.

**Suggested command:** `$impeccable adapt`

### [P2] Public system identifiers and sample imagery weaken trust

The visible `#001` has no member value, while the demonstration portrait lacks the required synthetic/sample disclosure.

**Fix:** Remove the visible internal ID and apply the existing sample-image disclosure contract.

**Suggested command:** `$impeccable distill`

## Persona Red Flags

- **Jordan (first-timer):** “ยังไม่มีรีวิวจริง” implies either nobody used the trainer or other reviews may be fake. The `#001` identifier provides no useful meaning.
- **Sam (keyboard/screen reader):** Rating needs text such as `4.8 จาก 5 ดาว`; dates need `<time dateTime>`, and the current heading order should be repaired.
- **Casey (mobile):** An unlimited review feed would push booking out of reach. Three visible items plus disclosure and a return-to-booking action is safer.
- **Member comparing trainers:** Aggregate rating without recent comments and dates is weak decision evidence; completed-booking provenance is the useful differentiator.

## Minor Observations

- Prefer `รีวิวจากการฝึกที่เสร็จแล้ว` over the vague `รีวิวจริง`.
- Use Thai date-only formatting; timestamps add noise.
- Do not invent member names, initials, avatars, or “verified buyer” badges.
- Long Thai comments need `overflow-wrap` and reviews should not look clickable without an action.
- The supplied table is an older conceptual schema; the live schema and existing review index are sufficient without a schema migration.

## Questions to Consider

- Should completed-booking provenance become one consistent trust label across discovery and profiles?
- Does the public page need any numeric trainer identifier when the slug and display name already identify the trainer?
- After reading three reviews on a phone, is selecting a time still the easiest next action?
