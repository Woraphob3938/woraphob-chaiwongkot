# FitConnect Gmail Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่มศูนย์การแจ้งเตือนแบบ Master Detail สำหรับสมาชิกและเทรนเนอร์ พร้อมส่งเหตุการณ์สำคัญผ่าน Gmail SMTP โดยไม่เปลี่ยน workflow การจองและการตรวจชำระเงินเดิม

**Architecture:** ใช้ตาราง `notifications` ตารางเดียวเป็นทั้งประวัติแจ้งเตือนในเว็บและ outbox สำหรับ Gmail ทุก business event บันทึก notification ใน transaction เดียวกับการเปลี่ยนสถานะ แล้วจึงลองส่งอีเมลหลัง commit; worker แบบ Scheduled Task สร้าง reminder 24 ชั่วโมงและ retry อีเมลที่ยังไม่สำเร็จ หน้า Next.js อ่าน API แบบแบ่งหน้า 10 รายการและแสดง Master Detail ภายใน visual system เดิมของ FitConnect

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest + Testing Library, PHP 8/XAMPP, PDO MariaDB, PHP cURL SMTP STARTTLS, PowerShell Scheduled Tasks, shadcn primitives ที่มีอยู่แล้ว, Lucide icons

## Global Constraints

- อ่าน `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` และ `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` ก่อนแก้ frontend เพราะ Next.js รุ่นนี้มี breaking changes
- คำสั่ง shell ทุกคำสั่งต้องขึ้นต้นด้วย `rtk` ตาม `C:\Users\HP\.codex\RTK.md`
- ใช้ PHP cURL SMTP ที่ XAMPP มีอยู่แล้ว ห้ามเพิ่ม Composer หรือ mail library ใหม่
- ใช้ Gmail กลางของ FitConnect + App Password; ห้ามใช้ Gmail OAuth ของสมาชิกหรือเทรนเนอร์
- ค่าเริ่มต้นต้องเป็น `MAIL_ENABLED=false`; automated tests และ smoke ห้ามส่ง Gmail จริง
- การส่ง Gmail จริงต้องเป็นคำสั่งแยกที่ระบุอีเมลปลายทางและได้รับการยืนยันจากผู้ใช้ก่อนรัน
- Gmail ล้มเหลวต้องไม่ rollback การจอง การชำระเงิน การยกเลิก หรือการตัดหมดเวลา
- เทรนเนอร์ไม่เห็น notification ก่อนการชำระเงินผ่าน และไม่มีปุ่มรับการจอง
- ผู้ดูแลระบบ, LINE, SMS, browser push, marketing email, chat email, review email, จังหวัด และสถานที่นัดฝึกอยู่นอกขอบเขต
- API list ใช้ page แบบ zero-based และคืนไม่เกิน 10 รายการต่อหน้า
- หน้า `/notifications` ต้องไม่มี horizontal overflow ที่ 320, 375, 414, 768 และ 1280 พิกเซล
- touch target อย่างน้อย 44px, มี focus ring, reduced-motion fallback, `role="alert"` สำหรับ error และ polite live region สำหรับ loading/status
- ห้ามแตะหรือ stage `.impeccable/critique/`, `.superpowers/` และ `graphify-out/` ซึ่งเป็นไฟล์ของผู้ใช้/ผลลัพธ์นอก scope

---

## File Map

- `backend/database/schema.sql`: canonical schema ของตาราง notifications
- `backend/database/manual-migrations/20260812_add_notifications.sql`: migration สำหรับฐานข้อมูลที่มีอยู่
- `scripts/migrate-notifications.ps1`: อ่าน `backend/.env`, รัน migration และตรวจโครงสร้าง
- `backend/src/NotificationRules.php`: mapping เหตุการณ์ → ผู้รับ หมวด ข้อความ action และนโยบาย email โดยไม่มี I/O
- `backend/src/GmailMailer.php`: สร้าง MIME plain/HTML และส่ง SMTP STARTTLS ผ่าน cURL
- `backend/src/NotificationService.php`: persist, query, mark-read, reminder generation และ outbox retry
- `backend/src/Handlers.php`: เชื่อม business transactions และเปิด notification API
- `backend/scripts/process-notifications.php`: entry point สำหรับ reminder/retry scheduler
- `scripts/install-notification-task.ps1`: Scheduled Task ทุกหนึ่งนาทีแบบ hidden
- `lib/types.ts`: frontend notification contracts
- `components/notification-center.tsx`: Master Detail behavior และ API state
- `app/notifications/page.tsx`: route และ metadata
- `lib/role-navigation.ts`, `components/site-header.tsx`, `components/mobile-role-nav.tsx`: เมนู member/trainer และ unread badge
- `app/globals.css`: desktop/tablet/mobile layout, focus, motion และ overflow rules
- `scripts/api-notifications-smoke.ps1`: live XAMPP workflow/audit โดยปิด mail
- `README.md`, `backend/README.md`, `backend/.env.example`: setup/migration/scheduler/Gmail handoff

