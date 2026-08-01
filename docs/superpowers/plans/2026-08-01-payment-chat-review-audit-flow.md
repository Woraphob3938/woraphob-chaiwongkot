# FitConnect Payment, Chat, Review, and Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the live FitConnect booking flow from trainer quote through payment review, booking chat, trainer completion, member review, and phpMyAdmin verification.

**Architecture:** Keep Next.js as the Thai-first interface and PHP/MySQL under XAMPP as the source of truth. Extend the existing booking aggregate and protected upload handlers, poll chat every 5 seconds, and use MySQL transactions plus `booking_status_history` for every state change.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, Vitest, Testing Library, PHP 8 under XAMPP, PDO, MySQL/MariaDB, and PowerShell smoke/audit scripts.

## Global Constraints

- Preserve the existing Next.js, PHP REST, XAMPP, and MySQL architecture. Do not add WebSocket, payment gateway, or external chat services.
- Trainer acceptance must include a positive final price with no more than 2 decimal places.
- Payment evidence and chat attachments accept JPG, PNG, WebP, or PDF up to 5 MB, verified from file content.
- Payment evidence, chat messages, and protected files must be authorized on the PHP server from database ownership.
- Chat becomes available after trainer acceptance, polls every approximately 5 seconds, and becomes read-only after cancellation.
- Only the owning trainer can complete a confirmed, paid booking after its server-side end time.
- Only the owning member can publish one review after completion.
- Every booking state change writes `booking_status_history` in the same transaction as the primary change.
- Keep Thai copy concise and honest about manual admin payment review.
- Reuse `tokens.css`, `DESIGN.md`, ledger/queue/workbench patterns, visible focus, text status labels, and reduced-motion behavior.
- Keep Sakon Nakhon as seed scope only. Do not hard-code it into new workflow logic.
- Do not commit `graphify-out/` or unrelated user changes.
- Follow red, green, refactor for each task and commit only after the named verification passes.

---

## File map

### Backend and database

- `backend/src/WorkflowRules.php`: pure validation for money, payment decisions, chat write access, completion, and reviews.
- `backend/tests/WorkflowRulesTest.php`: PHP unit-style tests for those rules.
- `backend/database/schema.sql`: fresh-install message attachment metadata.
- `backend/database/migrations/20260801_chat_attachment_metadata.sql`: idempotent upgrade for the current XAMPP database.
- `backend/index.php`: protected chat attachment route.
- `backend/src/Handlers.php`: booking payload, quote, payment, chat, completion, review, and protected-file transactions.
- `scripts/connect-xampp.ps1`: apply sorted database migrations after the base schema.
- `scripts/api-workflow-smoke.ps1`: preserve and update the trainer acceptance scenario for the required quote.
- `scripts/api-payment-chat-review-smoke.ps1`: live XAMPP end-to-end test for steps 7 to 9.
- `backend/database/audit_booking.sql`: joined checks for the six workflow tables.
- `scripts/audit-booking.ps1`: safe booking-id wrapper around the SQL audit.
- `backend/README.md`: API, smoke-test, and phpMyAdmin instructions.

### Frontend

- `lib/types.ts`: shared booking, payment, chat, review, and admin queue contracts.
- `lib/api.ts`: authenticated multipart and protected-file requests.
- `lib/api.test.ts`: request-header and error behavior.
- `components/trainer-workbench.tsx`: quote acceptance and completion.
- `components/trainer-workbench.test.tsx`: trainer interaction tests.
- `components/payment-panel.tsx`: member amount and slip form.
- `components/payment-panel.test.tsx`: payment form states and multipart request.
- `components/review-form.tsx`: one-time member rating and comment form.
- `components/review-form.test.tsx`: review validation and success.
- `components/role-dashboard.tsx`: member booking ledger and refresh orchestration.
- `components/admin-review-queue.tsx`: evidence comparison and required rejection note.
- `components/admin-review-queue.test.tsx`: payment review behavior.
- `components/chat-workbench.tsx`: live booking-room list, messages, attachments, and polling.
- `components/chat-workbench.test.tsx`: room selection, polling, multipart send, and cancellation.
- `components/chat-demo.tsx`: remove after the live workbench replaces every import.
- `app/chat/page.tsx`: live chat page entry.
- `components/status-badge.tsx`: approved Thai status labels.
- `app/globals.css`: payment, review, admin, trainer, and three-zone chat layouts.

---

### Task 1: Add pure workflow rules with PHP tests

**Files:**
- Modify: `backend/src/WorkflowRules.php:4-86`
- Modify: `backend/tests/WorkflowRulesTest.php:18-111`

**Interfaces:**
- Produces: `WorkflowRules::normalizeMoney(mixed $value, string $field): string`
- Produces: `WorkflowRules::assertPaymentDecision(string $paymentStatus, string $bookingStatus, string $decision, string $note): void`
- Produces: `WorkflowRules::assertChatWritable(string $bookingStatus): void`
- Produces: `WorkflowRules::assertTrainerCompletion(string $bookingStatus, string $paymentStatus, DateTimeImmutable $endsAt, DateTimeImmutable $now): void`
- Produces: `WorkflowRules::assertReviewSubmission(string $bookingStatus, int $rating, string $comment): void`

- [ ] **Step 1: Write failing rule tests**

Add concrete cases to `WorkflowRulesTest.php`:

```php
test('normalizes a positive money value', function (): void {
    assertSameValue('1200.50', WorkflowRules::normalizeMoney('1200.5', 'quotedPrice'));
});

test('rejects money with more than two decimal places', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::normalizeMoney('1200.555', 'amount'));
});

test('requires a payment rejection note', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertPaymentDecision('reviewing', 'payment_review', 'reject', ''));
});

test('blocks chat before trainer acceptance', function (): void {
    expectHttp(409, 'CHAT_READ_ONLY', fn() => WorkflowRules::assertChatWritable('pending_trainer'));
});

test('allows completion after a paid appointment ends', function (): void {
    WorkflowRules::assertTrainerCompletion(
        'confirmed',
        'approved',
        new DateTimeImmutable('2026-08-01T01:00:00.000Z'),
        new DateTimeImmutable('2026-08-01T01:01:00.000Z')
    );
});

test('requires a non-empty review comment', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertReviewSubmission('completed', 5, '   '));
});
```

- [ ] **Step 2: Run the PHP tests and verify the new methods are missing**

Run:

```powershell
rtk C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
```

Expected: FAIL with `Call to undefined method WorkflowRules::normalizeMoney()`.

- [ ] **Step 3: Implement the minimum pure rules**

Add these methods to `WorkflowRules`:

