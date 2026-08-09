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

## Surface contract

| Surface | Summary-visible | Disclosure-visible | Primary action |
|---|---|---|---|
| Discovery | Query, result count, trainer choices, verification, starting price, selected availability | Detailed filters; credentials/evidence | Select an available time |
| Trainer profile | Identity, verification, specialty, price | Credentials; full schedule | Continue with one selected time |
| Booking | Trainer, date, time, estimated price, trainer-response notice | No required fact is hidden; note is optional | Send booking request |
| Payment | Current payment state, administrator note when present, actionable upload form | Previously submitted amount, quoted fee, and prior evidence metadata | Send evidence for administrator review |
| Review | Current state, published rating/comment when present, or actionable rating/comment form | No review-history disclosure exists; only the current review returned by the system is shown directly in the summary | Submit review |
| Chat | Room list, active heading, messages, composer | Booking ID, date, time, price, appointment state | Send message |

## Manual-review truthfulness

- Certificate, trainer-application, and transfer-evidence decisions are made by an administrator.
- Approved copy: “ส่งหลักฐานให้ผู้ดูแลตรวจ”, “รอผู้ดูแลตรวจหลักฐาน”, “ผู้ดูแลตรวจเอกสารแล้ว”.
- Prohibited copy: claims of automatic checks, instant approval, guaranteed verification, or completion before a recorded administrator decision.
- Error, success, disabled, and retry text must describe the recorded state without predicting the next decision.

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

## Boundaries

- Do not add a backend endpoint, table, status, automatic decision, recommendation, invented metric, or new product workflow.
- Do not remove existing trainer evidence, booking facts, payment evidence, messages, reviews, conflict handling, or retry paths.
- Demonstration portraits and data retain their sample-data disclosure until production sources are supplied.