---

### Task 1: Notification schema and deterministic event rules

**Files:**
- Create: `backend/database/manual-migrations/20260812_add_notifications.sql`
- Create: `scripts/migrate-notifications.ps1`
- Create: `scripts/migrate-notifications.test.ps1`
- Create: `backend/src/NotificationRules.php`
- Create: `backend/tests/NotificationRulesTest.php`
- Modify: `backend/database/schema.sql`
- Modify: `package.json`

**Interfaces:**
- Consumes: booking context with `bookingId:int`, `bookingPublicId:string`, `memberUserId:int`, `trainerUserId:int`, `memberName:string`, `trainerName:string`, `startsAt:string`, `endsAt:string`, `quotedPrice:?float`, `previousStatus:string`, `nextStatus:string`, `reviewNote:string`
- Produces: `NotificationRules::forEvent(string $event, array $context): array<int, array{recipientUserId:int,type:string,category:string,title:string,message:string,actionPath:string,emailRequired:bool}>`
- Produces event constants: `BOOKING_CREATED`, `PAYMENT_SUBMITTED`, `PAYMENT_APPROVED`, `PAYMENT_REJECTED_RETRY`, `PAYMENT_REJECTED_FINAL`, `BOOKING_EXPIRED`, `BOOKING_CANCELLED`, `APPOINTMENT_REMINDER`

- [ ] **Step 1: Write the failing rule tests**

Create `backend/tests/NotificationRulesTest.php` using the same lightweight runner as `WorkflowRulesTest.php`. Assert this exact recipient matrix:

```php
$cases = [
    [NotificationRules::BOOKING_CREATED, [1], true],
    [NotificationRules::PAYMENT_SUBMITTED, [1], false],
    [NotificationRules::PAYMENT_APPROVED, [1, 2], true],
    [NotificationRules::PAYMENT_REJECTED_RETRY, [1], true],
    [NotificationRules::PAYMENT_REJECTED_FINAL, [1], true],
    [NotificationRules::BOOKING_EXPIRED, [1], true],
    [NotificationRules::BOOKING_CANCELLED, [1, 2], true],
    [NotificationRules::APPOINTMENT_REMINDER, [1, 2], true],
];
```

For `BOOKING_CANCELLED`, also assert trainer id `2` is omitted when `previousStatus !== 'confirmed'`. Assert every `actionPath` starts with `/`, every title/message is non-empty Thai copy, no output contains `จังหวัด`, `สถานที่นัดฝึก`, a token, slip path, or certificate path, and `PAYMENT_SUBMITTED` is the only web-only event.

- [ ] **Step 2: Run RED**

Run: `rtk C:\xampp\php\php.exe backend/tests/NotificationRulesTest.php`

Expected: FAIL because `backend/src/NotificationRules.php` does not exist.

- [ ] **Step 3: Implement the pure rule map**

Create `NotificationRules` as a final class. Validate the event against the constants and return definitions only—no SQL, mail or clock access. Use these action paths:

```php
private const MEMBER_BOOKINGS = '/member';
private const TRAINER_WORKSPACE = '/trainer';
private const TRAINER_SEARCH = '/trainers';
```

Use event-specific `type` values (`booking_created`, `payment_submitted`, `payment_approved_member`, `payment_approved_trainer`, `payment_rejected_retry`, `payment_rejected_final`, `booking_expired`, `booking_cancelled_member`, `booking_cancelled_trainer`, `appointment_reminder_member`, `appointment_reminder_trainer`) so the unique key can distinguish the two recipients and each transition while preventing scheduler duplicates.

- [ ] **Step 4: Add the table to canonical schema and migration**

Use this schema in both SQL files:

```sql
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(64) NOT NULL,
  category ENUM('booking', 'payment', 'appointment') NOT NULL,
  title VARCHAR(190) NOT NULL,
  message TEXT NOT NULL,
  booking_id BIGINT UNSIGNED NOT NULL,
  action_path VARCHAR(255) NOT NULL,
  read_at DATETIME NULL,
  email_status ENUM('pending', 'sent', 'failed', 'skipped') NOT NULL,
  email_attempt_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
  email_next_attempt_at DATETIME NULL,
  email_sent_at DATETIME NULL,
  email_last_error VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_notification_event (recipient_user_id, type, booking_id),
  KEY idx_notification_inbox (recipient_user_id, read_at, created_at),
  KEY idx_notification_email_queue (email_status, email_next_attempt_at, email_attempt_count),
  CONSTRAINT fk_notification_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

- [ ] **Step 5: Add a safe migration wrapper and its dry-run test**

Copy the proven environment-loading pattern from `scripts/migrate-admin-permissions.ps1`: explicit parameters override `backend/.env`, `MYSQL_PWD` is restored in `finally`, and both migration and verification use the configured host/port/name/user. Verification must query `information_schema.tables`, the unique key, both FKs, and all four email statuses. Add scripts:

```json
"test:php": "C:\\xampp\\php\\php.exe backend/tests/WorkflowRulesTest.php && C:\\xampp\\php\\php.exe backend/tests/ProfileRulesTest.php && C:\\xampp\\php\\php.exe backend/tests/NotificationRulesTest.php",
"migrate:notifications": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-notifications.ps1",
"test:migrate-notifications": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-notifications.test.ps1"
```

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
rtk C:\xampp\php\php.exe backend/tests/NotificationRulesTest.php
rtk npm run test:migrate-notifications
rtk git diff --check
```