```php
public static function normalizeMoney(mixed $value, string $field): string
{
    $raw = trim((string) $value);
    if (preg_match('/^\d{1,8}(?:\.\d{1,2})?$/', $raw) !== 1 || (float) $raw <= 0) {
        throw new HttpException(
            422,
            'จำนวนเงินไม่ถูกต้อง',
            'VALIDATION_FAILED',
            [$field => 'กรอกจำนวนเงินที่มากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง']
        );
    }
    return number_format((float) $raw, 2, '.', '');
}

public static function assertPaymentDecision(
    string $paymentStatus,
    string $bookingStatus,
    string $decision,
    string $note
): void {
    if ($paymentStatus !== 'reviewing' || $bookingStatus !== 'payment_review') {
        throw new HttpException(409, 'หลักฐานนี้ได้รับการตัดสินแล้ว', 'PAYMENT_ALREADY_REVIEWED');
    }
    if ($decision === 'reject' && trim($note) === '') {
        throw new HttpException(422, 'กรุณาระบุเหตุผลที่สลิปไม่ผ่าน', 'VALIDATION_FAILED', ['note' => 'จำเป็นต้องระบุเหตุผล']);
    }
}

public static function assertChatWritable(string $bookingStatus): void
{
    if (!in_array($bookingStatus, ['awaiting_payment', 'payment_review', 'confirmed', 'completed'], true)) {
        throw new HttpException(409, 'ห้องสนทนานี้ส่งข้อความเพิ่มไม่ได้', 'CHAT_READ_ONLY');
    }
}

public static function assertTrainerCompletion(
    string $bookingStatus,
    string $paymentStatus,
    DateTimeImmutable $endsAt,
    DateTimeImmutable $now
): void {
    if ($bookingStatus !== 'confirmed' || $paymentStatus !== 'approved') {
        throw new HttpException(409, 'การจองนี้ยังปิดงานไม่ได้', 'BOOKING_NOT_COMPLETABLE');
    }
    if ($now < $endsAt) {
        throw new HttpException(409, 'ปิดงานได้หลังเวลานัดสิ้นสุด', 'BOOKING_END_NOT_REACHED');
    }
}

public static function assertReviewSubmission(string $bookingStatus, int $rating, string $comment): void
{
    if ($bookingStatus !== 'completed') {
        throw new HttpException(409, 'รีวิวได้หลังการฝึกเสร็จเท่านั้น', 'REVIEW_NOT_READY');
    }
    if ($rating < 1 || $rating > 5) {
        throw new HttpException(422, 'คะแนนต้องอยู่ระหว่าง 1 ถึง 5', 'VALIDATION_FAILED', ['rating' => 'เลือกคะแนน 1 ถึง 5']);
    }
    $length = mb_strlen(trim($comment));
    if ($length < 1 || $length > 2000) {
        throw new HttpException(422, 'ความคิดเห็นต้องมี 1 ถึง 2,000 ตัวอักษร', 'VALIDATION_FAILED', ['comment' => 'เขียนความคิดเห็นไม่เกิน 2,000 ตัวอักษร']);
    }
}
```

- [ ] **Step 4: Run the PHP rule tests**

Run the command from Step 2.

Expected: every test prints `PASS` and the process exits `0`.

- [ ] **Step 5: Commit the rule boundary**

```powershell
rtk git add backend/src/WorkflowRules.php backend/tests/WorkflowRulesTest.php
rtk git commit -m "test: define post-booking workflow rules"
```

### Task 2: Add idempotent chat attachment metadata migration

**Files:**
- Modify: `backend/database/schema.sql:220-231`
- Create: `backend/database/migrations/20260801_chat_attachment_metadata.sql`
- Modify: `scripts/connect-xampp.ps1:68-88`

**Interfaces:**
- Produces: nullable `messages.attachment_mime`, `messages.attachment_name`, and `messages.attachment_size`
- Produces: sorted migration execution during `npm run xampp:connect`

- [ ] **Step 1: Record the failing schema check**

Run:

```powershell
rtk C:\xampp\mysql\bin\mysql.exe --host=127.0.0.1 --user=root --database=fitconnect --batch --skip-column-names --execute="SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='fitconnect' AND table_name='messages' AND column_name IN ('attachment_mime','attachment_name','attachment_size')"
```

Expected before migration: `0`, not `3`.

- [ ] **Step 2: Add the fresh schema columns and upgrade SQL**

Add after `attachment_path` in `schema.sql`:

```sql
attachment_mime VARCHAR(100) NULL,
attachment_name VARCHAR(255) NULL,
attachment_size INT UNSIGNED NULL,
```

Create the migration:

```sql
USE fitconnect;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_mime VARCHAR(100) NULL AFTER attachment_path,
  ADD COLUMN IF NOT EXISTS attachment_name VARCHAR(255) NULL AFTER attachment_mime,
  ADD COLUMN IF NOT EXISTS attachment_size INT UNSIGNED NULL AFTER attachment_name;
```

- [ ] **Step 3: Make XAMPP connection apply every sorted migration**

After importing `schema.sql`, add this block before importing `seed.sql`:

```powershell
$migrationRoot = Join-Path $backendFull 'database\migrations'
if (Test-Path -LiteralPath $migrationRoot) {
    foreach ($migration in Get-ChildItem -LiteralPath $migrationRoot -Filter '*.sql' -File | Sort-Object Name) {
        $migrationSource = $migration.FullName.Replace('\', '/')
        & $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --default-character-set=utf8mb4 --execute="SOURCE $migrationSource"
        if ($LASTEXITCODE -ne 0) { throw "นำเข้า migration ไม่สำเร็จ: $($migration.Name)" }
    }
}
```

- [ ] **Step 4: Apply and verify the migration twice**

Run:

```powershell
rtk npm run xampp:connect
rtk npm run xampp:connect
rtk C:\xampp\mysql\bin\mysql.exe --host=127.0.0.1 --user=root --database=fitconnect --batch --skip-column-names --execute="SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='fitconnect' AND table_name='messages' AND column_name IN ('attachment_mime','attachment_name','attachment_size')"
```

Expected: both imports succeed and the final query prints `3`.

- [ ] **Step 5: Commit the database upgrade**

```powershell
rtk git add backend/database/schema.sql backend/database/migrations/20260801_chat_attachment_metadata.sql scripts/connect-xampp.ps1
rtk git commit -m "feat: store chat attachment metadata"
```

### Task 3: Extend booking quote, payload, and trainer completion API

**Files:**
- Modify: `scripts/api-workflow-smoke.ps1:132-206`
- Modify: `backend/src/Handlers.php:281-408`
- Modify: `backend/src/Handlers.php:742-757`

**Interfaces:**
- Consumes: `WorkflowRules::normalizeMoney()` and `WorkflowRules::assertTrainerCompletion()`
- Produces: `GET /v1/bookings` fields `quotedPrice`, `chatRoomId`, `payment`, `review`, and `actions`
- Produces: trainer transitions `pending_trainer -> awaiting_payment` with `quotedPrice` and `confirmed -> completed` after the end time

- [ ] **Step 1: Update the booking smoke test to require a quote**

Change the accepted request and assertions:

