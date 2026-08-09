# Guided FitConnect Transaction Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Guided FitConnect hierarchy to trainer discovery, profile, booking, payment, review, and chat surfaces, then verify the complete existing workflow end to end.

**Architecture:** Preserve all current component ownership and API calls. Add one reusable disclosure primitive, then recompose existing JSX and CSS so summaries appear before full evidence/forms. No backend or database edits are expected; end-to-end smoke and database audit are regression gates only.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, existing PHP/MySQL/XAMPP backend, CSS tokens, Vitest, Testing Library, PowerShell smoke/audit scripts.

## Global Constraints

- Execute only after the foundation/home and role-dashboard plans pass.
- Preserve all routes, request payloads, server states, authorization, uploaded-file rules, and database writes.
- Do not describe manual document or payment review as automatic.
- Keep all trainer evidence, booking facts, payment evidence, messages, and reviews reachable.
- Do not add a new library or backend endpoint.
- One primary action per context; details are progressive, never deleted.
- Verify WCAG 2.2 AA and widths 320/375/414/768/1280.
- Preserve unrelated working-tree changes and never stage generated graph/brainstorm artifacts.

---

### Task 1: Add a reusable accessible disclosure section

**Files:**
- Create: `components/disclosure-section.tsx`
- Create: `components/disclosure-section.test.tsx`
- Modify: `app/globals.css:1391-1690,2670-end`

**Interfaces:**
- Produces: `DisclosureSection({ title, summary?, defaultOpen?, children, className? })` using native `<details>` and `<summary>`.

- [ ] **Step 1: Write failing disclosure tests**

Assert the native details element is closed by default, `defaultOpen` works, summary has a visible text label, children remain mounted in the DOM, and no click-only div is used.

```tsx
const { container } = render(<DisclosureSection title="ใบรับรอง"><p>หลักฐาน</p></DisclosureSection>);
expect(screen.getByText("ใบรับรอง").closest("details")).not.toHaveAttribute("open");
expect(screen.getByText("หลักฐาน")).toBeInTheDocument();
expect(container.querySelector("summary")).toHaveTextContent("ใบรับรอง");
```

- [ ] **Step 2: Run tests and observe RED**

Run: `rtk npm test -- components/disclosure-section.test.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the primitive**

```tsx
export function DisclosureSection({ title, summary, defaultOpen = false, children, className = "" }: Props) {
  return <details className={`disclosure-section ${className}`} defaultOpen={defaultOpen}>
    <summary><span><strong>{title}</strong>{summary && <small>{summary}</small>}</span><ChevronDown aria-hidden="true" /></summary>
    <div className="disclosure-section__content">{children}</div>
  </details>;
}
```

Use `prefers-reduced-motion`; never animate height.

- [ ] **Step 4: Run tests and observe GREEN**

Run: `rtk npm test -- components/disclosure-section.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit the primitive**

```bash
rtk git add components/disclosure-section.tsx components/disclosure-section.test.tsx app/globals.css
rtk git commit -m "feat: add accessible guided disclosures"
```

### Task 2: Distill detailed trainer discovery

**Files:**
- Create: `components/trainer-discovery.test.tsx`
- Modify: `components/trainer-discovery.tsx:1-220`
- Modify: `components/credential-card.tsx:1-end`
- Modify: `components/availability-panel.tsx:1-end`
- Modify: `app/globals.css:560-1222,2670-end`

**Interfaces:**
- Consumes: existing `Props`, filters, selected trainer, credential data, and availability selection.
- Produces: overview-first `/trainers`: search + compact filter disclosure → result cards → selected-trainer summary → evidence disclosure → schedule.

- [ ] **Step 1: Write failing discovery hierarchy tests**

Assert search is immediately visible, detailed filters are closed on narrow mode, result count and trainer choices remain accessible, credential evidence is summarized before expansion, selecting a trainer clears the previous slot, and BookingStrip still receives the selected trainer/slot.

```tsx
render(<TrainerDiscovery initialTrainers={trainers} provinces={provinces} trainingTypes={trainingTypes} isDemo={false} />);
expect(screen.getByRole("searchbox", { name: "ชื่อหรือความเชี่ยวชาญ" })).toBeVisible();
expect(screen.getByText("ตัวกรองเพิ่มเติม").closest("details")).not.toHaveAttribute("open");
expect(screen.getByRole("heading", { name: trainers[0].displayName })).toBeInTheDocument();
expect(screen.getByText("หลักฐานและใบรับรอง").closest("details")).not.toHaveAttribute("open");
```

