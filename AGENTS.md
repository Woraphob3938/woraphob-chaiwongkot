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
- `backend/` — plain PHP REST API. Routes in `backend/index.php`, handlers in `backend/src/Handlers.php`, business rules in `backend/src/*Rules.php` and `PaymentRouting.php`.
- `backend/database/` — `schema.sql`, `seed.sql` (demo data), `manual-migrations/`. Existing databases are upgraded with the `npm run migrate:*` scripts, never by editing `schema.sql` alone.
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
npx vitest run --exclude ".kilo/**" --exclude "node_modules/**"
npm run test:php
npm run test:payment-routing
```

- Bare `npm test` also collects `.kilo/worktrees/**` and reports about 100 false failures; use the command above.
- `components/trainer-apply-form.test.tsx` can time out under a full parallel run and passes on its own. Rerun it alone before treating it as a regression.
- For UI work, also open the page in the browser at 1440px and 375px and confirm there is no horizontal overflow.

## Conventions

- Every user-facing string is Thai. Dates and times go through `lib/format.ts` (Buddhist Era, Asia/Bangkok). A component that needs a format `lib/format.ts` lacks (such as calendar day headers) may build its own `Intl.DateTimeFormat`, but it must pin `timeZone: "Asia/Bangkok"` and `th-TH`.
- Copy must name the real actor. Slips are checked by the booked trainer, not by an administrator (see `PRODUCT.md`).
- Seed and demo records must stay labelled as demonstration data.
- Access rules live in one place per concern: `PaymentRouting::scope()` decides who may see a slip, `PaymentRouting::decisionScope()` who may decide it. Do not inline a third variant in a handler.