```powershell
$accepted = (
    Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($acceptedBooking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'awaiting_payment'; quotedPrice = 1200 } | ConvertTo-Json)
).data
Assert-True ($accepted.status -eq 'awaiting_payment') 'Trainer acceptance must move booking to awaiting_payment'
Assert-True ([decimal]$accepted.quotedPrice -eq 1200) 'Trainer acceptance must save the final quote'

$memberBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders).data
$memberView = $memberBookings | Where-Object { $_.id -eq $acceptedBooking.id } | Select-Object -First 1
Assert-True ([decimal]$memberView.quotedPrice -eq 1200) 'Member booking payload must expose the final quote'
Assert-True ($memberView.chatRoomId -gt 0) 'Booking payload must expose its chat room'
Assert-True ($memberView.actions.canPay) 'Accepted member booking must allow payment'
```

- [ ] **Step 2: Run the booking scenario and verify quote assertions fail**

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario booking
```

Expected: FAIL because the acceptance response does not contain `quotedPrice`.

- [ ] **Step 3: Implement the quote and role-aware booking payload**

Extend the booking SELECT with `b.quoted_price`, `cr.id AS chat_room_id`, latest payment, and review joins. Pass the role into the payload mapper:

```php
Http::json(array_map(
    fn(array $row): array => $this->bookingPayload($row, (string) $user['role']),
    $rows
));
```

Use this exact action contract in `bookingPayload()`:

```php
$acceptedStatuses = ['awaiting_payment', 'payment_review', 'confirmed', 'completed'];
$isMember = $role === 'member';
$isTrainer = $role === 'trainer';
$hasReview = $row['review_id'] !== null;
$appointmentEnded = strtotime($row['ends_at'] . ' UTC') <= time();

'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
'chatRoomId' => $role === 'admin' || $row['chat_room_id'] === null ? null : (int) $row['chat_room_id'],
'actions' => [
    'canPay' => $isMember && $row['status'] === 'awaiting_payment',
    'canReadChat' => $role !== 'admin' && $row['status'] !== 'pending_trainer',
    'canSendChat' => $role !== 'admin' && in_array($row['status'], $acceptedStatuses, true),
    'canComplete' => $isTrainer && $row['status'] === 'confirmed' && $row['payment_status'] === 'approved' && $appointmentEnded,
    'canReview' => $isMember && $row['status'] === 'completed' && !$hasReview,
],
```

For trainer acceptance, normalize and persist the quote in the same transaction:

```php
$quotedPrice = null;
if ($newStatus === 'awaiting_payment') {
    $quotedPrice = WorkflowRules::normalizeMoney($input['quotedPrice'] ?? null, 'quotedPrice');
}
$pdo->prepare('UPDATE bookings SET status = ?, quoted_price = COALESCE(?, quoted_price), updated_at = UTC_TIMESTAMP() WHERE id = ?')
    ->execute([$newStatus, $quotedPrice, $booking['id']]);
```

For trainer completion, select `payment_status` and `ends_at`, call `assertTrainerCompletion()`, keep the slot `booked`, and remove `confirmed -> completed` from admin transitions.

- [ ] **Step 4: Run PHP syntax, rules, and booking smoke tests**

```powershell
rtk C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario booking
```

Expected: all commands exit `0` and the smoke script prints `PASS API workflow scenario: booking`.

- [ ] **Step 5: Commit the booking aggregate extension**

```powershell
rtk git add backend/src/Handlers.php scripts/api-workflow-smoke.ps1
rtk git commit -m "feat: add trainer quotes and completion rules"
```

### Task 4: Make payment upload and admin decisions transactional

**Files:**
- Create: `scripts/api-payment-chat-review-smoke.ps1`
- Modify: `backend/src/Handlers.php:410-437`
- Modify: `backend/src/Handlers.php:545-642`
- Modify: `backend/src/Handlers.php:770-798`

**Interfaces:**
- Consumes: `WorkflowRules::normalizeMoney()` and `WorkflowRules::assertPaymentDecision()`
- Produces: multipart `POST /v1/payments` with `bookingId`, `amount`, and `slip`
- Produces: detailed `AdminQueue.payments`
- Produces: atomic admin approve/reject transitions with slot booking on approval

- [ ] **Step 1: Create a failing live payment scenario**

Create a script with `payment`, `chat`, `review`, and `all` scenarios. In the payment scenario, create a future slot and booking, accept it with `quotedPrice = 1200`, then upload a real repository image with `curl.exe`:

```powershell
$slipPath = (Resolve-Path (Join-Path $PSScriptRoot '..\public\demo\trainer-a.png')).Path
$paymentJson = & curl.exe --silent --show-error --fail-with-body `
    -H "Authorization: Bearer $($member.token)" `
    -F "bookingId=$($booking.id)" `
    -F "amount=1200" `
    -F "slip=@$slipPath;type=image/png" `
    "$ApiUrl/v1/payments"
$payment = ($paymentJson | ConvertFrom-Json).data
Assert-True ($payment.status -eq 'reviewing') 'Payment must enter reviewing'

$queue = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/admin/review-queue" -Headers $adminHeaders).data
$queuePayment = $queue.payments | Where-Object { $_.bookingId -eq $booking.id } | Select-Object -First 1
Assert-True ([decimal]$queuePayment.quotedPrice -eq 1200) 'Admin queue must show the quote'
Assert-True ([decimal]$queuePayment.amount -eq 1200) 'Admin queue must show the transferred amount'
```

Also create a second booking that is rejected without a note and assert HTTP `422`.

