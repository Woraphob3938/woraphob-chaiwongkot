<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

@RTK.md

# FitConnect — working notes for agents

Read `PRODUCT.md` for what the product must do and `DESIGN.md` for how it must look. This file covers how to work in the repository.

## Layout

- `app/`, `components/`, `lib/` — Next.js front end (TypeScript, Tailwind, `app/globals.css`, tokens in `tokens.css`).
- `backend/` — plain PHP REST API. Routes in `backend/index.php`, handlers in `backend/src/handlers/*.php` (one trait per area, all used by the `Handlers` class in `backend/src/Handlers.php`, which keeps the shared helpers), business rules in `backend/src/*Rules.php` and `PaymentRouting.php`.
- `backend/database/` — `schema.sql` (the only source of the schema; change it together with the live database) and `seed.sql` (demo data).
- `.kilo/worktrees/` — a stale copy of the project left by another tool. Never edit it, and keep it out of test runs.

## Local environment

- XAMPP runs Apache, PHP (`C:\xampp\php\php.exe`) and MariaDB 10.4 (`C:\xampp\mysql\bin\mysql.exe -uroot fitconnect`).
- The front end reads the API from `NEXT_PUBLIC_FITCONNECT_API_URL` (`http://localhost/fitconnect-api`). Health check: `/v1/health`.
- When the UI shows "บริการขัดข้อง (รหัสอ้างอิง …)", search that reference in `C:\xampp\apache\logs\error.log`; the full PHP trace is logged there.
- Demo accounts (password `password`, local only) are listed in `README.md` and created by `seed.sql`.

## Checks

Run these before calling work done, and report failures with their output:

```bash
npm run typecheck
npm run lint
npm test
npm run test:php
npm run test:payment-routing
npm run test:e2e
```

- `npm run test:e2e` runs the Playwright suite in `e2e/` at 1440px against the real stack. Start Apache and MySQL in XAMPP first; it starts `next dev` itself or reuses a running one. The suite is read-only and signs in with the demo accounts. Reports and traces go to `output/`.
- Vitest excludes `.kilo/**`, `e2e/**` and `output/**` in `vitest.config.ts`; keep Playwright specs out of Vitest and vice versa.
- `components/trainer-apply-form.test.tsx` can time out under a full parallel run and passes on its own. Rerun it alone before treating it as a regression.
- For UI work, add or extend a spec in `e2e/` for the surface you changed; `expectNoHorizontalOverflow` in `e2e/helpers.ts` covers the no-sideways-scroll rule.

## Conventions

- Every user-facing string is Thai. Dates and times go through `lib/format.ts` (Buddhist Era, Asia/Bangkok). A component that needs a format `lib/format.ts` lacks (such as calendar day headers) may build its own `Intl.DateTimeFormat`, but it must pin `timeZone: "Asia/Bangkok"` and `th-TH`.
- Copy must name the real actor. Payments settle automatically through Stripe Checkout; nobody checks a slip, and the UI must not ask anyone to (see `PRODUCT.md`).
- Seed and demo records must stay labelled as demonstration data.
- Access rules live in one place per concern: `PaymentRouting::scope()` decides who may see a legacy slip file. Stripe rules (amounts, fees, destination charges, refunds) live in `backend/src/StripePayments.php`, and `Handlers::applyCheckoutSession()` is the only place a Checkout Session changes a booking.
- Stripe runs in test mode locally: `STRIPE_SECRET_KEY` (and `STRIPE_WEBHOOK_SECRET` when a webhook is set up) go in `backend/.env`, never in the front end or in git. Pay with card `4242 4242 4242 4242`. The member's return to `/member?checkout=success` settles the payment through `POST /v1/payments/confirm`, so no public webhook URL is needed on localhost.
