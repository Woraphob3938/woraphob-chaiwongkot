---
version: 1
slug: "transaction-surfaces"
primary_target: "components/trainer-discovery.tsx"
related_targets: ["components/trainer-detail.tsx", "components/booking-form.tsx", "components/payment-panel.tsx", "components/review-form.tsx", "components/chat-workbench.tsx"]
---

# Guided FitConnect transaction surfaces

## Scope and mode

- Routes: `/trainers`, one trainer profile, `/booking`, member payment/review controls, and `/chat`.
- Mode: Operate.
- Purpose: preserve the complete existing search-to-review workflow while making the current fact and one next action readable before supporting evidence.

## Shared hierarchy

1. Identity or current transaction status.
2. Facts required for the present decision.
3. One primary action allowed by live state.
4. Evidence, history, complete schedules, and booking facts in named native disclosures.

No disclosure may hide a fact required to confirm a destructive or irreversible action. Disclosed content remains mounted and reachable by keyboard; a fragment link never substitutes for opening a closed group.

Province, service-area, and appointment-location fields are outside the transaction contract. Discovery uses specialty, qualifications, service mode, price, rating, and availability. Booking preserves trainer, date, time, price context, optional member note, and recorded workflow states.

## Surface contract

| Surface | Summary-visible | Disclosure-visible | Primary action |
|---|---|---|---|
| Discovery | Marketplace query, result count, sort, trainer cards, verification, fixed session price, selected availability | Desktop filter rail or mobile Sheet; credentials/evidence | Select an available time |
| Trainer profile | Commerce-detail identity, verification, specialty, fixed session price, selected slot | Credentials; full schedule | Continue with one selected time |
| Booking | Trainer, date, time, snapshotted price, 10-minute hold notice | No required fact is hidden; note is optional | Confirm booking and start the timer |
| Payment | Current payment state, `paymentDeadlineAt` countdown, administrator note when present, actionable upload form | Booking ID, trainer, fixed session fee, and prior submitted amount when present | Send evidence for administrator review |
| Review | Current review returned by the API (rating, comment, and status), which may be `published`, `hidden`, or `reported`; or an actionable rating/comment form | No review-history disclosure exists; only the current API review is shown directly in the summary | Submit review |
| Chat | Room list, active heading, messages, composer | Booking ID, date, time, price, appointment state | Send message |

## Manual-review truthfulness

- Certificate, trainer-application, and transfer-evidence decisions are made by an administrator.
- Approved copy: “ส่งหลักฐานให้ผู้ดูแลตรวจ”, “รอผู้ดูแลตรวจหลักฐาน”, “ผู้ดูแลตรวจเอกสารแล้ว”.
- Prohibited copy: claims of automatic checks, instant approval, guaranteed verification, or completion before a recorded administrator decision.
- Error, success, disabled, and retry text must describe the recorded state without predicting the next decision.
- A booking starts in `awaiting_payment` with the trainer's fixed price and a database-backed 10-minute deadline. Trainers do not accept, reject, or quote individual bookings.
- The first rejected payment opens one fresh 10-minute retry. The second rejection, or reaching the deadline, records `expired` and releases the slot. Expiry is request-driven and remains transactional.

## Responsive and accessibility contract

- 1280px may use multiple columns while preserving DOM order; desktop chat facts may start open but remain collapsible.
- 768px and below stack to one column. Detailed filters, evidence, full schedules/history, and chat booking facts start closed; search, current summary, and primary action remain visible.
- 414/375/320px wrap Thai copy, filenames, booking IDs, money, and metadata. Controls remain at least 44px and sticky navigation/booking controls never cover content.
- At 200% zoom every summary and primary action remains reachable without page-level horizontal scrolling.
- Every disclosure is native `<details>/<summary>`, has a unique visible name, Enter/Space operation, and the shared 3px `:focus-visible` ring.
- Loading uses a polite live region; blocking errors use `role="alert"`; retries stay adjacent to the failure. Busy actions are disabled and expose an in-progress label.
- Reduced motion disables non-essential scrolling and transitions; disclosure height is never animated.

## Verification ownership

- Component tests cover disclosure defaults, result/slot selection, stale-slot prevention, upload/review validation, chat send/retry, and long-value wrapping.
- Browser review covers `/`, `/trainers`, one profile, `/booking`, `/member`, `/trainer`, `/admin`, and `/chat` at 1280/768/414/375/320, plus 200% zoom, keyboard, reduced motion, and representative no-data/loading/error/disabled/success states where the local data permits.
- Live XAMPP smoke and booking audit own persistence evidence for booking/history/payments/rooms/messages/reviews. Frontend copy never substitutes for that audit.
- The 2026-08-11 live audit passed for approved booking `BK-E6A1B695` with booking/history/payments/rooms/messages/reviews counts `1/6/2/1/2/1` and slot `booked`. Expired booking `BK-2E148BC9` recorded one expiry transition and its released slot was successfully rebooked into `held`.
- The final browser matrix passed all 35 route/width combinations without page-level overflow. The mobile filter Sheet and booking Dialog close with Escape and restore focus; the Dialog's explicit focus return is covered by a regression test.
- Live booking `BK-AB150410` exposed a visible 10-minute countdown on the member dashboard without a per-second live-region announcement.

## Boundaries

- Do not add a backend endpoint, table, status, automatic decision, recommendation, invented metric, or new product workflow.
- Do not remove existing trainer evidence, booking facts, payment evidence, messages, reviews, conflict handling, or retry paths.
- Demonstration portraits and data retain their sample-data disclosure until production sources are supplied.