- [ ] **Step 2: Run the payment scenario and verify the amount assertion fails**

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario payment
```

Expected: FAIL because the current upload does not persist `amount` or return detailed queue fields.

- [ ] **Step 3: Implement locked upload, queue detail, and payment decisions**

In `payment()`:

```php
Http::requireFields($input, ['bookingId', 'amount']);
$amount = WorkflowRules::normalizeMoney($input['amount'], 'amount');
$file = $this->saveUpload(
    'slip',
    ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    5 * 1024 * 1024,
    'payments'
);
```

Update the shared upload errors so an oversized file throws HTTP `413` with `FILE_TOO_LARGE`, while a detected MIME outside the allowlist throws HTTP `415` with `INVALID_FILE_TYPE`. Keep missing files and transport failures as validation errors.

Lock the booking inside the transaction, insert `amount`, update booking, and insert history. Wrap the transaction in `try/catch`; if it fails, call a private `removeUpload(string $relativePath): void` that resolves the path under `backend/uploads` before unlinking it.

Expand the admin queue query to return trainer, appointment, location, quote, amount, and numeric difference. Map these exact fields:

```php
'trainerName' => $row['trainer_name'],
'startsAt' => $this->iso($row['starts_at']),
'endsAt' => $this->iso($row['ends_at']),
'location' => $row['location_text'],
'quotedPrice' => (float) $row['quoted_price'],
'amount' => (float) $row['amount'],
'difference' => (float) $row['amount'] - (float) $row['quoted_price'],
```

In `decidePayment()`, call:

```php
$note = trim((string) ($input['note'] ?? ''));
WorkflowRules::assertPaymentDecision(
    (string) $payment['status'],
    (string) $payment['booking_status'],
    $decision,
    $note
);
```

On approval set payment `approved`, booking `confirmed`, payment status `approved`, slot `booked`, and history. On rejection set payment `rejected`, booking `awaiting_payment`, payment status `rejected`, preserve slot `held`, and write the rejection reason to payment and history.

- [ ] **Step 4: Run the payment scenario twice for approve and retry behavior**

```powershell
rtk C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario payment
```

Expected: approved booking is `confirmed`; rejected payment retains its note and the member can submit a new payment row.

- [ ] **Step 5: Commit payment handling**

```powershell
rtk git add backend/src/Handlers.php scripts/api-payment-chat-review-smoke.ps1
rtk git commit -m "feat: verify member payment evidence"
```

### Task 5: Add protected chat messages and attachments

**Files:**
- Modify: `backend/index.php:48-50`
- Modify: `backend/src/Handlers.php:439-469`
- Modify: `backend/src/Handlers.php:758-798`
- Modify: `scripts/api-payment-chat-review-smoke.ps1`

**Interfaces:**
- Consumes: `WorkflowRules::assertChatWritable()`
- Produces: `GET /v1/chat-rooms/{roomId}/messages?afterId={id}`
- Produces: multipart `POST /v1/chat-rooms/{roomId}/messages`
- Produces: `GET /v1/chat-rooms/{roomId}/messages/{messageId}/attachment`

- [ ] **Step 1: Add a failing chat scenario to the live smoke script**

Create an accepted booking, obtain `chatRoomId`, post text, post a PNG attachment, then fetch after the first id:

```powershell
$textBody = @{ message = 'พบกันตามเวลานัดครับ' } | ConvertTo-Json
$first = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages" -Headers $memberHeaders -ContentType 'application/json' -Body $textBody).data

$imagePath = (Resolve-Path (Join-Path $PSScriptRoot '..\public\demo\trainer-b.png')).Path
& curl.exe --silent --show-error --fail-with-body `
    -H "Authorization: Bearer $($trainer.token)" `
    -F "message=แผนการฝึก" `
    -F "attachment=@$imagePath;type=image/png" `
    "$ApiUrl/v1/chat-rooms/$roomId/messages" | Out-Null

$newMessages = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/chat-rooms/$roomId/messages?afterId=$($first.id)" -Headers $memberHeaders).data
Assert-True ($newMessages.Count -eq 1) 'Polling must return only messages after the cursor'
Assert-True ($newMessages[0].attachment.mime -eq 'image/png') 'Attachment metadata must be returned'
```

Assert an unrelated member gets `403`, and a cancelled booking can read but gets `409` when posting.

- [ ] **Step 2: Run the chat scenario and verify multipart posting fails**

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario chat
```

Expected: FAIL because the current handler requires JSON text and exposes raw attachment paths.

- [ ] **Step 3: Implement participant-only chat and protected attachments**

Add the route before the generic message routes:

```php
if ($method === 'GET' && preg_match('#^/v1/chat-rooms/(\d+)/messages/(\d+)/attachment$#', $path, $matches) === 1) {
    $handlers->chatAttachment($matches[1], $matches[2]);
}
```

Make `requireChatParticipant()` select booking status and reject every role except the owning member or trainer. In `messages()`, validate `afterId` as a non-negative integer, use `m.id > ?`, update `read_at` for messages from the other user, and return:

```php
'attachment' => $row['attachment_path'] === null ? null : [
    'name' => $row['attachment_name'],
    'mime' => $row['attachment_mime'],
    'size' => (int) $row['attachment_size'],
    'url' => '/v1/chat-rooms/' . $room['id'] . '/messages/' . $row['id'] . '/attachment',
],
'readAt' => $row['read_at'] === null ? null : $this->iso($row['read_at']),
```

Change `saveUpload()` to accept `bool $required = true` and return `?array`. For optional chat files, return `null` when no file exists. Include sanitized original name and size:

```php
$rawName = trim((string) basename((string) $file['name']));
$safeName = preg_replace('/[^\pL\pN._ -]+/u', '_', $rawName) ?? '';
$displayName = mb_substr($safeName, 0, 255);
return [
    'path' => 'uploads/' . $directory . '/' . $filename,
    'mime' => $mime,
    'name' => $displayName === '' ? 'ไฟล์แนบ' : $displayName,
    'size' => (int) $file['size'],
];
```

In `sendMessage()`, accept JSON text or multipart data, call `assertChatWritable()`, require text or attachment, enforce 4,000 text characters, and insert all attachment columns. Add `chatAttachment()` with the same safe path resolution as `adminFile()` plus `Content-Type`, `Content-Length`, `Content-Disposition`, `X-Content-Type-Options: nosniff`, and `Cache-Control: private, no-store`.

- [ ] **Step 4: Run syntax, rule, and live chat tests**

```powershell
rtk C:\xampp\php\php.exe -l backend\index.php
rtk C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario chat
```

Expected: text and image messages persist; cursor polling returns only the new message; unauthorized attachment access is `403`.

- [ ] **Step 5: Commit live chat API support**

```powershell
rtk git add backend/index.php backend/src/Handlers.php scripts/api-payment-chat-review-smoke.ps1
rtk git commit -m "feat: add protected booking chat attachments"
```

### Task 6: Harden one-time review publishing

**Files:**
- Modify: `backend/src/Handlers.php:471-496`
- Modify: `scripts/api-payment-chat-review-smoke.ps1`

**Interfaces:**
- Consumes: `WorkflowRules::assertReviewSubmission()`
- Produces: one published review per completed booking through `POST /v1/reviews`

- [ ] **Step 1: Add failing review validations to the smoke script**

For a completed booking, send an empty comment and expect `422`, then send a valid review and expect duplicate `409`:

```powershell
Expect-Status 422 {
    Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ bookingId = $booking.id; rating = 5; comment = ' ' } | ConvertTo-Json)
}

$review = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ bookingId = $booking.id; rating = 5; comment = 'อธิบายชัดเจนและตรงเวลา' } | ConvertTo-Json)).data
Assert-True ($review.status -eq 'published') 'Valid review must publish immediately'

Expect-Status 409 {
    Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/reviews" -Headers $memberHeaders -ContentType 'application/json' -Body (@{ bookingId = $booking.id; rating = 4; comment = 'ส่งซ้ำ' } | ConvertTo-Json)
}
```