Expected: all PASS; migration installer test must not mutate the database.

Commit:

```powershell
rtk git add backend/database/schema.sql backend/database/manual-migrations/20260812_add_notifications.sql backend/src/NotificationRules.php backend/tests/NotificationRulesTest.php scripts/migrate-notifications.ps1 scripts/migrate-notifications.test.ps1 package.json
rtk git commit -m "feat: define notification events and storage"
```

---

### Task 2: Gmail mailer, outbox retry and hidden scheduler

**Files:**
- Create: `backend/src/GmailMailer.php`
- Create: `backend/src/NotificationService.php`
- Create: `backend/tests/GmailMailerTest.php`
- Create: `backend/tests/NotificationDeliveryTest.php`
- Create: `backend/scripts/process-notifications.php`
- Create: `scripts/install-notification-task.ps1`
- Create: `scripts/install-notification-task.test.ps1`
- Modify: `backend/src/config.php`
- Modify: `package.json`

**Interfaces:**
- Consumes: `NotificationRules::forEvent(...)` from Task 1
- Produces: `GmailMailer::__construct(array $mailConfig, ?Closure $transport = null)`
- Produces: `GmailMailer::isEnabled(): bool`
- Produces: `GmailMailer::send(string $recipientEmail, string $recipientName, string $title, string $message, string $actionPath): void`; throws sanitized `RuntimeException` on failure
- Produces: `NotificationService::__construct(Database $database, array $config, ?GmailMailer $mailer = null)`
- Produces: `NotificationService::recordEvent(PDO $pdo, string $event, array $context): array<int>`
- Produces: `NotificationService::deliverByIds(array $ids): void`
- Produces: `NotificationService::processDue(int $limit = 20): array{reminders:int,sent:int,failed:int}`
- Produces: `NotificationService::retryDelayMinutes(int $attempt): int` with delays `1, 5, 15, 60` and no retry after attempt 5

- [ ] **Step 1: Write RED tests for MIME, disabled mode and retry state**

In `GmailMailerTest.php`, inject a closure transport that captures the SMTP URL, username, password and MIME payload. Assert:

```php
assertSameValue('smtp://smtp.gmail.com:587', $captured['url']);
assertContainsValue('Subject: [FitConnect]', $captured['payload']);
assertContainsValue('multipart/alternative', $captured['payload']);
assertContainsValue('http://localhost:3000/member', $captured['payload']);
assertNotContainsValue('<script>', $captured['payload']);
```

Also assert `MAIL_ENABLED=false` reports disabled and never invokes transport. In `NotificationDeliveryTest.php`, assert delays for attempts 1–4 and that attempt 5 remains `failed` with `email_next_attempt_at = null`.

- [ ] **Step 2: Run RED**

Run:

```powershell
rtk C:\xampp\php\php.exe backend/tests/GmailMailerTest.php
rtk C:\xampp\php\php.exe backend/tests/NotificationDeliveryTest.php
```

Expected: FAIL because both production classes are missing.

- [ ] **Step 3: Add exact mail configuration**

Extend `backend/src/config.php`:

```php
'app_url' => rtrim((string) env('APP_URL', 'http://localhost:3000'), '/'),
'mail' => [
    'enabled' => filter_var(env('MAIL_ENABLED', 'false'), FILTER_VALIDATE_BOOL),
    'host' => env('MAIL_HOST', 'smtp.gmail.com'),
    'port' => (int) env('MAIL_PORT', '587'),
    'username' => env('MAIL_USERNAME', ''),
    'app_password' => env('MAIL_APP_PASSWORD', ''),
    'from_email' => env('MAIL_FROM_EMAIL', ''),
    'from_name' => env('MAIL_FROM_NAME', 'FitConnect'),
],
```

When enabled, constructor validation must reject a missing username/app password/from email before any delivery attempt.

- [ ] **Step 4: Implement Gmail SMTP with no new dependency**