- [ ] **Step 2: Run tests and observe RED**

Run: `rtk npm test -- components/trainer-discovery.test.tsx`
Expected: new hierarchy tests FAIL.

- [ ] **Step 3: Recompose discovery without changing filter logic**

Move existing fields into `DisclosureSection title="ตัวกรองเพิ่มเติม"`; keep the query field outside. Replace the dense three-zone default with a two-stage composition while preserving `filtered`, `selectedTrainer`, `selectTrainer`, and `selectedSlot` state exactly.

```tsx
<div className="discovery-guided-layout">
  <section className="discovery-search"><label htmlFor="trainer-query">ชื่อหรือความเชี่ยวชาญ</label><input id="trainer-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /><DisclosureSection title="ตัวกรองเพิ่มเติม"><select value={province} onChange={(event) => setProvince(event.target.value)}><option value="">ทุกจังหวัด</option>{provinces.map((item) => <option key={item.id} value={item.nameTh}>{item.nameTh}</option>)}</select><select value={trainingType} onChange={(event) => setTrainingType(event.target.value)}><option value="">ทุกประเภท</option>{trainingTypes.map((item) => <option key={item.id} value={item.slug}>{item.nameTh}</option>)}</select><label><input type="checkbox" checked={verifiedOnly} onChange={(event) => setVerifiedOnly(event.target.checked)} />แสดงเฉพาะโปรไฟล์ที่ตรวจแล้ว</label></DisclosureSection></section>
  <section className="trainer-results" aria-label="ผลการค้นหา">{filtered.map((trainer) => <button type="button" key={trainer.id} onClick={() => selectTrainer(trainer)}>{trainer.displayName}</button>)}</section>
  <section className="selected-trainer-summary"><h2>{selectedTrainer?.displayName}</h2>{selectedTrainer && <DisclosureSection title="หลักฐานและใบรับรอง"><CredentialCard trainer={selectedTrainer} /></DisclosureSection>}{selectedTrainer && <AvailabilityPanel trainer={selectedTrainer} selectedSlot={selectedSlot} onSelectSlot={setSelectedSlot} />}</section>
</div>
```

- [ ] **Step 4: Run discovery and booking regressions**

Run: `rtk npm test -- components/trainer-discovery.test.tsx components/booking-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit discovery**

```bash
rtk git add components/trainer-discovery.tsx components/trainer-discovery.test.tsx components/credential-card.tsx components/availability-panel.tsx app/globals.css
rtk git commit -m "feat: guide detailed trainer discovery"
```

### Task 3: Recompose trainer profile and booking form

**Files:**
- Create: `components/trainer-detail.test.tsx`
- Modify: `components/trainer-detail.tsx:1-end`
- Modify: `components/booking-form.tsx:98-142`
- Modify: `components/booking-form.test.tsx:35-end`
- Modify: `app/globals.css:1309-1690,2670-end`

**Interfaces:**
- Consumes: existing `TrainerDetail` props and `BookingForm` request behavior.
- Produces: trainer identity/price/primary CTA first; evidence and full schedule in disclosures; booking summary before the note field and submit action.

- [ ] **Step 1: Add failing profile and booking hierarchy tests**

Assert profile heading, verification, price, and booking action appear before certificate evidence; certificate and full schedule groups are expandable. In booking tests assert summary precedes the optional note, one submit CTA exists, and stale-slot/API-error behavior preserves the form.

```tsx
render(<TrainerDetail trainer={trainers[0]} isDemo={false} />);
expect(screen.getByRole("heading", { name: trainers[0].displayName })).toBeInTheDocument();
expect(screen.getByText("ใบรับรองและคุณสมบัติ").closest("details")).not.toHaveAttribute("open");
expect(screen.getByText("ตารางว่างทั้งหมด").closest("details")).not.toHaveAttribute("open");
expect(screen.getAllByRole("button", { name: "เลือกเวลา" })).toHaveLength(1);
```

- [ ] **Step 2: Run focused tests and observe RED**

Run: `rtk npm test -- components/trainer-detail.test.tsx components/booking-form.test.tsx`
Expected: new hierarchy assertions FAIL.

- [ ] **Step 3: Implement the approved order**

Keep profile editing controls visible only under their existing authorization condition. Wrap `CredentialCard` and the complete `AvailabilityPanel` in named disclosures; do not duplicate certificates or slots. Keep `BookingForm` request body unchanged.

```tsx
<section className="trainer-profile-guided">
  <div className="trainer-profile-summary"><h1>{trainer.displayName}</h1><p>{trainer.headline}</p><strong>เริ่มต้น {formatMoney(currentPrice)}</strong></div>
  <DisclosureSection title="ใบรับรองและคุณสมบัติ"><CredentialCard trainer={trainer} /></DisclosureSection>
  <DisclosureSection title="ตารางว่างทั้งหมด"><AvailabilityPanel trainer={trainer} selectedSlot={selectedSlot} onSelectSlot={setSelectedSlot} /></DisclosureSection>