- [ ] **Step 2: Run the review scenario and verify the empty comment is accepted incorrectly**

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario review
```

Expected: FAIL at the empty-comment assertion.

- [ ] **Step 3: Validate review ownership and content before insert**

Fetch the member-owned booking without filtering status in SQL, then call:

```php
$comment = trim((string) $input['comment']);
WorkflowRules::assertReviewSubmission((string) $booking['status'], $rating, $comment);
```

Keep the unique-key catch for `REVIEW_EXISTS` and return the created review fields:

```php
Http::json([
    'bookingId' => $input['bookingId'],
    'rating' => $rating,
    'comment' => $comment,
    'status' => 'published',
], 201);
```

- [ ] **Step 4: Run PHP rules and review smoke tests**

```powershell
rtk C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario review
```

Expected: empty review is `422`, first valid review is `201`, and duplicate review is `409`.

- [ ] **Step 5: Commit review hardening**

```powershell
rtk git add backend/src/Handlers.php scripts/api-payment-chat-review-smoke.ps1
rtk git commit -m "feat: publish one review per completed booking"
```

### Task 7: Define frontend contracts and authenticated multipart behavior

**Files:**
- Modify: `lib/types.ts:1-104`
- Modify: `lib/api.ts:15-75`
- Modify: `lib/api.test.ts:1-37`
- Modify: existing booking fixtures in `components/trainer-workbench.test.tsx`

**Interfaces:**
- Produces: `PaymentSummary`, `ReviewSummary`, `BookingActions`, `ChatAttachment`, `ChatMessage`, and expanded `Booking`
- Produces: `authenticatedRequest<T>()` that preserves FormData boundary handling
- Produces: `openProtectedFile(path)` for admin slips and chat attachments

- [ ] **Step 1: Add a FormData test and a failing expanded Booking contract**

Update the imports in `lib/api.test.ts`:

```ts
import { apiRequest, authHeaders, authenticatedRequest } from "@/lib/api";
import type { Booking } from "@/lib/types";
```

Add a concrete booking contract. Typecheck must reject its new fields before `Booking` is expanded:

```ts
const bookingContract: Booking = {
  id: "BK-CONTRACT",
  trainer: { id: 1, slug: "trainer-one", displayName: "เทรนเนอร์หนึ่ง" },
  member: { displayName: "สมาชิกหนึ่ง" },
  startsAt: "2026-08-10T02:00:00Z",
  endsAt: "2026-08-10T03:00:00Z",
  location: "สถานที่ทดสอบ",
  status: "awaiting_payment",
  paymentStatus: "not_submitted",
  quotedPrice: 1200,
  chatRoomId: 33,
  payment: null,
  review: null,
  actions: { canPay: true, canReadChat: true, canSendChat: true, canComplete: false, canReview: false },
  createdAt: "2026-08-01T00:00:00Z",
  demo: false,
};

it("carries the post-booking action contract", () => {
  expect(bookingContract.actions.canPay).toBe(true);
  expect(bookingContract.chatRoomId).toBe(33);
});
```

Add the authenticated FormData request test:

```ts
it("adds bearer auth without replacing a FormData content type", async () => {
  localStorage.setItem("fitconnect_token", "member-token");
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: vi.fn().mockResolvedValue({ data: { status: "reviewing" } }),
  });
  vi.stubGlobal("fetch", fetchMock);
  const body = new FormData();
  body.set("amount", "1200");

  await authenticatedRequest("/v1/payments", { method: "POST", body });

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/v1/payments"),
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer member-token" }) }),
  );
  const request = fetchMock.mock.calls[0][1] as RequestInit;
  expect(new Headers(request.headers).has("Content-Type")).toBe(false);
});
```

- [ ] **Step 2: Run the API test and typecheck to verify the Booking contract fails**

```powershell
rtk npm test -- lib/api.test.ts
rtk npm run typecheck
```

Expected: the request test passes, then typecheck FAILS because `quotedPrice`, `chatRoomId`, `payment`, `review`, and `actions` are not yet fields of `Booking`.

- [ ] **Step 3: Add exact shared contracts**

```ts
export type PaymentSummary = {
  id: number;
  amount: number;
  status: "reviewing" | "approved" | "rejected";
  reviewNote: string | null;
  submittedAt: string;
};

export type ReviewSummary = {
  rating: number;
  comment: string;
  status: "published" | "hidden" | "reported";
  createdAt: string;
};

export type BookingActions = {
  canPay: boolean;
  canReadChat: boolean;
  canSendChat: boolean;
  canComplete: boolean;
  canReview: boolean;
};

export type ChatAttachment = { name: string; mime: string; size: number; url: string };

