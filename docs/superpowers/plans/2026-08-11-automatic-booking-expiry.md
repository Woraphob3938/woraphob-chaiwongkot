# Automatic booking expiry implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expire unpaid bookings and release their held availability within one minute of the ten-minute deadline without requiring a web request.

**Architecture:** Reuse the existing transactional expiry code in `Handlers` through one public scheduler entry point. A PHP CLI command runs that entry point, and a Windows Scheduled Task invokes the command every minute while XAMPP MySQL is available.

**Tech Stack:** PHP 8, MariaDB/MySQL, PowerShell ScheduledTasks, XAMPP, existing smoke-test harness.

## Global constraints

- The payment deadline remains exactly ten minutes.
- Expiry must remain idempotent and must write one booking history row.
- The held availability slot must return to `available`.
- Do not add a queue service, framework, or dependency.
- Preserve the existing request-triggered cleanup as a safety net.

---

### Task 1: Scheduled expiry command

**Files:**
- Create: `backend/scripts/expire-bookings.php`
- Create: `scripts/install-booking-expiry-task.ps1`
- Create: `scripts/install-booking-expiry-task.test.ps1`
- Modify: `backend/src/Handlers.php:974`
- Modify: `scripts/api-payment-chat-review-smoke.ps1:185`
- Modify: `package.json`
- Modify: `backend/README.md`

**Interfaces:**
- Consumes: `Handlers::expireAwaitingPaymentsInTransaction(PDO $pdo, ?int $slotId = null): array`
- Produces: `Handlers::expireAwaitingPaymentsForScheduler(): int`
- Produces: `php backend/scripts/expire-bookings.php` with JSON output `{ "expired": number, "checkedAt": string }`
- Produces: Windows Scheduled Task `FitConnect-ExpireBookings` running once per minute

- [x] **Step 1: Write the failing smoke and installer tests**

Change the existing expiry scenario so it executes the PHP command and checks the database before any follow-up API request. Add a PowerShell contract test which invokes the installer with `-WhatIf` and requires a one-minute task definition.

- [x] **Step 2: Run the tests to verify RED**

Run:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-booking-expiry-task.test.ps1
rtk npm run smoke:postbooking
```

Expected: failure because the installer and PHP command do not exist.

- [x] **Step 3: Add the scheduler entry point and CLI command**

Add this public entry point while keeping the existing transaction as the single source of expiry behavior:

```php
public function expireAwaitingPaymentsForScheduler(): int
{
    return count($this->expireAwaitingPayments());
}
```

Change the internal wrapper to return the transaction result:

```php
private function expireAwaitingPayments(?int $slotId = null): array
{
    return $this->database->transaction(
        fn(PDO $pdo): array => $this->expireAwaitingPaymentsInTransaction($pdo, $slotId)
    );
}
```

The CLI command must load the existing database configuration, run the public entry point, emit JSON, and return a non-zero exit code on failure.

- [x] **Step 4: Add the minimal Windows Scheduled Task installer**

Use the built-in `ScheduledTasks` module. Resolve the absolute PHP and command paths, create a one-minute repetition trigger, use `IgnoreNew` for overlapping runs, and support `-WhatIf` without registering a task.

- [x] **Step 5: Run focused GREEN checks**

Run:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-booking-expiry-task.test.ps1
rtk npm run test:php
rtk npm run smoke:postbooking
```

Expected: installer contract passes, all PHP workflow tests pass, and the smoke test proves command-driven expiry, history insertion, slot release, and rebooking.

- [x] **Step 6: Install and inspect the task**

Run:

```powershell
rtk npm run booking-expiry:install
rtk powershell -NoProfile -Command "Get-ScheduledTask -TaskName FitConnect-ExpireBookings"
```

Expected: the task is ready and configured with a one-minute trigger.

- [x] **Step 7: Verify and commit**

Run `rtk git diff --check`, inspect the staged file list, and commit only the task files with message `feat: expire unpaid bookings automatically`.
