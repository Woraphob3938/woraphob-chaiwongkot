---
version: 1
slug: "role-dashboards"
primary_target: "components/role-dashboard.tsx"
related_targets: ["components/trainer-workbench.tsx", "components/admin-review-queue.tsx", "components/dashboard-primitives.tsx"]
---

# Guided FitConnect role dashboards

## Scope and mode

- Routes: `/member`, `/trainer`, and `/admin` after sign-in.
- Mode: Operate.
- The dashboards guide each role to one truthful next action, then expose recent work and complete records progressively. They do not add metrics, recommendations, workflows, or backend states beyond the approved FitConnect scope.

## Shared hierarchy

1. Role heading and factual status.
2. One `NextActionCard`, derived only from live API state.
3. Compact factual summary or at most three current records.
4. Native `<details>/<summary>` disclosures for complete lists and management controls.

All counts, prices, dates, times, booking states, application notes, and payment-review states come from the existing API. Province, service-area, and appointment-location facts are not part of this surface. A next-action anchor must resolve to content already mounted on the page; opening a disclosure must not duplicate or discard records.

## Deterministic next-action order

### Member

1. Booking with `actions.canPay`: upload transfer evidence.
2. Booking with `actions.canReview`: write a review.
3. Booking in `pending_trainer`: inspect the request while waiting for the trainer.
4. Booking in `payment_review`: inspect the manual review status.
5. Booking in `confirmed`: inspect the appointment.
6. Otherwise: continue to `/trainers` to search.

The selected booking is promoted into the initial three summaries without duplication. Every other booking remains reachable from “ดูการจองทั้งหมด”; each booking summary independently expands its facts and existing payment, review, chat, and trainer-profile actions.

### Trainer

1. No trainer profile: continue the second step and complete professional information.
2. Application `pending`: inspect application status.
3. Application `rejected`: edit and resubmit the application; preserve the administrator note.
4. A `pending_trainer` booking: inspect and decide that request.
5. No availability slots: add the first slot.
6. Otherwise: inspect the current schedule.

The actionable pending booking is first and open; no more than three pending requests are initially mounted. Every remaining pending request is reachable from “ดูคำขอทั้งหมด”. Every availability slot remains in “จัดการช่วงเวลาว่าง”, and every confirmed appointment remains in “นัดหมายที่ยืนยันแล้ว”. Existing accept, reject, quote, delete-slot, completion, conflict, and retry behavior remains unchanged.

### Admin

1. Any trainer application or payment evidence in the queue: open the review queue.
2. Otherwise: inspect the current empty queue.

Trainer and payment counts remain separate and factual. All trainer applications are reachable from “ใบสมัครเทรนเนอร์”; all payment records are reachable from “หลักฐานการชำระเงิน”. Each disclosure keeps the existing document/evidence viewer, note, approve, reject, resolved, conflict, and retry controls.

## States and accessibility contract

- Loading state uses a polite live region; blocking load failure uses `role="alert"` and retains retry.
- Empty states state what is absent and the truthful next step.
- Async controls expose busy/disabled labels instead of duplicate actions.
- Important success and recoverable error messages are programmatically announced; trainer/admin flows move focus to the resulting status or retry alert where implemented.
- Every hidden group uses native `<summary>`, is reachable by Tab, expands with Enter/Space, and shows the shared 3 px `:focus-visible` ring.
- Thai copy and unbroken identifiers may wrap; the page must have no horizontal overflow at 320/375/414/768/1280 px and at 200% zoom.
- Touch controls maintain the shared minimum 44 px target. Status is always conveyed by text, not color alone.

## Verification evidence

- Component tests own deterministic priority, first-three ordering, full-list reachability, long unbroken values, loading/error/retry, conflict, and active async behavior.
- Browser verification covers the three routes at 320/375/414/768/1280 px, disclosure keyboard operation, visible focus, clipping, and horizontal overflow.
- States that require specific API races or backend data are accepted only with exact component-test and source evidence when they cannot be controlled safely in the local browser session.

## Role navigation and resumable onboarding

- Only members receive “ค้นหาเทรนเนอร์”, “การจองของฉัน”, and the header search control. Trainer and administrator navigation exposes only role-owned work.
- Trainer registration creates the account first. Post-auth routing checks `/v1/trainer/me`: `profile: null` continues to `/trainer/apply`; saved `pending`, `rejected`, or `approved` profiles continue to `/trainer`.
- Rejected applications retain the administrator note and may be corrected and resubmitted without creating a second account.

## 2026-08-10 verification

- Live XAMPP onboarding smoke passed `profile: null → pending → rejected with reason → resubmitted pending → approved` without a province field.
- Browser checks at 1280 and 320 confirmed member-only navigation, role-owned trainer/admin navigation, resumable step two, no prohibited province/location facts, no horizontal overflow, and no console errors.
