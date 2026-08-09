---
version: 1
slug: "app-page-tsx"
primary_target: "app/page.tsx"
related_targets: ["app/trainers/page.tsx"]
---

# Guided FitConnect overview and trainer discovery

## Scope and mode

- Primary targets: `/` as the Guided FitConnect overview and `/trainers` as the detailed discovery/booking workbench.
- Mode: Operate.
- The public opening gives a concise, useful overview of the real service before handing users into the trainer-discovery workbench. It is guidance, not a detached marketing hero or a second booking interface.

## Audience, job, and action

- Primary audience: people learning how FitConnect works and members searching for a suitable trainer; Sakon Nakhon is seeded demonstration data, while location controls and content structure support expansion across Thailand.
- Job on `/`: understand the service, choose a training goal, preview trainer evidence, see the full request-to-review journey, and understand how verification works.
- Job on `/trainers`: filter and compare trainer evidence and availability without leaving the discovery flow.
- Primary action on `/`: continue to `/trainers`; primary action on `/trainers`: select a trainer and a free time, then continue to booking.

## Approved direction

- Visual world: Athlete Credential.
- Primary approved comp: `.impeccable/mocks/fitconnect-verification-path.png`.
- Supporting comp: `.impeccable/mocks/fitconnect-accreditation-rail.png`, used only for its persistent booking strip.
- `/` direction: overview-first Guided FitConnect — opening guidance, training-goal links, compact trainer previews, the five-step service journey, explicit manual-review truth, and a clear handoff into discovery.
- `/trainers` direction: the three-zone Athlete Credential Workbench; the trainer credential crosses into the schedule zone, and selecting a time completes the booking strip instead of opening an unrelated checkout card.

## Implementation inventory

| Visible ingredient | Commitment | Medium |
| --- | --- | --- |
| Shared navigation | FitConnect wordmark, trainer search, role-aware actions, and hydrated role-aware mobile destinations | Semantic HTML/CSS + Lucide icons |
| Guided overview (`/`) | Service orientation, training goals, trainer previews, journey, trust statement, and one clear route into discovery | Semantic sections, lists, links, and CSS Grid |
| Trainer previews (`/`) | Compact evidence summary with profile link; never presented as the full comparison or booking surface | Semantic article + replaceable raster asset |
| Three-zone workbench (`/trainers`) | 25/45/30 desktop ratio, selected credential dominant | Semantic HTML/CSS Grid |
| Trainer portrait | Clearly marked demonstration portrait; replaceable later | Generated raster asset |
| Credential geometry | Sparse clipped corners, verification punch, ruled evidence rows | CSS + small authored SVG marks |
| Filter ledger | Labels above controls; province is expandable beyond Sakon Nakhon | Semantic form controls |
| Certificate evidence | Named status plus icon; no color-only meaning | Semantic list/definition rows |
| Availability | Tabular times, explicit available/selected/unavailable labels | Buttons in semantic list + tabular numerals |
| Persistent booking strip | Selected trainer, date, time, status, one `จองเวลา` action | Sticky semantic aside; C4 behavior on narrow screens |
| Booking and chat continuation | Ruled history plus conversation handoff below main work area | Semantic timeline + message list |
| Responsive collapse | `/` preserves its guided reading order; `/trainers` keeps evidence first, turns filters into a disclosure, stacks the schedule, and keeps the booking strip reachable | CSS container/media queries |

## Constraints

- Thai-first, WCAG 2.2 AA, 320/375/414/768 px verified.
- Demonstration names, portraits, prices, ratings, and dates must be labelled as sample data.
- Certificate and transfer-slip review is performed manually by administrators; neither route may imply automatic approval.
- Province choices must remain data-driven and expandable beyond Sakon Nakhon.
- No dark-neon fitness landing page, cream wellness marketplace, testimonial, invented metric, or customer logo.
- The comp is a north star: preserve topology and hierarchy, but keep text and controls semantic rather than rasterized.

## Unresolved

- Production trainer photography and a final logo have not been supplied; demonstration assets remain replaceable.