</section>
<BookingStrip trainer={{ ...trainer, priceFrom: currentPrice }} slot={slot} />
```

- [ ] **Step 4: Run focused tests and observe GREEN**

Run: `rtk npm test -- components/trainer-detail.test.tsx components/booking-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit profile and booking**

```bash
rtk git add components/trainer-detail.tsx components/trainer-detail.test.tsx components/booking-form.tsx components/booking-form.test.tsx app/globals.css
rtk git commit -m "feat: simplify trainer profile and booking flow"
```

### Task 4: Distill payment and review forms

**Files:**
- Modify: `components/payment-panel.tsx:150-207`
- Modify: `components/payment-panel.test.tsx:49-end`
- Modify: `components/review-form.tsx:112-179`
- Modify: `components/review-form.test.tsx:40-end`
- Modify: `app/globals.css:1691-2032,2670-end`

**Interfaces:**
- Consumes: existing booking actions, file constraints, upload and review callbacks.
- Produces: compact factual status summary followed by one open form only when `canPay` or `canReview` is true; historical evidence remains in a disclosure.

- [ ] **Step 1: Add failing progressive-disclosure tests**

Assert the current status and admin note are visible without expansion; detailed payment history is disclosed; upload/review form is open when action is allowed; long filenames, validation, retry, and disabled rules remain unchanged.

```tsx
const payableBooking = { ...demoBookings[0], actions: { ...demoBookings[0].actions, canPay: true } };
const onUpdated = vi.fn();
render(<PaymentPanel booking={payableBooking} onUpdated={onUpdated} />);
expect(screen.getByText("สถานะหลักฐาน")).toBeVisible();
expect(screen.getByRole("button", { name: /ส่งหลักฐาน/ })).toBeEnabled();
expect(screen.getByText("รายละเอียดหลักฐานเดิม").closest("details")).not.toHaveAttribute("open");
```

- [ ] **Step 2: Run focused tests and observe RED**

Run: `rtk npm test -- components/payment-panel.test.tsx components/review-form.test.tsx`
Expected: new structure assertions FAIL.

- [ ] **Step 3: Recompose markup only**

Do not alter `FormData`, endpoint paths, 10MB/type validation, 2,000-character review limit, busy guards, or retry sequencing. Use the shared disclosure for evidence/history and keep the actionable form visually primary.

```tsx
<section className="guided-transaction-panel">
  <div className="transaction-status-summary"><span>สถานะหลักฐาน</span><strong>{paymentStatusCopy[booking.paymentStatus]}</strong>{booking.payment?.reviewNote && <p>{booking.payment.reviewNote}</p>}</div>
  {booking.actions.canPay && <form className="transaction-primary-action" onSubmit={submit}><input id={slipId} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => selectSlip(event.target.files?.[0] ?? null)} /><button className="button button--accent" type="submit" disabled={busy}>ส่งสลิปให้ตรวจ</button></form>}
  <DisclosureSection title="รายละเอียดหลักฐานเดิม"><div className="ledger-row"><span>ยอดที่เคยส่ง</span><strong>{formatAmount(booking.payment?.amount ?? null)}</strong></div></DisclosureSection>
</section>
```

