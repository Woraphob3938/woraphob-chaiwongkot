---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/trainers/page.tsx"]
---

# FitConnect trainer discovery and booking

## Scope and mode

- Primary targets: `/` and `/trainers`.
- Mode: Operate.
- The public opening introduces the product through the real trainer-discovery workbench rather than a detached marketing hero.

## Audience, job, and action

- Primary audience: members searching for a suitable trainer; Sakon Nakhon is the seeded launch area, while location controls support future provinces.
- Job: compare verified trainer evidence and actual availability without leaving the discovery flow.
- Primary action: select a verified trainer and a free time, then continue to booking.

## Approved direction

- Visual world: Athlete Credential.
- Primary approved comp: `.impeccable/mocks/fitconnect-verification-path.png`.
- Supporting comp: `.impeccable/mocks/fitconnect-accreditation-rail.png`, used only for its persistent booking strip.
- Memorable moment: the trainer credential crosses into the schedule zone; selecting a time completes the booking strip instead of opening an unrelated checkout card.

## Implementation inventory

| Visible ingredient | Commitment | Medium |
| --- | --- | --- |
| Search-led navigation | FitConnect wordmark, trainer search, role-aware actions | Semantic HTML/CSS + Lucide icons |
| Three-zone workbench | 25/45/30 desktop ratio, selected credential dominant | Semantic HTML/CSS Grid |
| Trainer portrait | Clearly marked demonstration portrait; replaceable later | Generated raster asset |
| Credential geometry | Sparse clipped corners, verification punch, ruled evidence rows | CSS + small authored SVG marks |
| Filter ledger | Labels above controls; province is expandable beyond Sakon Nakhon | Semantic form controls |
| Certificate evidence | Named status plus icon; no color-only meaning | Semantic list/definition rows |
| Availability | Tabular times, explicit available/selected/unavailable labels | Buttons in semantic list + tabular numerals |
| Persistent booking strip | Selected trainer, date, time, status, one `จองเวลา` action | Sticky semantic aside; C4 behavior on narrow screens |
| Booking and chat continuation | Ruled history plus conversation handoff below main work area | Semantic timeline + message list |
| Responsive collapse | Evidence first; filters become disclosure; schedule stacks; booking strip stays reachable | CSS container/media queries |

## Constraints

- Thai-first, WCAG 2.2 AA, 320/375/414/768 px verified.
- Demonstration names, portraits, prices, ratings, and dates must be labelled as sample data.
- Manual certificate and slip review must not be described as automatic.
- No dark-neon fitness landing page, cream wellness marketplace, testimonial, invented metric, or customer logo.
- The comp is a north star: preserve topology and hierarchy, but keep text and controls semantic rather than rasterized.

## Unresolved

- Production trainer photography and a final logo have not been supplied; demonstration assets remain replaceable.
