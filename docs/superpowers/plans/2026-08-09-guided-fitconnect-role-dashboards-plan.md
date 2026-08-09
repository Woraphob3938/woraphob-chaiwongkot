# Guided FitConnect Role Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize member, trainer, and admin workspaces around one clear next action, compact recent summaries, and progressive disclosure while preserving every workflow.

**Architecture:** Add pure next-action selectors in `lib/dashboard-actions.ts` and shared presentational primitives in `components/dashboard-primitives.tsx`. Member logic remains in `RoleDashboard`; trainer and admin keep their existing independent fetch/action state in `TrainerWorkbench` and `AdminReviewQueue`, consuming the shared selectors and primitives after data loads.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, CSS tokens from the foundation plan, Vitest, Testing Library, existing PHP REST API.

## Global Constraints

- Execute only after `2026-08-09-guided-fitconnect-foundation-home-plan.md` passes.
- Do not change backend handlers, endpoints, database schema, booking states, or payment semantics.
- Keep all existing accept/reject, availability, payment, chat, completion, and review actions reachable.
- Dashboard order is greeting/status → one next action → 2–3 recent summaries → view-all/details.
- Use real API state only; do not invent counts, revenue, performance, or recommendations.
- Thai-first, WCAG 2.2 AA, keyboard accessible, and responsive at 320/375/414/768/1280.
- Preserve unrelated working-tree changes and stage only files named by the current task.
- Compose new controls from the approved shadcn primitives; keep domain components and copy owned by FitConnect.

---

### Task 1: Define deterministic next-action selectors

**Files:**
- Create: `lib/dashboard-actions.ts`
- Create: `lib/dashboard-actions.test.ts`

**Interfaces:**
- Produces: `DashboardAction = { title: string; description: string; href: string; cta: string; state: "action" | "waiting" | "complete" }`.
- Produces: `getMemberNextAction(bookings: Booking[]): DashboardAction`.
- Produces: `getTrainerNextAction(workspace: TrainerWorkspace | null, bookings: Booking[]): DashboardAction`.
- Produces: `getAdminNextAction(queue: AdminQueue): DashboardAction`.

- [ ] **Step 1: Write failing priority tests**

```ts
const booking = demoBookings[0];
const trainerQueueItem: AdminQueue["trainers"][number] = { id: 7, slug: "trainer-test", displayName: "เทรนเนอร์ทดสอบ", province: "สกลนคร", submittedAt: "2026-08-09T09:00:00+07:00", certificates: [] };
expect(getMemberNextAction([{ ...booking, actions: { ...booking.actions, canPay: true } }])).toMatchObject({ cta: "อัปโหลดสลิป", state: "action" });
expect(getMemberNextAction([{ ...booking, actions: { ...booking.actions, canReview: true } }])).toMatchObject({ cta: "เขียนรีวิว" });
expect(getMemberNextAction([])).toMatchObject({ href: "/trainers", cta: "ค้นหาเทรนเนอร์" });
expect(getTrainerNextAction(null, [])).toMatchObject({ href: "/trainer/apply", cta: "สมัครเป็นเทรนเนอร์" });
expect(getAdminNextAction({ trainers: [trainerQueueItem], payments: [] })).toMatchObject({ href: "/admin#review-queue", state: "action" });
```

Cover the exact priority order: actionable payment → actionable review → pending trainer → payment review → confirmed appointment → search; trainer pending booking → missing slots → current schedule; admin non-empty queue → current queue.

- [ ] **Step 2: Run tests and observe RED**

Run: `rtk npm test -- lib/dashboard-actions.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement selectors as pure functions**

Return copy and URLs only from existing state. Use `booking.id` anchors (`/member#booking-${booking.id}` and `/trainer#booking-${booking.id}`); do not trigger requests inside selectors.

