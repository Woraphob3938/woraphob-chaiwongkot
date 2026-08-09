# Guided FitConnect Foundation and Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dense first-viewport workbench with an overview-first FitConnect homepage and establish the shared visual/navigation foundation for later dashboard work.

**Architecture:** Keep `app/page.tsx` as a server component that fetches the existing trainer and reference APIs, then render a new presentational `HomeOverview`. Keep `TrainerDiscovery` on `/trainers`; no API or database contract changes. `SiteHeader` continues to own session state and passes the authenticated user to a focused mobile role navigation component.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, CSS tokens, Lucide React, Vitest, Testing Library.

## Global Constraints

- Preserve every existing business capability and the PHP/MySQL API contracts.
- Add no AI recommendation, GPS tracking, video calling, subscription, automatic payment gateway, gamification, social feed, or database schema.
- Training-goal links are filters over existing `TrainingType.slug` values, not a recommendation engine.
- Thai-first copy; manual certificate and slip review must remain explicit.
- One primary action per section; accent lime is reserved for selection, focus, and primary actions.
- WCAG 2.2 AA; status never relies on color alone; touch targets are at least 44px.
- Verify 320, 375, 414, 768, and 1280×800 widths with no horizontal page overflow.
- Preserve unrelated working-tree changes and never stage `graphify-out/` or `.superpowers/brainstorm/`.

---

### Task 1: Add the friendly-fitness token layer

**Files:**
- Modify: `tokens.css:1-96`
- Modify: `app/globals.css:1-259`
- Create: `components/ui-system.test.tsx`

**Interfaces:**
- Consumes: existing `--color-*`, `--font-*`, `--space-*`, and `--radius-*` tokens.
- Produces: `--color-canvas`, `--color-surface`, `--color-surface-muted`, `--radius-card`, `--radius-panel`, and `--shadow-surface` aliases used by all three redesign plans.

- [ ] **Step 1: Write the failing token contract test**

```tsx
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Guided FitConnect visual tokens", () => {
  const css = readFileSync("tokens.css", "utf8");
  it.each(["--color-canvas", "--color-surface", "--color-surface-muted", "--radius-card", "--radius-panel", "--shadow-surface"])(
    "defines %s",
    (token) => expect(css).toContain(token),
  );
});
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `rtk npm test -- components/ui-system.test.tsx`
Expected: FAIL because the semantic aliases do not exist.

- [ ] **Step 3: Add semantic aliases and soften the base hierarchy**

Add aliases inside `:root` and update base card/surface primitives to consume them:

```css
--color-canvas: var(--color-paper-2);
--color-surface: var(--color-paper);
--color-surface-muted: var(--color-paper-3);
--radius-card: var(--radius-lg);
--radius-panel: 1.25rem;
--shadow-surface: 0 1px 2px var(--color-shadow);
```

Keep Chakra Petch for brand/high-priority headings, but make ordinary `h2`/`h3` and card copy use Bai Jamjuree. Do not change status colors or focus tokens.

- [ ] **Step 4: Run the focused test and observe GREEN**

Run: `rtk npm test -- components/ui-system.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit the foundation**

```bash
rtk git add tokens.css app/globals.css components/ui-system.test.tsx
rtk git commit -m "style: add guided FitConnect UI tokens"
```

### Task 2: Build the reusable trainer preview card

**Files:**
- Create: `components/trainer-preview-card.tsx`
- Create: `components/trainer-preview-card.test.tsx`
- Modify: `app/globals.css:560-1222`

**Interfaces:**
- Consumes: `trainer: Trainer` and optional `priority?: boolean`.
- Produces: `TrainerPreviewCard({ trainer, priority })` linking to `/trainers/${trainer.slug}` with only identity, primary specialty, province, verified status, and honest price.

- [ ] **Step 1: Write the failing semantic card test**

```tsx
render(<TrainerPreviewCard trainer={trainers[0]} />);
expect(screen.getByRole("heading", { name: trainers[0].displayName })).toBeInTheDocument();
expect(screen.getByText(trainers[0].province.nameTh)).toBeInTheDocument();
expect(screen.getByText(/ตรวจคุณสมบัติแล้ว/)).toBeInTheDocument();
expect(screen.getByRole("link", { name: /ดูโปรไฟล์/ })).toHaveAttribute("href", `/trainers/${trainers[0].slug}`);
expect(screen.queryByText(trainers[0].bio)).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `rtk npm test -- components/trainer-preview-card.test.tsx`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the compact card**

Use `next/image`, `BadgeCheck`, `MapPin`, `formatMoney`, and the existing demonstration-image wording. When `priceFrom` is absent, render `สอบถามราคา` instead of an invented amount. Show `trainer.trainingTypes[0]?.nameTh ?? "การฝึกส่วนบุคคล"`; do not render certificate lists or schedules here.

```tsx
<article className="trainer-preview-card" data-testid="trainer-preview">
  {trainer.image ? <Image src={trainer.image} alt={`ภาพสาธิตของ${trainer.displayName}`} width={320} height={240} priority={priority} /> : <span aria-hidden="true">{initials(trainer.displayName)}</span>}
  <h3>{trainer.displayName}</h3>
  <p>{trainer.trainingTypes[0]?.nameTh ?? "การฝึกส่วนบุคคล"}</p>
  <span><MapPin aria-hidden="true" />{trainer.province.nameTh}</span>
  {trainer.verification === "verified" && <span><BadgeCheck aria-hidden="true" />ตรวจคุณสมบัติแล้ว</span>}
  <strong>{trainer.priceFrom === undefined ? "สอบถามราคา" : `เริ่มต้น ${formatMoney(trainer.priceFrom)} / ครั้ง`}</strong>
  <Link href={`/trainers/${trainer.slug}`}>ดูโปรไฟล์</Link>