Build RFC-compliant CRLF headers, encoded UTF-8 subject/from name, plain text and escaped HTML bodies. Configure cURL with `CURLOPT_USE_SSL => CURLUSESSL_ALL`, username/password, mail from/to, upload callback, timeout 20 seconds and certificate verification left enabled. Never place credentials, tokens, slip paths or attachments in the MIME body or exception text.

- [ ] **Step 5: Implement notification persistence and delivery state**

`recordEvent()` calls `NotificationRules::forEvent()`, inserts each definition with `INSERT IGNORE`, and returns only newly created ids. Set `email_status='pending'` plus `email_next_attempt_at=UTC_TIMESTAMP()` for email-required definitions; set `email_status='skipped'` and `email_next_attempt_at=NULL` for web-only definitions.

`deliverByIds()` returns immediately when mail is disabled. Otherwise, join `users` for the current recipient email, send each eligible row and update its state. Serialize immediate delivery and the scheduler with MariaDB advisory lock `GET_LOCK('fitconnect-notification-mailer', 0)` and always call `RELEASE_LOCK(...)` in `finally`; hold the lock through SMTP send plus row update so two PHP processes cannot send the same queued row concurrently:

```php
// success
email_status = 'sent', email_attempt_count = email_attempt_count + 1,
email_sent_at = UTC_TIMESTAMP(), email_next_attempt_at = NULL, email_last_error = NULL

// failure attempts 1..4
email_status = 'failed', email_attempt_count = email_attempt_count + 1,
email_next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :delay MINUTE)

// failure attempt 5
email_status = 'failed', email_attempt_count = 5,
email_next_attempt_at = NULL
```

Store at most 500 sanitized characters in `email_last_error`; log the notification id but never credentials.

- [ ] **Step 6: Add reminder/retry worker and hidden task installer**

Before processing the outbox, `processDue()` selects confirmed future bookings with `starts_at > UTC_TIMESTAMP()` and `starts_at <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL 24 HOUR)`, calls `recordEvent(APPOINTMENT_REMINDER, ...)` in one transaction, and relies on `uq_notification_event` for dedupe. Then deliver pending/failed rows with attempts `< 5` whose `email_next_attempt_at <= UTC_TIMESTAMP()`.

`backend/scripts/process-notifications.php` prints only JSON counts. `scripts/install-notification-task.ps1` must mirror the booking-expiry task but use task name `FitConnect-ProcessNotifications`, run every minute, set `Hidden = true`, allow battery use and ignore overlapping instances.

- [ ] **Step 7: Run GREEN and commit**

Run:

```powershell
rtk C:\xampp\php\php.exe backend/tests/GmailMailerTest.php
rtk C:\xampp\php\php.exe backend/tests/NotificationDeliveryTest.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-notification-task.test.ps1
rtk git diff --check
```

Expected: all PASS and no network email is sent.

Extend `test:php` to append `GmailMailerTest.php` and `NotificationDeliveryTest.php` so later full PHP gates include them.

Commit:

```powershell
rtk git add backend/src/config.php backend/src/GmailMailer.php backend/src/NotificationService.php backend/tests/GmailMailerTest.php backend/tests/NotificationDeliveryTest.php backend/scripts/process-notifications.php scripts/install-notification-task.ps1 scripts/install-notification-task.test.ps1 package.json
rtk git commit -m "feat: deliver notification emails safely"
```

---

### Task 3: Record notifications inside existing booking transactions

**Files:**
- Modify: `backend/index.php`
- Modify: `backend/src/Handlers.php`
- Modify: `backend/scripts/expire-bookings.php`
- Create: `backend/tests/NotificationIntegrationSourceTest.php`
- Modify: `package.json`

**Interfaces:**
- Consumes: `NotificationService::recordEvent()`, `deliverByIds()` and `processDue()` from Task 2
- Produces: unchanged public booking/payment response shapes and unchanged status transition rules
- Produces: `Handlers::expireAwaitingPaymentsForScheduler(): int` still returns the number expired

- [ ] **Step 1: Add focused RED regression assertions**

Create `NotificationIntegrationSourceTest.php` with the same tiny `test()/assertSameValue()` runner, read `Handlers.php` using `file_get_contents(__DIR__ . '/../src/Handlers.php')`, fail if reading returns `false`, and add these exact helpers:

```php
function assertSourceContains(string $source, string $needle): void
{
    assertSameValue(true, str_contains($source, $needle));
}

function assertSourceDoesNotContain(string $source, string $needle): void
{
    assertSameValue(false, str_contains($source, $needle));
}
```

Assert every approved event constant is wired to the correct workflow method, plus these negative constraints:

```php
assertSourceDoesNotContain($source, 'trainer_accept');
assertSourceDoesNotContain($source, 'notifyTrainerBeforePayment');
assertSourceContains($source, 'NotificationRules::PAYMENT_APPROVED');
assertSourceContains($source, 'NotificationRules::BOOKING_EXPIRED');
```