```ts
export function getMemberNextAction(bookings: Booking[]): DashboardAction {
  const payment = bookings.find((booking) => booking.actions.canPay);
  if (payment) return { title: "ส่งหลักฐานการชำระเงิน", description: `คำขอ ${payment.id}`, href: `/member#booking-${payment.id}`, cta: "อัปโหลดสลิป", state: "action" };
  const review = bookings.find((booking) => booking.actions.canReview);
  if (review) return { title: "แบ่งปันผลการฝึก", description: `คำขอ ${review.id}`, href: `/member#booking-${review.id}`, cta: "เขียนรีวิว", state: "action" };
  const pending = bookings.find((booking) => booking.status === "pending_trainer");
  if (pending) return { title: "รอเทรนเนอร์ตอบรับ", description: `คำขอ ${pending.id}`, href: `/member#booking-${pending.id}`, cta: "ดูคำขอ", state: "waiting" };
  const paymentReview = bookings.find((booking) => booking.status === "payment_review");
  if (paymentReview) return { title: "รอผู้ดูแลตรวจหลักฐาน", description: `คำขอ ${paymentReview.id}`, href: `/member#booking-${paymentReview.id}`, cta: "ดูสถานะ", state: "waiting" };
  const confirmed = bookings.find((booking) => booking.status === "confirmed");
  if (confirmed) return { title: "เตรียมตัวสำหรับการฝึก", description: `คำขอ ${confirmed.id}`, href: `/member#booking-${confirmed.id}`, cta: "ดูนัดหมาย", state: "waiting" };
  return { title: "เริ่มค้นหาเทรนเนอร์", description: "เปรียบเทียบคุณสมบัติและตารางว่าง", href: "/trainers", cta: "ค้นหาเทรนเนอร์", state: "complete" };
}
```

- [ ] **Step 4: Run tests and observe GREEN**

Run: `rtk npm test -- lib/dashboard-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit selectors**

```bash
rtk git add lib/dashboard-actions.ts lib/dashboard-actions.test.ts
rtk git commit -m "feat: derive role dashboard next actions"
```

### Task 2: Build shared dashboard primitives

**Files:**
- Create: `components/dashboard-primitives.tsx`
- Create: `components/dashboard-primitives.test.tsx`
- Modify: `app/globals.css:1691-2032,2670-end`

**Interfaces:**
- Consumes: `DashboardAction`.
- Produces: `NextActionCard({ action })` and `DashboardSection({ title, description?, action?: { href: string; label: string }, children })`.

- [ ] **Step 1: Write failing semantic tests**

Render `NextActionCard` and assert one heading, one description, one CTA link, and a non-color `data-state`. Render `DashboardSection` and assert its optional view-all link has an accessible name derived from the section title.

```tsx
render(<NextActionCard action={{ title: "อัปโหลดสลิป", description: "คำขอ BK-TEST", href: "/member#booking-BK-TEST", cta: "ดำเนินการ", state: "action" }} />);
expect(screen.getByRole("heading", { name: "อัปโหลดสลิป" })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "ดำเนินการ" })).toHaveAttribute("href", "/member#booking-BK-TEST");
expect(screen.getByTestId("next-action")).toHaveAttribute("data-state", "action");
```

- [ ] **Step 2: Run tests and observe RED**

Run: `rtk npm test -- components/dashboard-primitives.test.tsx`
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement the primitives**

Use semantic `<section>`, heading IDs from `useId()`, `Link` from `next/link`, and `Button` from `@/components/ui/button`. Do not add animation libraries or nested card wrappers.

```tsx
export function NextActionCard({ action }: { action: DashboardAction }) {
  return <section className="next-action-card" data-state={action.state} data-testid="next-action">
    <div><p>สิ่งที่ต้องทำต่อ</p><h2>{action.title}</h2><p>{action.description}</p></div>
    <Button asChild><Link href={action.href}>{action.cta}</Link></Button>
  </section>;
}
```

- [ ] **Step 4: Run tests and observe GREEN**