export type ChatMessage = {
  id: number;
  message: string;
  attachment: ChatAttachment | null;
  createdAt: string;
  readAt: string | null;
  sender: { id: number; displayName: string };
};
```

Extend `Booking` with `quotedPrice: number | null`, `chatRoomId: number | null`, `payment: PaymentSummary | null`, `review: ReviewSummary | null`, and `actions: BookingActions`. Expand `AdminQueue.payments` with trainer, appointment, location, quote, amount, difference, and submitted time.

Keep the current `apiRequest()` rule that omits `Content-Type` whenever `body instanceof FormData`. Update every booking fixture in `components/trainer-workbench.test.tsx` with concrete `quotedPrice`, `chatRoomId`, `payment`, `review`, and `actions` values.

- [ ] **Step 4: Run type and API tests**

```powershell
rtk npm test -- lib/api.test.ts
rtk npm run typecheck
```

Expected: API tests pass and typecheck exits `0`.

- [ ] **Step 5: Commit the browser contracts**

```powershell
rtk git add lib/types.ts lib/api.ts lib/api.test.ts components/trainer-workbench.test.tsx
rtk git commit -m "feat: define post-booking client contracts"
```

### Task 8: Add trainer quote and completion controls

**Files:**
- Modify: `components/trainer-workbench.tsx:1-252`
- Modify: `components/trainer-workbench.test.tsx:1-65`

**Interfaces:**
- Consumes: `Booking.quotedPrice` and `Booking.actions.canComplete`
- Produces: quote-bearing trainer acceptance request
- Produces: trainer-only completion request

- [ ] **Step 1: Write failing trainer interaction tests**

Add one test that enters `1200` before acceptance and one completed-time action test:

```ts
fireEvent.change(screen.getByLabelText("ราคาสุดท้ายสำหรับคำขอ BK-TEST"), { target: { value: "1200" } });
fireEvent.click(screen.getByRole("button", { name: "ตอบรับคำขอ BK-TEST" }));
await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
  "/v1/bookings/BK-TEST/status",
  { method: "PATCH", body: JSON.stringify({ status: "awaiting_payment", quotedPrice: "1200" }) },
));
```

For a confirmed fixture with `actions.canComplete = true`, click `ฝึกเสร็จแล้ว BK-DONE` and expect `{ status: "completed" }`.

- [ ] **Step 2: Run the trainer component test and verify the quote field is missing**

```powershell
rtk npm test -- components/trainer-workbench.test.tsx
```

Expected: FAIL because the labeled price input does not exist.

- [ ] **Step 3: Implement quote state and completion actions**

Add per-booking quote state:

```ts
const [quotedPrices, setQuotedPrices] = useState<Record<string, string>>({});
```

For acceptance send:

```ts
body: JSON.stringify({
  status: "awaiting_payment",
  quotedPrice: quotedPrices[bookingId] ?? "",
}),
```

Render a labeled number input with `min="0.01"`, `step="0.01"`, and the booking id in the label. Disable acceptance until the numeric value is positive. Add a second ruled list for confirmed bookings and implement:

```ts
async function completeBooking(bookingId: string) {
  setBusy(`booking-${bookingId}`);
  try {
    await authenticatedRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });
    await loadBookings();
    setActionNotice(`บันทึกว่าคำขอ ${bookingId} ฝึกเสร็จแล้ว`);
  } finally {
    setBusy(null);
  }
}
```

Use `booking.actions.canComplete` for the enabled button. When false, show the formatted end time instead of guessing from the browser clock.

- [ ] **Step 4: Run trainer tests and typecheck**

```powershell
rtk npm test -- components/trainer-workbench.test.tsx
rtk npm run typecheck
```

Expected: both trainer actions send exact status payloads and all tests pass.

- [ ] **Step 5: Commit the trainer controls**

```powershell
rtk git add components/trainer-workbench.tsx components/trainer-workbench.test.tsx
rtk git commit -m "feat: quote and complete trainer bookings"
```

### Task 9: Build member payment and review surfaces

**Files:**
- Create: `components/payment-panel.tsx`
- Create: `components/payment-panel.test.tsx`
- Create: `components/review-form.tsx`
- Create: `components/review-form.test.tsx`
- Modify: `components/role-dashboard.tsx:1-133`

**Interfaces:**
- Consumes: expanded `Booking` and `authenticatedRequest()`
- Produces: `PaymentPanel({ booking, onUpdated })`
- Produces: `ReviewForm({ booking, onUpdated })`
- Produces: member ledger for every booking, not only the first row

- [ ] **Step 1: Write failing payment and review tests**

Payment test:

```ts
render(<PaymentPanel booking={awaitingPaymentBooking} onUpdated={onUpdated} />);
fireEvent.change(screen.getByLabelText("ยอดที่โอน"), { target: { value: "1200" } });
fireEvent.change(screen.getByLabelText("หลักฐานการโอน"), {
  target: { files: [new File(["image"], "slip.png", { type: "image/png" })] },
});
fireEvent.click(screen.getByRole("button", { name: "ส่งสลิปให้ตรวจ" }));
await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
  "/v1/payments",
  expect.objectContaining({ method: "POST", body: expect.any(FormData) }),
));
```

Review test:

```ts
render(<ReviewForm booking={completedBooking} onUpdated={onUpdated} />);
fireEvent.click(screen.getByRole("radio", { name: "5 ดาว" }));
fireEvent.change(screen.getByLabelText("ความคิดเห็น"), { target: { value: "อธิบายชัดเจนและตรงเวลา" } });
fireEvent.click(screen.getByRole("button", { name: "ส่งรีวิว" }));
await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
  "/v1/reviews",
  { method: "POST", body: JSON.stringify({ bookingId: completedBooking.id, rating: 5, comment: "อธิบายชัดเจนและตรงเวลา" }) },
));
```

- [ ] **Step 2: Run the new tests and verify components are missing**

```powershell
rtk npm test -- components/payment-panel.test.tsx components/review-form.test.tsx
```

Expected: FAIL because both component modules do not exist.

- [ ] **Step 3: Implement the two focused forms and member ledger**

`PaymentPanel` must show trainer, quote, amount, selected filename, accepted types, 5 MB rule, rejected note, field errors, busy state, and retry. Build FormData exactly:

```ts
const body = new FormData();
body.set("bookingId", booking.id);
body.set("amount", amount);
body.set("slip", slip);
await authenticatedRequest("/v1/payments", { method: "POST", body });
await onUpdated();
```

Use `accept="image/jpeg,image/png,image/webp,application/pdf"` and reject a selected file over `5 * 1024 * 1024` before sending.

`ReviewForm` uses a fieldset with five radio inputs, a labeled textarea, inline errors, busy state, success announcement, and `booking.actions.canReview`.

Refactor `RoleDashboard` to render all bookings as ledger rows. Each row shows quote, payment status, rejected note, the relevant form, and chat link only when `actions.canReadChat` is true:

```tsx
<Link href={`/chat?booking=${encodeURIComponent(booking.id)}`}>เปิดการสนทนา</Link>
```

Remove the nested `PaymentUpload` function after all behavior moves to `PaymentPanel`.

- [ ] **Step 4: Run member tests, existing tests, and typecheck**

```powershell
rtk npm test -- components/payment-panel.test.tsx components/review-form.test.tsx
rtk npm test
rtk npm run typecheck
```

Expected: payment and review tests pass, and the existing booking/dashboard tests remain green.

- [ ] **Step 5: Commit member payment and review UI**

```powershell
rtk git add components/payment-panel.tsx components/payment-panel.test.tsx components/review-form.tsx components/review-form.test.tsx components/role-dashboard.tsx
rtk git commit -m "feat: add member payment and review forms"
```

### Task 10: Expand the admin payment review queue

**Files:**
- Modify: `components/admin-review-queue.tsx:1-220`
- Modify: `components/admin-review-queue.test.tsx:1-50`

**Interfaces:**
- Consumes: detailed `AdminQueue.payments`
- Produces: quote-versus-transfer evidence row and explicit payment rejection note

- [ ] **Step 1: Add failing admin payment tests**

Add a payment fixture with quote `1200`, amount `1000`, difference `-200`, trainer, appointment, location, and file URL. Assert those facts render, then test rejection:

```ts
fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" }));
expect(screen.getByText("กรุณาระบุเหตุผลที่สลิปไม่ผ่าน")).toBeInTheDocument();
expect(authenticatedRequest).toHaveBeenCalledTimes(1);

fireEvent.change(screen.getByLabelText("ผลตรวจสลิป PAY-000021"), { target: { value: "ยอดโอนไม่ตรงกับราคาที่แจ้ง" } });
fireEvent.click(screen.getByRole("button", { name: "ไม่อนุมัติสลิป PAY-000021" }));
await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
  "/v1/admin/payments/21/reject",
  { method: "POST", body: JSON.stringify({ note: "ยอดโอนไม่ตรงกับราคาที่แจ้ง" }) },
));
```

- [ ] **Step 2: Run the admin test and verify the fixed rejection text fails**

```powershell
rtk npm test -- components/admin-review-queue.test.tsx
```

Expected: FAIL because the current component sends a hard-coded rejection note.

- [ ] **Step 3: Render evidence details and use per-payment notes**

Create separate `paymentNotes` state keyed by payment id. Render booking id, member, trainer, appointment, location, quote, transferred amount, and signed difference using `Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" })`.

Require a trimmed note only on reject. Use accessible button names containing the payment code and send the user-entered note. Keep row-level busy, stale `409` refresh, protected slip opening, and success focus behavior.

- [ ] **Step 4: Run admin tests and typecheck**

```powershell
rtk npm test -- components/admin-review-queue.test.tsx
rtk npm run typecheck
```

Expected: payment evidence facts render and rejection never sends without a note.