Append `NotificationIntegrationSourceTest.php` to `test:php`.

This source test is a narrow guard around integration points; the live database behavior is verified in Task 6.

- [ ] **Step 2: Run RED**

Run: `rtk npm run test:php`

Expected: FAIL because `Handlers.php` has no notification event integration.

- [ ] **Step 3: Load the new classes and service**

Require `NotificationRules.php`, `GmailMailer.php`, and `NotificationService.php` before `Handlers.php` in `backend/index.php` and `backend/scripts/expire-bookings.php`. Construct one service in `Handlers::__construct()`:

```php
$this->notifications = new NotificationService($database, $config);
```

- [ ] **Step 4: Record each event before commit and deliver only after commit**

For `createBooking`, `payment`, `decidePayment`, `cancelMemberBooking`, `updateBookingStatus`, and expiry helpers, declare `$notificationIds = []`, append ids inside the existing PDO transaction, and call this only after the transaction returns successfully:

```php
$this->notifications->deliverByIds($notificationIds);
```

`deliverByIds()` must swallow/log mail transport failures internally so handler responses stay unchanged. Map workflows exactly:

| Existing workflow | Event |
|---|---|
| booking inserted as `awaiting_payment` | `BOOKING_CREATED` |
| payment inserted and booking becomes `payment_review` | `PAYMENT_SUBMITTED` |
| first rejection returns booking to `awaiting_payment` | `PAYMENT_REJECTED_RETRY` |
| second rejection changes booking to `expired` | `PAYMENT_REJECTED_FINAL` |
| approval changes booking to `confirmed` | `PAYMENT_APPROVED` |
| payment deadline helper changes booking to `expired` | `BOOKING_EXPIRED` |
| member/admin changes booking to `cancelled` | `BOOKING_CANCELLED`; trainer recipient only when prior status was `confirmed` |

Each SQL selection must fetch member/trainer user ids, display names, public booking id, starts/ends and quoted price needed by the rule context. Do not add a trainer acceptance transition.

- [ ] **Step 5: Preserve expiry delivery in every entry path**

Change the private helper signature to collect ids without global state:

```php
private function expireAwaitingPaymentsInTransaction(
    PDO $pdo,
    ?int $slotId = null,
    ?array &$notificationIds = null
): array
```

`expireAwaitingPayments()` owns a local id array, commits, then delivers. Transactional callers pass their own array so booking creation, payment submission and cancellation cannot send before the outer commit. The scheduler continues to call the same public expiry method.

- [ ] **Step 6: Run GREEN and commit**

Run:

```powershell
rtk npm run test:php
rtk npm run typecheck
rtk git diff --check
```

Expected: PHP tests and TypeScript check PASS; no HTTP response field changes.

Commit:

```powershell
rtk git add backend/index.php backend/src/Handlers.php backend/scripts/expire-bookings.php backend/tests/NotificationIntegrationSourceTest.php package.json
rtk git commit -m "feat: notify booking participants after commit"
```

---

### Task 4: Authenticated notification API

**Files:**
- Modify: `backend/index.php`
- Modify: `backend/src/Handlers.php`
- Modify: `backend/src/NotificationService.php`
- Create: `backend/tests/NotificationQueryRulesTest.php`

**Interfaces:**
- Produces: `NotificationService::listForUser(int $userId, int $page, string $category, bool $unread): array`
- Produces: `NotificationService::detailForUser(int $userId, int $notificationId): ?array`
- Produces: `NotificationService::markRead(int $userId, int $notificationId): bool`
- Produces: `NotificationService::markAllRead(int $userId): int`
- Produces API endpoints exactly: `GET /v1/notifications`, `GET /v1/notifications/{id}`, `PATCH /v1/notifications/{id}/read`, `POST /v1/notifications/read-all`

- [ ] **Step 1: Write RED validation tests**

Create pure query validation helpers in `NotificationService` and tests for:

```php
assertSameValue(0, NotificationService::parsePage('0'));
assertSameValue(100000, NotificationService::parsePage('100001'));
assertSameValue('all', NotificationService::parseCategory('all'));
assertSameValue('appointment', NotificationService::parseCategory('appointment'));
expectHttp(422, 'VALIDATION_FAILED', fn() => NotificationService::parseCategory('admin'));
expectHttp(422, 'VALIDATION_FAILED', fn() => NotificationService::parseUnread('sometimes'));
```

- [ ] **Step 2: Run RED**

Run: `rtk C:\xampp\php\php.exe backend/tests/NotificationQueryRulesTest.php`

Expected: FAIL because query methods are absent.

- [ ] **Step 3: Implement owner-scoped list/detail/read methods**

List query uses `recipient_user_id = ?`, optional category/unread predicates, `ORDER BY created_at DESC, id DESC`, `LIMIT 10 OFFSET page*10`. Return this exact contract:

```php
[
  'items' => [[
    'id' => 41,
    'type' => 'payment_approved_member',
    'category' => 'payment',
    'title' => 'ยืนยันการจองแล้ว',
    'message' => '...',
    'bookingId' => 'BK-1234ABCD',
    'actionPath' => '/member',
    'readAt' => null,
    'createdAt' => '2026-08-12T08:00:00.000Z',
  ]],
  'unread' => ['all' => 3, 'booking' => 1, 'payment' => 1, 'appointment' => 1],
  'pagination' => ['page' => 0, 'pageSize' => 10, 'total' => 24, 'totalPages' => 3],
]
```

Detail query must join only the owned notification to booking/member/trainer/history and return `booking` with public id, startsAt, endsAt, status, paymentStatus, quotedPrice and history. Do not return recipient email, SMTP fields, `email_last_error`, file paths or another user's notification.

- [ ] **Step 4: Add handlers and exact routes**

Every handler calls `$this->auth->requireUser(['member', 'trainer'])`. A missing/not-owned id returns 404 `NOTIFICATION_NOT_FOUND`, not 403, to avoid revealing existence. Marking a notification read is idempotent. `read-all` updates only the current user and returns `{ "updated": n }`.

Register static `read-all` before the numeric detail regex, then the numeric routes:

```php
if ($method === 'GET' && $path === '/v1/notifications') $handlers->notifications();
if ($method === 'POST' && $path === '/v1/notifications/read-all') $handlers->readAllNotifications();
if ($method === 'GET' && preg_match('#^/v1/notifications/(\d+)$#', $path, $matches) === 1) $handlers->notification($matches[1]);
if ($method === 'PATCH' && preg_match('#^/v1/notifications/(\d+)/read$#', $path, $matches) === 1) $handlers->readNotification($matches[1]);
```

- [ ] **Step 5: Run GREEN and commit**

Run:

```powershell
rtk C:\xampp\php\php.exe backend/tests/NotificationQueryRulesTest.php
rtk npm run test:php
rtk git diff --check
```

Expected: all PASS.

Extend `test:php` to append `NotificationQueryRulesTest.php`.

Commit:

```powershell
rtk git add backend/index.php backend/src/Handlers.php backend/src/NotificationService.php backend/tests/NotificationQueryRulesTest.php package.json
rtk git commit -m "feat: expose private notification inbox api"
```

---

### Task 5: Master Detail notification center and navigation badges