Run: `rtk npm test -- components/dashboard-primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit primitives**

```bash
rtk git add components/dashboard-primitives.tsx components/dashboard-primitives.test.tsx app/globals.css
rtk git commit -m "feat: add guided dashboard primitives"
```

### Task 3: Recompose the member dashboard

**Files:**
- Create: `components/role-dashboard.test.tsx`
- Modify: `components/role-dashboard.tsx:1-170`
- Modify: `app/globals.css:1691-2032,2670-end`

**Interfaces:**
- Consumes: `getMemberNextAction`, `NextActionCard`, `DashboardSection`, existing `authenticatedRequest<Booking[]>`, `PaymentPanel`, and `ReviewForm`.
- Produces: member dashboard showing next action first and at most three collapsed booking summaries by default.

- [ ] **Step 1: Write failing member hierarchy tests**

Mock `/v1/bookings` with four bookings. Assert next action appears before the booking heading, only three summaries are visible initially, each summary exposes `ดูรายละเอียด`, and expanding one reveals its payment/review/chat actions without removing factual status, appointment, location, trainer, and price.

```tsx
render(<RoleDashboard role="member" />);
expect(await screen.findByText("สิ่งที่ต้องทำต่อ")).toBeInTheDocument();
expect(screen.getAllByTestId("booking-summary")).toHaveLength(3);
expect(screen.getAllByText("ดูรายละเอียด")).toHaveLength(3);
expect(screen.getByText("ดูการจองทั้งหมด")).toBeInTheDocument();
```

- [ ] **Step 2: Run tests and observe RED**

Run: `rtk npm test -- components/role-dashboard.test.tsx`
Expected: FAIL because all ledgers are expanded and no next-action card exists.

- [ ] **Step 3: Implement member-first composition**

For `role === "member"`, derive the action after load and render:

```tsx
<NextActionCard action={getMemberNextAction(bookings)} />
<DashboardSection title="การจองล่าสุด" action={{ href: "/member#all-bookings", label: "ดูทั้งหมด" }}>
  {bookings.slice(0, 3).map((booking) => <details id={`booking-${booking.id}`} data-testid="booking-summary" key={booking.id}><summary><strong>{booking.trainer.displayName}</strong><span>{formatDateTime(booking.startsAt)}</span><span>ดูรายละเอียด</span></summary><StatusBadge status={booking.status} /><div className="booking-detail-content">{renderBookingFactsAndActions(booking)}</div></details>)}
</DashboardSection>
```

Extract the current factual ledger plus `PaymentPanel`, `ReviewForm`, and chat links into a local `renderBookingFactsAndActions(booking: Booking)` helper in `role-dashboard.tsx`; it returns the existing JSX and performs no requests or state changes.

Keep error/retry and loading semantics. Keep every booking accessible through the `ดูทั้งหมด` disclosure in the same page; do not discard records.

- [ ] **Step 4: Run focused member/payment/review tests**

Run: `rtk npm test -- components/role-dashboard.test.tsx components/payment-panel.test.tsx components/review-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit the member dashboard**

```bash
rtk git add components/role-dashboard.tsx components/role-dashboard.test.tsx app/globals.css
rtk git commit -m "feat: guide members through their next booking action"
```

### Task 4: Recompose the trainer workspace

**Files:**
- Modify: `components/trainer-workbench.tsx:1-340`
- Modify: `components/trainer-workbench.test.tsx:51-end`
- Modify: `app/globals.css:2184-2408,2670-end`

**Interfaces:**
- Consumes: `getTrainerNextAction(workspace, bookings)`, `NextActionCard`, and existing trainer workspace/action requests.
- Produces: approval status → next action → today/upcoming availability summary → pending booking summaries → disclosures for full slot and booking management.

- [ ] **Step 1: Add failing hierarchy regressions**

Add tests that a pending booking makes `ตอบรับคำขอ` the primary next action, a trainer without a profile sees the application action, a rejected application retains its reason, and only the first three booking summaries are open/reachable before `ดูทั้งหมด` is activated.

```tsx
render(<TrainerWorkbench />);
expect(await screen.findByText("ตอบรับคำขอ")).toBeInTheDocument();
expect(screen.getByTestId("next-action")).toHaveAttribute("data-state", "action");
expect(screen.getAllByTestId("trainer-booking-summary").length).toBeLessThanOrEqual(3);
```

- [ ] **Step 2: Run focused trainer tests and observe RED**

Run: `rtk npm test -- components/trainer-workbench.test.tsx`
Expected: new hierarchy assertions FAIL while existing workflow tests remain meaningful.

- [ ] **Step 3: Reorder markup without moving request state**