- [ ] **Step 5: Commit the admin review surface**

```powershell
rtk git add components/admin-review-queue.tsx components/admin-review-queue.test.tsx
rtk git commit -m "feat: review payment evidence in admin queue"
```

### Task 11: Replace the chat demo with the live workbench

**Files:**
- Create: `components/chat-workbench.tsx`
- Create: `components/chat-workbench.test.tsx`
- Modify: `app/chat/page.tsx:1-5`
- Delete: `components/chat-demo.tsx`

**Interfaces:**
- Consumes: `GET /v1/bookings`, chat message endpoints, `ChatMessage`, and `openProtectedFile()`
- Produces: `ChatWorkbench({ initialBookingId?: string })`
- Produces: 5-second visible-tab polling and read-only cancelled rooms

- [ ] **Step 1: Write failing chat workbench tests with fake timers**

```ts
vi.useFakeTimers();
render(<ChatWorkbench initialBookingId="BK-CHAT" />);
await screen.findByText("เทรนเนอร์ทดสอบ");
expect(authenticatedRequest).toHaveBeenCalledWith("/v1/chat-rooms/33/messages?afterId=0");

await vi.advanceTimersByTimeAsync(5000);
expect(authenticatedRequest).toHaveBeenCalledWith("/v1/chat-rooms/33/messages?afterId=8");
```

Add tests for multipart send with a PDF, file removal before send, protected attachment opening, and a cancelled booking that shows history while disabling the composer.

- [ ] **Step 2: Run the chat tests and verify the module is missing**

```powershell
rtk npm test -- components/chat-workbench.test.tsx
```

Expected: FAIL because `chat-workbench.tsx` does not exist.

- [ ] **Step 3: Implement the live three-zone workbench**

Load bookings, keep rows with non-null `chatRoomId` and `actions.canReadChat`, select the query-string booking when present, and load its messages with cursor `0`.

Polling effect:

```ts
useEffect(() => {
  if (!selectedRoomId) return;
  const poll = () => {
    if (document.visibilityState === "visible") void loadMessages(selectedRoomId, lastMessageIdRef.current);
  };
  const timer = window.setInterval(poll, 5000);
  document.addEventListener("visibilitychange", poll);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", poll);
  };
}, [selectedRoomId, loadMessages]);
```

Merge messages by id and sort ascending so polling cannot duplicate or reorder them. Send FormData containing trimmed message and optional attachment. Clear composer only after `201`, then request messages after the previous cursor. Display attachments with name, MIME, readable size, and an `openProtectedFile()` action.

Render three zones on desktop: booking rooms, message thread/composer, and booking facts. For cancellation, keep the thread and replace the composer with `การจองนี้ถูกยกเลิกแล้ว จึงส่งข้อความเพิ่มไม่ได้`.

Update `app/chat/page.tsx` to read the Next.js async search params, render `ChatWorkbench`, remove `DemoNotice`, and remove the final `ChatDemo` import before deleting `components/chat-demo.tsx`:

```tsx
import { ChatWorkbench } from "@/components/chat-workbench";

export const metadata = { title: "การสนทนา" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;
  return (
    <main className="page-shell chat-page">
      <section className="compact-page-heading"><h1>การสนทนาและรายละเอียดนัดหมาย</h1></section>
      <ChatWorkbench initialBookingId={booking} />
    </main>
  );
}
```

- [ ] **Step 4: Run chat, type, and build tests**

```powershell
rtk npm test -- components/chat-workbench.test.tsx
rtk npm run typecheck
rtk npm run build
```

Expected: polling uses the latest cursor, cancelled chat is read-only, and the production build has no missing demo import.

- [ ] **Step 5: Commit the live chat workbench**

```powershell
rtk git add app/chat/page.tsx components/chat-workbench.tsx components/chat-workbench.test.tsx components/chat-demo.tsx
rtk git commit -m "feat: replace demo chat with booking rooms"
```

### Task 12: Apply the FitConnect visual system and responsive states

**Files:**
- Modify: `components/status-badge.tsx:1-49`
- Modify: `app/globals.css:1681-2320`

**Interfaces:**
- Consumes: UI classes introduced in Tasks 8 to 11 and tokens from `tokens.css`
- Produces: responsive workbench behavior at 1280, 768, 375, and 320 pixels

- [ ] **Step 1: Add a visible UI-state checklist before styling**

Create a checklist in the task notes while executing and mark each state only after inspection:

```text
member payment: ready / uploading / reviewing / rejected / approved
member review: ready / invalid / submitting / published
admin payment: queued / busy / rejected-note error / stale
trainer booking: quote required / accepted / completion locked / completion ready
chat: loading / empty / active / attachment / polling error / cancelled
```

Expected before styling: the new controls work but the three-zone and narrow layouts are not yet correct.

- [ ] **Step 2: Add token-based ruled layouts and status copy**

Keep color values in tokens and use existing button, field, badge, queue, and ledger primitives. Add focused classes for `.member-booking-ledger`, `.payment-panel`, `.review-form`, `.payment-evidence`, `.chat-workbench`, `.chat-room-list`, `.chat-thread`, `.chat-booking-facts`, and `.chat-composer`.

The core chat layout must use named regions rather than equal cards:

```css
.chat-workbench {
  display: grid;
  grid-template-columns: minmax(14rem, 0.72fr) minmax(22rem, 1.65fr) minmax(15rem, 0.78fr);
  border-block: 1px solid var(--color-rule);
  background: var(--color-paper);
}

.chat-workbench > * + * {
  border-inline-start: 1px solid var(--color-rule);
}
```

Use `.button--accent` once per active form, small radii, solid surfaces, monospace for ids/time/price, and status text alongside icons. Update labels to `รอชำระเงิน`, `รอตรวจสลิป`, `ยืนยันการชำระแล้ว`, and `ฝึกเสร็จแล้ว`.

- [ ] **Step 3: Add responsive and accessibility behavior**

At the existing 58rem breakpoint, reduce chat to room list plus thread and move booking facts into a disclosure. At 38rem, show room list first and the selected conversation full-width. Ensure no horizontal overflow at 320 pixels, input labels remain visible, buttons retain a 44px minimum target, focus uses the existing 3px ring, and reduced motion disables nonessential transitions.

- [ ] **Step 4: Run automated and browser verification**

```powershell
rtk npm test
rtk npm run lint
rtk npm run typecheck
rtk npm run build
```

Then start the development server and inspect member, trainer, admin, and chat pages at 1280 x 800, 768 x 900, 375 x 812, and 320 x 568. Verify keyboard-only operation, 200 percent zoom, no horizontal overflow, clear focus, readable statuses, and reduced motion.

Expected: automated checks exit `0`; every checklist state has a visible next action; browser console has no errors or warnings.

- [ ] **Step 5: Commit the visual integration**

```powershell
rtk git add components/status-badge.tsx app/globals.css
rtk git commit -m "style: shape post-booking workbenches"
```

### Task 13: Add end-to-end audit and phpMyAdmin instructions