**Files:**
- Create: `app/notifications/page.tsx`
- Create: `components/notification-center.tsx`
- Create: `components/notification-center.test.tsx`
- Modify: `lib/types.ts`
- Modify: `lib/role-navigation.ts`
- Modify: `lib/role-navigation.test.ts`
- Modify: `components/site-header.tsx`
- Modify: `components/site-header.test.tsx`
- Modify: `components/mobile-role-nav.tsx`
- Create: `components/mobile-role-nav.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 4 API response contract through `authenticatedRequest<T>()`
- Produces: `NotificationCategory = 'all' | 'booking' | 'payment' | 'appointment'`
- Produces: `NotificationListResponse`, `NotificationItem`, `NotificationDetail` in `lib/types.ts`
- Produces: browser event `fitconnect:notifications-changed` with `{ unreadTotal:number }`
- Produces: `MobileRoleNav({ user, notificationUnreadCount }: { user: AuthenticatedUser | null; notificationUnreadCount: number })`

- [ ] **Step 1: Read local Next.js guides and write RED UI tests**

Read the two Next.js files named in Global Constraints. In `notification-center.test.tsx`, mock `authenticatedRequest` and assert:

1. loading skeleton has a polite live region;
2. API error renders `role="alert"` and `ลองใหม่` triggers a fresh request;
3. category/filter/page changes request exact query strings;
4. list renders at most the 10 API items and `time` elements;
5. selecting an unread item fetches detail, calls `PATCH /v1/notifications/{id}/read`, updates the visual state once and dispatches the change event;
6. `ทำเครื่องหมายว่าอ่านแล้วทั้งหมด` calls `POST /v1/notifications/read-all`;
7. empty category explains the state and offers `ดูทั้งหมด`;
8. detail action accepts only internal paths beginning with `/`.

In navigation tests, assert member/trainer have `การแจ้งเตือน`, admin/guest do not, and a count of 3 has accessible text `มีการแจ้งเตือนที่ยังไม่ได้อ่าน 3 รายการ`.

- [ ] **Step 2: Run RED**

Run:

```powershell
rtk npm test -- components/notification-center.test.tsx lib/role-navigation.test.ts components/site-header.test.tsx components/mobile-role-nav.test.tsx
```

Expected: FAIL because route, component, types and navigation icon are missing.

- [ ] **Step 3: Add types and role navigation item**

Add `"notifications"` to `NavigationIcon`. Insert this item for member and trainer only, immediately before chat:

```ts
{ href: "/notifications", label: "การแจ้งเตือน", icon: "notifications", desktop: true, mobile: true }
```

Use Lucide `Bell` in both navigation renderers. Do not add the item to guest/admin.

- [ ] **Step 4: Build the stateful Master Detail component**

Use the existing shadcn `Button`, `Badge`, `Skeleton`, and `Alert` primitives. Keep one component state machine with `loading | ready | error`, current category, unread-only flag, page, selected id/detail and one status announcement. Desktop DOM order must be categories → notification list → detail. Categories are `ทั้งหมด`, `การจอง`, `การชำระเงิน`, `นัดหมาย` with unread counts.

On selection:

```ts
const detail = await authenticatedRequest<NotificationDetail>(`/v1/notifications/${id}`);
if (!item.readAt) {
  await authenticatedRequest(`/v1/notifications/${id}/read`, { method: "PATCH" });
  window.dispatchEvent(new CustomEvent("fitconnect:notifications-changed", {
    detail: { unreadTotal: Math.max(0, unread.all - 1) },
  }));
}
```

Ignore unsafe `actionPath` values rather than rendering an external link. Detail shows title, message, booking facts, history, and one primary action. It must not show SMTP status/error or email address.

- [ ] **Step 5: Add the route and responsive behavior**

`app/notifications/page.tsx` exports metadata `{ title: 'การแจ้งเตือน' }`, an sr-only `h1`, and `<NotificationCenter />` inside `<main className="notifications-page">`.

CSS requirements:

- `>= 64rem`: three columns `minmax(10rem, .7fr) minmax(18rem, 1fr) minmax(22rem, 1.25fr)` within the content area
- `< 64rem`: categories become a one-line horizontal scroller; list/detail use the remaining width
- `< 48rem`: selected detail replaces the list visually and exposes `กลับรายการแจ้งเตือน`; no modal and no nested sidebar
- `< 24rem`: controls stack, long Thai/booking ids wrap with `overflow-wrap:anywhere`
- item/detail transition 180ms; `@media (prefers-reduced-motion: reduce)` removes the transition
- list area may scroll internally on desktop, but page pagination remains the only way to reach records beyond 10

- [ ] **Step 6: Fetch and synchronize the unread badge once in SiteHeader**

When session role is member/trainer, fetch `/v1/notifications?page=0&category=all&unread=false` and store `response.unread.all`; for admin/guest set 0 and do not request. Listen to `fitconnect:notifications-changed` and refetch on `focus`. Render a compact badge beside the desktop label and icon-only dot/count in collapsed mode; pass the same count to `MobileRoleNav`. Cap visible copy at `99+` but keep the full number in the accessible label.

- [ ] **Step 7: Run GREEN and commit**

Run:

```powershell
rtk npm test -- components/notification-center.test.tsx lib/role-navigation.test.ts components/site-header.test.tsx components/mobile-role-nav.test.tsx
rtk npm run typecheck
rtk npm run lint
rtk git diff --check
```

Expected: focused tests, typecheck, lint and diff check PASS.

Commit:

```powershell
rtk git add app/notifications/page.tsx components/notification-center.tsx components/notification-center.test.tsx components/mobile-role-nav.tsx components/mobile-role-nav.test.tsx components/site-header.tsx components/site-header.test.tsx lib/role-navigation.ts lib/role-navigation.test.ts lib/types.ts app/globals.css
rtk git commit -m "feat: add member and trainer notification center"
```

---

### Task 6: XAMPP smoke, operator setup and complete verification

**Files:**
- Create: `scripts/api-notifications-smoke.ps1`
- Create: `scripts/send-test-notification-email.ps1`
- Modify: `backend/.env.example`
- Modify: `README.md`
- Modify: `backend/README.md`
- Modify: `package.json`
- Update: `docs/superpowers/specs/2026-08-12-gmail-notifications-design.md`

**Interfaces:**
- Consumes: migration, API, worker and UI from Tasks 1–5
- Produces commands: `smoke:notifications`, `notifications:run`, `notifications:install`, `notifications:send-test`
- Produces no retained test users, notifications, bookings, files or actual Gmail during automatic smoke

- [ ] **Step 1: Write the XAMPP smoke script with mail forced off**

Use the env/MySQL cleanup pattern from `api-admin-operations-smoke.ps1`. The script must:

1. verify `/v1/health` and notifications table;
2. register one member and one trainer, approve trainer, create slot/booking/payment, then approve payment;
3. assert member receives booking-created, payment-submitted and payment-approved; trainer receives only payment-approved;
4. assert exact `email_status`: `skipped` for payment-submitted and `pending` for mail-required rows while `MAIL_ENABLED=false`;
5. assert list page size 10, category/unread filters, detail ownership 404, idempotent read and read-all;
6. call the worker twice and assert reminder unique key prevents duplicates;
7. cancel a confirmed booking and assert both recipients receive one cancellation;
8. clean created rows/users/files in `finally` and restore `MYSQL_PWD`/mail environment.

Add:

```json
"smoke:notifications": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-notifications-smoke.ps1",
"notifications:run": "C:\\xampp\\php\\php.exe backend/scripts/process-notifications.php",
"notifications:install": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-notification-task.ps1",
"notifications:send-test": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/send-test-notification-email.ps1"
```

- [ ] **Step 2: Add an explicit live-Gmail command that cannot run accidentally**

`send-test-notification-email.ps1` requires both `-RecipientEmail` and `-ConfirmSend SEND`. Any other value exits before PHP/cURL. It reads mail config from `backend/.env`, sends one synthetic system test with no booking data, and prints only recipient, accepted/failed status and timestamp—never credentials. Do not invoke it during this task without fresh user approval.

- [ ] **Step 3: Document exact setup and safe failure behavior**

Add the approved env block:

```env
MAIL_ENABLED=false
MAIL_HOST=smtp.gmail.com
MAIL_PORT=587
MAIL_USERNAME=
MAIL_APP_PASSWORD=
MAIL_FROM_EMAIL=
MAIL_FROM_NAME=FitConnect
APP_URL=http://localhost:3000
```

Document: Gmail 2-Step Verification/App Password, `npm run migrate:notifications`, `npm run notifications:install`, how to keep mail disabled for local smoke, how to inspect failed rows without exposing passwords, retry max 5, and that legacy booking-expiry task remains separate. Change the spec status to `อนุมัติแล้วเมื่อ 12 สิงหาคม 2026`.

- [ ] **Step 4: Run the full automated and live-local gate once**

Run:

```powershell
rtk npm run migrate:notifications
rtk npm run test:php
rtk C:\xampp\php\php.exe backend/tests/NotificationRulesTest.php
rtk C:\xampp\php\php.exe backend/tests/GmailMailerTest.php
rtk C:\xampp\php\php.exe backend/tests/NotificationDeliveryTest.php
rtk C:\xampp\php\php.exe backend/tests/NotificationQueryRulesTest.php
rtk npm test
rtk npm run lint
rtk npm run typecheck
rtk npm run build
rtk npm run smoke:notifications
rtk git diff --check
```

Expected: every command PASS; build keeps all current routes and adds `/notifications`; smoke reports mail disabled and zero external emails.

- [ ] **Step 5: Run one bounded browser matrix**

Start a fresh local Next.js server and use Playwright against a member and trainer fixture at 320, 375, 414, 768 and 1280. Capture and assert:

- loading, empty, error/retry, unread list, selected detail and read-all states;
- no horizontal overflow (`document.documentElement.scrollWidth === clientWidth`);
- member/trainer sidebar badge matches API; admin has no notification item;
- mobile back control returns to list without navigation;
- keyboard reaches category, filter, list, detail action and pagination in sensible order;
- 200% zoom has no clipped action; reduced motion removes transitions;
- each interactive target is at least 44×44 CSS pixels.

Use one fix batch for actual P1/P2 defects, then one focused confirmation only. Do not rerun the full matrix for harness-only mistakes.

- [ ] **Step 6: Audit scope and commit documentation/smoke**

Run:

```powershell
rtk git status --short
rtk git diff --name-only
rtk git diff --check
```

Confirm `.impeccable/critique/`, `.superpowers/`, `graphify-out/`, Gmail credentials, generated screenshots, database rows and uploaded fixtures are not staged.

Commit:

```powershell
rtk git add scripts/api-notifications-smoke.ps1 scripts/send-test-notification-email.ps1 backend/.env.example README.md backend/README.md package.json docs/superpowers/specs/2026-08-12-gmail-notifications-design.md
rtk git commit -m "test: verify notifications end to end"
```

---

## Completion Checklist

- [ ] Member and trainer can open `/notifications`; guest/admin cannot receive inbox data
- [ ] Member/trainer sidebar and mobile badge match database unread count
- [ ] Every approved event creates exactly one notification for the correct recipient set
- [ ] Trainer receives nothing before payment approval and never accepts a booking
- [ ] Gmail is plain + HTML, STARTTLS, credential-safe, attachment-free and uses only internal `APP_URL` links
- [ ] Mail failure never changes business outcome; retries stop after attempt 5
- [ ] Reminder is created once per recipient/booking within 24 hours
- [ ] API ownership, filters, 10-row pagination, read and read-all are verified
- [ ] UI loading/error/empty/detail/mobile/accessibility states and five viewport widths are verified
- [ ] No province, meeting location, admin notification, chat email or review email was added
- [ ] Worktree is clean except user-owned ignored/untracked directories