Apply the same shape to `ReviewForm`: published review/status summary first, the existing rating/comment form only when `booking.actions.canReview`, and no invented historical values.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run: `rtk npm test -- components/payment-panel.test.tsx components/review-form.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit payment/review UI**

```bash
rtk git add components/payment-panel.tsx components/payment-panel.test.tsx components/review-form.tsx components/review-form.test.tsx app/globals.css
rtk git commit -m "feat: clarify payment and review actions"
```

### Task 5: Simplify the chat reading hierarchy

**Files:**
- Modify: `components/chat-workbench.tsx:384-end`
- Modify: `components/chat-workbench.test.tsx:86-end`
- Modify: `app/globals.css:2409-2611,2670-end`

**Interfaces:**
- Consumes: existing room selection, polling, send/retry, attachment, cancellation, and booking-facts disclosure behavior.
- Produces: contacts → active conversation → composer as primary reading order; booking facts stay a secondary disclosure outside wide desktop.

- [ ] **Step 1: Add failing hierarchy regressions**

Assert the active conversation heading is announced before booking facts on narrow mode, composer remains after messages, facts are closed below 58rem and open on desktop, and room selection/polling/send behavior remains unchanged.

```tsx
render(<ChatWorkbench initialBookingId="BK-TEST" />);
const heading = await screen.findByRole("heading", { name: /สนทนา/ });
const facts = screen.getByText("รายละเอียดนัดหมาย").closest("details");
expect(heading.compareDocumentPosition(facts as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(facts).not.toHaveAttribute("open");
expect(screen.getByRole("button", { name: "ส่งข้อความ" })).toBeInTheDocument();
```

- [ ] **Step 2: Run chat tests and observe RED**

Run: `rtk npm test -- components/chat-workbench.test.tsx`
Expected: new hierarchy assertions FAIL while behavioral tests identify any regressions.

- [ ] **Step 3: Recompose the live selectors**

Keep all async state and timers unchanged. Remove inline layout styles in favor of semantic classes, give long booking/file values wrapping hooks, and ensure the composer feedback region remains adjacent to the form.

```tsx
<div className="chat-guided-layout">
  <aside className="chat-room-list">{rooms.map((booking) => <button type="button" key={booking.id} onClick={() => setSelectedBookingId(booking.id)}>{booking.trainer.displayName}</button>)}</aside>
  <section className="chat-conversation"><h2>{selectedBooking.trainer.displayName}</h2><div className="messages">{messages.map((message) => <article key={message.id}>{message.message}</article>)}</div>{composerError && <p role="alert">{composerError}</p>}{selectedBooking.actions.canSendChat && <form onSubmit={sendMessage}><textarea value={messageText} onChange={(event) => setMessageText(event.target.value)} /><button type="submit" disabled={sending}>ส่งข้อความ</button></form>}</section>
  <details className="chat-booking-facts" open={factsOpen} onToggle={(event) => setFactsOpen(event.currentTarget.open)}><summary>รายละเอียดนัดหมาย</summary><div className="ledger-row"><span>รหัสคำขอ</span><strong>{selectedBooking.id}</strong></div></details>
</div>
```

- [ ] **Step 4: Run chat tests and observe GREEN**

Run: `rtk npm test -- components/chat-workbench.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit chat hierarchy**

```bash
rtk git add components/chat-workbench.tsx components/chat-workbench.test.tsx app/globals.css
rtk git commit -m "feat: focus the booking chat experience"
```

### Task 6: Run complete frontend, PHP, and database regression gates

**Files:**
- Modify: `DESIGN.md:transaction and responsive guidance`
- Create: `.impeccable/surfaces/transaction-surfaces.md`

**Interfaces:**
- Consumes: all three Guided FitConnect plans.
- Produces: verified UI redesign with unchanged persisted business workflow.

- [ ] **Step 1: Document the final disclosure and responsive rules**

Record which information is summary-visible and which is disclosed on search, profile, booking, payment, review, and chat surfaces. Record the one-primary-action rule and manual-review copy.

- [ ] **Step 2: Run frontend and mechanical design gates**

Run: `rtk npm test` → all tests PASS.
Run: `rtk npm run lint` → exit 0.
Run: `rtk npm run typecheck` → exit 0.
Run: `rtk npm run build` → all routes build.
Run detector once over all changed TSX targets and resolve every P0/P1 finding.

- [ ] **Step 3: Run the live workflow regression**

Run: `rtk npm run xampp:connect` → API health succeeds.
Run: `rtk npm run test:php` → all PHP workflow tests PASS.
Run: `rtk npm run smoke:postbooking` → trainer acceptance, payment upload/review, chat, completion, and review succeed using a new booking ID; the smoke script invokes `audit-booking.ps1` with that exact runtime ID and booking/history/payments/rooms/messages/reviews all report PASS.

- [ ] **Step 4: Run the final visual/accessibility matrix once**

Inspect `/`, `/trainers`, one trainer profile, `/booking`, `/member`, `/trainer`, `/admin`, and `/chat` at 1280×800, 768, 414, 375, and 320. Include long Thai content, no data, loading, error, disabled, success, 200% zoom, keyboard-only, and reduced-motion. Fix findings in one batch and confirm once.

- [ ] **Step 5: Commit final documentation**

```bash
rtk git add DESIGN.md .impeccable/surfaces/transaction-surfaces.md
rtk git commit -m "docs: finalize guided FitConnect UI system"
```