</article>
```

- [ ] **Step 4: Run the focused test and observe GREEN**

Run: `rtk npm test -- components/trainer-preview-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit the card**

```bash
rtk git add components/trainer-preview-card.tsx components/trainer-preview-card.test.tsx app/globals.css
rtk git commit -m "feat: add compact trainer preview cards"
```

### Task 3: Replace the homepage workbench with Guided FitConnect

**Files:**
- Create: `components/home-overview.tsx`
- Create: `components/home-overview.test.tsx`
- Modify: `app/page.tsx:1-17`
- Modify: `app/globals.css:560-1222`

**Interfaces:**
- Consumes: `{ trainers: Trainer[]; trainingTypes: TrainingType[]; isDemo: boolean }`.
- Produces: `HomeOverview` with hero, existing training-type shortcuts, at most four trainer previews, factual process explanation, trust explanation, and final `/trainers` CTA.

- [ ] **Step 1: Write the failing homepage behavior test**

```tsx
render(<HomeOverview trainers={trainers} trainingTypes={trainingTypes} isDemo />);
expect(screen.getByRole("heading", { level: 1, name: /เริ่มต้นสุขภาพที่ดี/ })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "ค้นหาเทรนเนอร์" })).toHaveAttribute("href", "/trainers");
expect(screen.getAllByTestId("trainer-preview")).toHaveLength(Math.min(4, trainers.length));
expect(screen.getByRole("link", { name: trainingTypes[0].nameTh })).toHaveAttribute("href", `/trainers?type=${trainingTypes[0].slug}`);
expect(screen.getByText(/ผู้ดูแลตรวจหลักฐานด้วยตนเอง/)).toBeInTheDocument();
expect(screen.queryByRole("heading", { name: "กรองเทรนเนอร์" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `rtk npm test -- components/home-overview.test.tsx`
Expected: FAIL because `HomeOverview` does not exist.

- [ ] **Step 3: Implement the six-section overview**

Render sections in this exact order: hero, training types, 3–4 trainer previews, five factual journey steps, manual-verification trust copy, final CTA. Use only data supplied by `getTrainers()` and `getReferenceData()`; if arrays are empty, render useful empty states and keep the `/trainers` CTA.

```tsx
return <div className="home-overview">
  <section className="home-hero"><h1>เริ่มต้นสุขภาพที่ดีกับคนที่เหมาะกับคุณ</h1><p>ดูภาพรวมบริการก่อนเปรียบเทียบเทรนเนอร์ที่ผ่านการตรวจสอบ</p><Link className="button button--accent" href="/trainers">ค้นหาเทรนเนอร์</Link></section>
  <section aria-labelledby="training-goals-title">{trainingTypes.map((type) => <Link key={type.id} href={`/trainers?type=${type.slug}`}>{type.nameTh}</Link>)}</section>
  <section aria-labelledby="featured-trainers-title">{trainers.slice(0, 4).map((trainer, index) => <TrainerPreviewCard key={trainer.id} trainer={trainer} priority={index === 0} />)}</section>
  <section aria-labelledby="journey-title"><ol>{journeySteps.map((step) => <li key={step}>{step}</li>)}</ol></section>
  <section aria-labelledby="trust-title"><p>ผู้ดูแลตรวจใบรับรองและหลักฐานการโอนด้วยตนเอง</p></section>
  <Link className="button button--accent" href="/trainers">ดูเทรนเนอร์ทั้งหมด</Link>
</div>;
```

- [ ] **Step 4: Wire the server page without changing data access**

Replace the current `TrainerDiscovery` element in `app/page.tsx` with:

```tsx
<HomeOverview
  trainers={trainerResult.data}
  trainingTypes={reference.trainingTypes}
  isDemo={trainerResult.source === "demo" || reference.source === "demo" || trainerResult.data.some((trainer) => trainer.demo)}
/>
```

Leave `app/trainers/page.tsx` and `TrainerDiscovery` as the detailed discovery route.

- [ ] **Step 5: Run focused tests and build**

Run: `rtk npm test -- components/home-overview.test.tsx components/trainer-preview-card.test.tsx`
Expected: PASS.
Run: `rtk npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit the homepage**

