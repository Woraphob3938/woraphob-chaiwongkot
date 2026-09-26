# Member booking cancellation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member release an unpaid held booking before uploading payment evidence.

**Architecture:** Add a member-owned cancellation endpoint which locks the booking, validates the unpaid state, marks it cancelled, records history, and releases the slot in one database transaction. Expose `canCancel` in the booking payload and render one shadcn confirmation dialog inside the existing member ledger.

**Tech Stack:** PHP 8, MariaDB/MySQL, Next.js 16.3 Client Components, React 19, shadcn/Radix Dialog, Vitest.

## Global constraints

- Members may cancel only `awaiting_payment` bookings with `not_submitted` or `rejected` payment status.
- Cancellation after slip submission or payment approval remains an administrator action.
- Cancellation must release the slot, clear the deadline, store `cancellation_reason`, write one history row, and make chat read-only.
- Do not add refunds, notifications, locations, or trainer acceptance.
- Preserve the existing FitConnect tokens, ledger hierarchy, focus behavior, and 44 px controls.

---

### Task 1: Member cancellation API and UI

**Files:**
- Modify: `backend/src/WorkflowRules.php`
- Modify: `backend/tests/WorkflowRulesTest.php`
- Modify: `backend/src/Handlers.php`
- Modify: `backend/index.php`
- Modify: `scripts/api-payment-chat-review-smoke.ps1`
- Modify: `lib/types.ts`
- Modify: booking fixtures using `BookingActions`
- Modify: `components/role-dashboard.tsx`
- Modify: `components/role-dashboard.test.tsx`
- Modify: `backend/README.md`

**Interfaces:**
- Produces: `WorkflowRules::assertMemberCancellation(string $bookingStatus, string $paymentStatus): void`
- Produces: `POST /v1/bookings/{publicId}/cancel`
- Produces: `BookingActions.canCancel: boolean`

- [x] **Step 1: Write failing rule, API smoke, and component tests**

Test that an unpaid member-owned booking exposes a cancel action, opens a named confirmation dialog, sends the exact POST request, reloads the ledger, and returns focus on dismissal. Test that payment review and confirmed bookings cannot be cancelled by a member.

- [x] **Step 2: Verify RED**

Run:

```powershell
rtk npm run test:php
rtk npm test -- components/role-dashboard.test.tsx
rtk npm run smoke:postbooking
```

Expected: missing workflow method, missing dialog/action, and missing cancellation route.

- [x] **Step 3: Implement the minimal transactional endpoint**

The handler must verify member ownership under `FOR UPDATE`, call the workflow rule, set `status = "cancelled"`, clear `payment_deadline_at`, store the fixed reason `สมาชิกยกเลิกก่อนส่งหลักฐานการชำระเงิน`, set the slot to `available`, and insert the same reason into booking history.

- [x] **Step 4: Implement the existing-ledger UI action**

Use the installed `Dialog` and `Button` primitives. Show the action only when `actions.canCancel` is true. While submitting, disable both controls and use `กำลังยกเลิก…`; on failure show an adjacent `role="alert"`; on success reload the booking list so the action disappears.

- [x] **Step 5: Verify API, UI, responsive layout, and commit**

Run focused RED-to-GREEN tests, the full PHP and frontend suites, lint, typecheck, build, smoke, `git diff --check`, and the Hallmark slop check. Commit only the named files with `feat: let members cancel unpaid bookings`.