**Files:**
- Create: `backend/database/audit_booking.sql`
- Create: `scripts/audit-booking.ps1`
- Modify: `scripts/api-payment-chat-review-smoke.ps1`
- Modify: `backend/README.md:1-62`
- Modify: `package.json:5-13`

**Interfaces:**
- Produces: `npm run smoke:postbooking`
- Produces: `npm run audit:booking -- -BookingId BK-SMOKE-ID`
- Produces: deterministic evidence that booking, history, payments, room, messages, and review share one booking id

- [ ] **Step 1: Write the audit SQL and wrapper before the final flow passes**

Create `audit_booking.sql` using the session variable set by the wrapper:

```sql
SELECT b.id, b.public_id, b.status, b.payment_status, b.quoted_price, b.starts_at, b.ends_at
FROM bookings b
WHERE b.public_id = @booking_public_id;

SELECT h.id, h.from_status, h.to_status, h.note, h.created_at
FROM booking_status_history h
JOIN bookings b ON b.id = h.booking_id
WHERE b.public_id = @booking_public_id
ORDER BY h.id;

SELECT p.id, p.amount, p.status, p.review_note, p.submitted_at, p.reviewed_at
FROM payments p
JOIN bookings b ON b.id = p.booking_id
WHERE b.public_id = @booking_public_id
ORDER BY p.id;

SELECT cr.id AS chat_room_id, m.id AS message_id, m.message_text, m.attachment_mime, m.attachment_name, m.attachment_size, m.created_at
FROM chat_rooms cr
JOIN bookings b ON b.id = cr.booking_id
LEFT JOIN messages m ON m.chat_room_id = cr.id
WHERE b.public_id = @booking_public_id
ORDER BY m.id;

SELECT r.id, r.rating, r.comment, r.status, r.created_at
FROM reviews r
JOIN bookings b ON b.id = r.booking_id
WHERE b.public_id = @booking_public_id;
```

In `audit-booking.ps1`, validate `BookingId` with `^BK-[A-Z0-9-]{3,32}$`, resolve `C:\xampp\mysql\bin\mysql.exe`, escape no arbitrary SQL, and run:

```powershell
$sqlPath = (Resolve-Path (Join-Path $PSScriptRoot '..\backend\database\audit_booking.sql')).Path.Replace('\', '/')
& $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --database=fitconnect --table --execute="SET @booking_public_id='$BookingId'; SOURCE $sqlPath"
if ($LASTEXITCODE -ne 0) { throw 'ตรวจข้อมูล booking ไม่สำเร็จ' }
```

Before printing the detail tables, run a batch count query and fail the script when the completed smoke flow is incomplete:

```powershell
$countSql = @"
SELECT
  (SELECT COUNT(*) FROM bookings WHERE public_id = '$BookingId'),
  (SELECT COUNT(*) FROM booking_status_history h JOIN bookings b ON b.id = h.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM chat_rooms cr JOIN bookings b ON b.id = cr.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM messages m JOIN chat_rooms cr ON cr.id = m.chat_room_id JOIN bookings b ON b.id = cr.booking_id WHERE b.public_id = '$BookingId'),
  (SELECT COUNT(*) FROM reviews r JOIN bookings b ON b.id = r.booking_id WHERE b.public_id = '$BookingId');
"@
$counts = (& $mysqlExe --host=127.0.0.1 --port=3306 --user=$DatabaseUser --database=fitconnect --batch --skip-column-names --execute=$countSql) -split "`t"
if ($counts.Count -ne 6 -or [int]$counts[0] -ne 1 -or [int]$counts[1] -lt 7 -or [int]$counts[2] -lt 2 -or [int]$counts[3] -ne 1 -or [int]$counts[4] -lt 2 -or [int]$counts[5] -ne 1) {
    throw "ข้อมูล flow ไม่ครบ: booking=$($counts[0]) history=$($counts[1]) payments=$($counts[2]) rooms=$($counts[3]) messages=$($counts[4]) reviews=$($counts[5])"
}
Write-Host "PASS ข้อมูลทุกขั้นตอนของ $BookingId เชื่อมกันครบ"
```

- [ ] **Step 2: Complete the end-to-end smoke scenario and verify audit initially fails on missing records**

The `all` scenario must perform this exact order:

```text
create future slot and booking
trainer accepts with quotedPrice 1200
member sends text and image attachment
member submits payment evidence
admin rejects with a reason
member submits a second payment
admin approves the second payment
test setup changes only this booking end time to one minute in the past
trainer completes the booking
member publishes a five-star review
audit script checks every table with the returned booking id
```

Run:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario all
```

Expected before final fixes: FAIL at the first missing history, message metadata, payment retry, or review record.

- [ ] **Step 3: Add audit assertions, package commands, and documentation**

The smoke script must query counts after the flow and assert:

```powershell
Assert-True ($historyCount -ge 7) 'Booking must have a complete status history'
Assert-True ($paymentCount -eq 2) 'Rejected and approved payment attempts must remain stored'
Assert-True ($messageCount -ge 2) 'Chat text and attachment must remain stored'
Assert-True ($reviewCount -eq 1) 'Completed booking must have one review'
```

Add package scripts:

```json
"test:php": "C:\\xampp\\php\\php.exe backend/tests/WorkflowRulesTest.php",
"smoke:postbooking": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-payment-chat-review-smoke.ps1 -Scenario all",
"audit:booking": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/audit-booking.ps1"
```

Document all new endpoints, the manual admin review wording, how to run the smoke script, how to pass the printed booking id to `audit:booking`, and how to open phpMyAdmin at `http://localhost/phpmyadmin`, choose `fitconnect`, and filter these tables by the same internal booking id:

```text
bookings
booking_status_history
payments
chat_rooms
messages
reviews
```

- [ ] **Step 4: Run the full verification matrix**

```powershell
rtk npm run xampp:connect
rtk npm run test:php
rtk npm test
rtk npm run lint
rtk npm run typecheck
rtk npm run build
rtk npm run smoke:postbooking
rtk npm run audit:booking -- -BookingId BK-SMOKE-ID
rtk git diff --check
```

Replace `BK-SMOKE-ID` with the exact id printed by the smoke script. Expected: every command exits `0`, the audit prints all six data groups, and `git diff --check` has no output.

- [ ] **Step 5: Commit the audit and documentation**

```powershell
rtk git add backend/database/audit_booking.sql scripts/audit-booking.ps1 scripts/api-payment-chat-review-smoke.ps1 backend/README.md package.json
rtk git commit -m "test: verify post-booking data end to end"
```

---

## Final review gate

Before integration, compare the implementation with every acceptance item in `docs/superpowers/specs/2026-08-01-payment-chat-review-audit-flow-design.md`. Confirm no tracked demo chat remains, no public upload path appears in JSON, every state change has history, and `graphify-out/` is still untracked. Then use `superpowers:verification-before-completion` and `superpowers:finishing-a-development-branch` before offering merge or push actions.