```bash
rtk git add app/page.tsx components/home-overview.tsx components/home-overview.test.tsx app/globals.css
rtk git commit -m "feat: introduce overview-first FitConnect homepage"
```

### Task 4: Simplify global navigation and add role-aware mobile navigation

**Files:**
- Create: `components/mobile-role-nav.tsx`
- Create: `components/site-header.test.tsx`
- Modify: `components/site-header.tsx:1-250`
- Modify: `app/globals.css:260-559,2670-end`

**Interfaces:**
- Consumes: `user: AuthenticatedUser | null` and current path from `usePathname()`.
- Produces: `MobileRoleNav({ user })`; four or fewer destinations with text labels and `aria-current="page"`.

- [ ] **Step 1: Write failing navigation tests**

Test guest navigation separately from each authenticated role. Assert that mobile destinations never exceed four, member uses `/member`, trainer uses `/trainer`, admin uses `/admin`, shared chat is `/chat`, and account remains available through the existing profile control. Mock `usePathname()` and the session request; do not test CSS implementation details.

```tsx
render(<MobileRoleNav user={{ id: 1, email: "member@example.test", displayName: "สมาชิกทดสอบ", role: "member", status: "active" }} />);
expect(screen.getAllByRole("link")).toHaveLength(3);
expect(screen.getByRole("link", { name: "การจอง" })).toHaveAttribute("href", "/member");
expect(screen.getByRole("link", { name: "แชต" })).toHaveAttribute("href", "/chat");
expect(screen.queryByRole("link", { name: "สมัครเป็นเทรนเนอร์" })).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the focused tests and observe RED**

Run: `rtk npm test -- components/site-header.test.tsx`
Expected: FAIL because `MobileRoleNav` and the simplified structure are absent.

- [ ] **Step 3: Implement role destination maps**

```tsx
const mobileItemsByRole: Record<UserRole, Array<{ href: string; label: string }>> = {
  member: [{ href: "/", label: "หน้าแรก" }, { href: "/member", label: "การจอง" }, { href: "/chat", label: "แชต" }],
  trainer: [{ href: "/", label: "หน้าแรก" }, { href: "/trainer", label: "งานของฉัน" }, { href: "/chat", label: "แชต" }],
  admin: [{ href: "/", label: "หน้าแรก" }, { href: "/admin", label: "คิวตรวจ" }, { href: "/chat", label: "แชต" }],
};
```

Guest mobile navigation uses หน้าแรก, ค้นหาเทรนเนอร์, เข้าสู่ระบบ, สมัครสมาชิก. Keep search dialog, session synchronization, profile name/avatar, sign-out, and keyboard behavior unchanged.

- [ ] **Step 4: Run navigation tests and observe GREEN**

Run: `rtk npm test -- components/site-header.test.tsx`
Expected: PASS.

- [ ] **Step 5: Verify responsive navigation**

At 320/375/414px confirm the bottom navigation does not cover form CTAs, labels remain one line, and the page has bottom padding equal to the nav height. At 768 and 1280px confirm desktop navigation remains visible and bottom navigation is absent.

- [ ] **Step 6: Commit navigation**

```bash
rtk git add components/mobile-role-nav.tsx components/site-header.tsx components/site-header.test.tsx app/globals.css
rtk git commit -m "feat: simplify role-aware navigation"
```

### Task 5: Verify the independently shippable foundation

**Files:**
- Modify: `DESIGN.md:1-end`
- Modify: `.impeccable/surfaces/app-page-tsx.md:1-end`

**Interfaces:**
- Consumes: completed Tasks 1–4.
- Produces: documented Guided FitConnect homepage/navigation system ready for the dashboard plan.

- [ ] **Step 1: Update design documentation**

Replace the obsolete “first viewport is a three-zone discovery bench” direction with the approved overview-first flow. Record that the three-zone workbench belongs to `/trainers`, while `/` is Guided FitConnect. Keep the product thesis and honest-operation rules.

- [ ] **Step 2: Run the complete frontend gate**

Run: `rtk npm test` → all tests PASS.
Run: `rtk npm run lint` → exit 0.
Run: `rtk npm run typecheck` → exit 0.
Run: `rtk npm run build` → all routes build successfully.
Run: `rtk node C:\Users\HP\.agents\skills\impeccable\scripts\detect.mjs --json app/page.tsx components/home-overview.tsx components/trainer-preview-card.tsx components/site-header.tsx components/mobile-role-nav.tsx` → review all findings; no unresolved P0/P1 issues.

- [ ] **Step 3: Run the visual matrix once**

Capture `/` and `/trainers` at 1280×800, 768, 414, 375, and 320. Check Thai wrapping, focus order, 200% zoom, reduced motion, empty/demo states, and horizontal overflow. Fix all observed defects in one batch, then perform one confirmation pass.

- [ ] **Step 4: Commit the verified foundation**

```bash
rtk git add DESIGN.md .impeccable/surfaces/app-page-tsx.md
rtk git commit -m "docs: record guided FitConnect homepage system"
```