Keep all fetch, conflict, retry, accept/reject, completion, and slot-creation logic inside `TrainerWorkbench`. Recompose only the returned JSX and use `<details>` for complete slot/booking lists. Do not create duplicate copies of action buttons.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run: `rtk npm test -- components/trainer-workbench.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit the trainer dashboard**

```bash
rtk git add components/trainer-workbench.tsx components/trainer-workbench.test.tsx app/globals.css
rtk git commit -m "feat: focus trainer workspace on pending work"
```

### Task 5: Recompose the admin review center

**Files:**
- Modify: `components/admin-review-queue.tsx:1-392`
- Modify: `components/admin-review-queue.test.tsx:58-end`
- Modify: `app/globals.css:2033-2183,2670-end`

**Interfaces:**
- Consumes: `getAdminNextAction(queue)`, `NextActionCard`, existing `AdminQueue`, and existing review actions.
- Produces: one combined next-action card, two compact queue counts, and separate trainer/payment disclosures with unchanged decision controls.

- [ ] **Step 1: Add failing admin hierarchy tests**

Assert the next-action heading appears before queue counts, counts have factual labels, trainer and payment groups are independently expandable, rejection still requires a note, and existing 409/retry behavior is unchanged.

```tsx
render(<AdminReviewQueue />);
expect(await screen.findByText("สิ่งที่ต้องทำต่อ")).toBeInTheDocument();
expect(screen.getByText("ใบสมัครรอตรวจ")).toBeInTheDocument();
expect(screen.getByText("สลิปรอตรวจ")).toBeInTheDocument();
expect(screen.getByText("ใบสมัครเทรนเนอร์").closest("details")).not.toHaveAttribute("open");
expect(screen.getByText("หลักฐานการชำระเงิน").closest("details")).not.toHaveAttribute("open");
```

- [ ] **Step 2: Run focused admin tests and observe RED**

Run: `rtk npm test -- components/admin-review-queue.test.tsx`
Expected: new structure tests FAIL.

- [ ] **Step 3: Group the live queue progressively**

Keep the current request/race/error state unchanged. Wrap trainer and payment rows in separate `DashboardSection`/`details` groups. Assign `id="review-queue"` to the queue section so the selector URL resolves.

```tsx
<section id="review-queue" className="verification-queue" aria-labelledby="review-queue-title">
  <NextActionCard action={getAdminNextAction(currentQueue)} />
  <DisclosureSection title="ใบสมัครเทรนเนอร์" summary={`${currentQueue.trainers.length} รายการ`}>{trainerRows}</DisclosureSection>
  <DisclosureSection title="หลักฐานการชำระเงิน" summary={`${currentQueue.payments.length} รายการ`}>{paymentRows}</DisclosureSection>
</section>
```

- [ ] **Step 4: Run focused tests and observe GREEN**

Run: `rtk npm test -- components/admin-review-queue.test.tsx`
Expected: PASS, including every existing payment evidence and concurrency test.

- [ ] **Step 5: Commit the admin dashboard**

```bash
rtk git add components/admin-review-queue.tsx components/admin-review-queue.test.tsx app/globals.css
rtk git commit -m "feat: simplify admin review queues"
```

### Task 6: Verify all role dashboards

**Files:**
- Modify: `DESIGN.md:dashboard guidance`
- Create: `.impeccable/surfaces/role-dashboards.md`

**Interfaces:**
- Consumes: completed Tasks 1–5.
- Produces: independently shippable member/trainer/admin dashboards ready for transaction-surface refinement.

- [ ] **Step 1: Document the role hierarchy and next-action rules**

Record exact member/trainer/admin priority orders and the rule that every record remains reachable through disclosure/view-all.

- [ ] **Step 2: Run automated verification**

Run: `rtk npm test` → all tests PASS.
Run: `rtk npm run lint` → exit 0.
Run: `rtk npm run typecheck` → exit 0.
Run: `rtk npm run build` → all routes build.
Run detector once over `components/role-dashboard.tsx components/dashboard-primitives.tsx components/trainer-workbench.tsx components/admin-review-queue.tsx` and resolve all P0/P1 findings.

- [ ] **Step 3: Run role visual and keyboard checks**

For `/member`, `/trainer`, and `/admin`, test loading, empty, error, one item, many items, long Thai copy, and active async action at 320/375/414/768/1280. Verify focus moves to success/error messages and every hidden group is keyboard-expandable.

- [ ] **Step 4: Commit dashboard documentation**

```bash
rtk git add DESIGN.md .impeccable/surfaces/role-dashboards.md
rtk git commit -m "docs: record guided role dashboard behavior"
```
