# Trainer Approval, Availability, and Booking Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real-data FitConnect flow in which an admin reviews a trainer, an approved trainer publishes availability, a member requests an available slot, and the trainer accepts or rejects it safely.

**Architecture:** Keep the existing Next.js client, dependency-free PHP API, XAMPP, and MySQL schema. Put deterministic validation and state-transition rules in a small PHP class, keep authorization and row locking in `Handlers.php`, and split the admin and trainer dashboards into focused client components that consume typed API contracts.

**Tech Stack:** Next.js 16.2.12, React 19.2.8, TypeScript, Vitest, Testing Library, PHP 8 from XAMPP, PDO, MySQL/InnoDB, CSS in `app/globals.css`.

## Global Constraints

- Follow `C:\Users\HP\.codex\RTK.md`: every shell command begins with `rtk`.
- Use `apply_patch` for source-file edits; do not overwrite unrelated working-tree changes.
- Preserve the existing uncommitted authentication/header work in `app/globals.css`, `components/auth-form.tsx`, `components/site-header.tsx`, and `lib/types.ts`.
- Do not add a database migration; the approved schema already contains every required table and state.
- The PHP API is the source of truth for permissions, validation, ownership, transitions, and concurrency.
- Store dates in MySQL as UTC; send ISO 8601 values with `Z`; display dates in Thai local time.
- A rejected booking becomes `cancelled`, and its slot becomes `available` in the same transaction.
- Never submit a booking from an in-memory demo fallback; the selected trainer and slot must be reloaded from the live API.
- Keep payment review, chat, review, and existing authentication behavior working.
- Return `401`, `403`, `404`, `409`, and `422` according to the approved design; never convert failed writes into visual success.
- Each task gets its own focused commit and stages only the files named by that task.

---

## File Structure

### Files to create

- `backend/src/WorkflowRules.php` — pure availability, trainer-review, and trainer-booking transition rules.
- `backend/tests/WorkflowRulesTest.php` — dependency-free PHP unit test runner for `WorkflowRules`.
- `scripts/api-workflow-smoke.ps1` — repeatable local-XAMPP API checks, including conflict and reject-release paths.
- `vitest.config.ts` — Vitest alias and browser-like test environment.
- `tests/setup.ts` — Testing Library cleanup and DOM matchers.
- `lib/api.test.ts` — API error-envelope and authentication-header tests.
- `components/admin-review-queue.tsx` — admin trainer/certificate review plus the existing payment queue.
- `components/admin-review-queue.test.tsx` — admin note, decision, refresh, and file-action tests.
- `components/trainer-workbench.tsx` — trainer approval state, slot management, and booking response queue.
- `components/trainer-workbench.test.tsx` — trainer permission and booking-action tests.
- `components/booking-form.test.tsx` — live trainer/slot loading, booking submit, and stale-slot tests.

### Files to modify

- `backend/index.php` — load `WorkflowRules` and register trainer/availability routes.
- `backend/src/Http.php` — allow `DELETE` through CORS.
- `backend/src/Handlers.php` — implement the approved transactions, payloads, permissions, and state transitions.
- `lib/types.ts` — shared typed contracts for admin review, trainer workspace, slots, and role-aware bookings.
- `lib/api.ts` — structured `ApiError`, authenticated calls, and protected-file opening.
- `package.json` and `package-lock.json` — add the test command and test-only dependencies.
- `components/role-dashboard.tsx` — delegate admin and trainer sections to focused components; preserve member/payment behavior.
- `components/booking-form.tsx` — replace imported demo selection with strict live API resolution.
- `app/trainers/page.tsx` — use a strict live trainer catalog for the booking discovery route.
- `app/globals.css` — states, row layouts, inline errors, and one-column mobile behavior.
- `backend/README.md` and `README.md` — document the new routes and local verification command.

### Files intentionally unchanged

- `backend/database/schema.sql` — no migration is required.
- `lib/demo-data.ts` — remains available for non-writing presentation fallback, but is not imported by the booking form.
- Payment, chat, and review handlers — retain their existing entry points and behavior.

---

### Task 1: Lock Workflow Rules with Dependency-Free PHP Tests

**Files:**

- Create: `backend/src/WorkflowRules.php`
- Create: `backend/tests/WorkflowRulesTest.php`
- Modify: `backend/index.php:4-8`

**Interfaces:**

- Consumes: `HttpException` from `backend/src/Http.php`.
- Produces: `WorkflowRules::parseUtc()`, `WorkflowRules::assertAvailabilityWindow()`, `WorkflowRules::assertTrainerApplicationDecision()`, and `WorkflowRules::trainerBookingSlotState()` for later handlers.

- [ ] **Step 1: Write the failing workflow-rule tests**

Create `backend/tests/WorkflowRulesTest.php` with this complete test harness and cases:

```php
<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Http.php';
require_once __DIR__ . '/../src/WorkflowRules.php';

$tests = [];

function test(string $name, Closure $callback): void
{
    global $tests;
    $tests[$name] = $callback;
}

function assertSameValue(mixed $expected, mixed $actual): void
{
    if ($expected !== $actual) {
        throw new RuntimeException('Expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function expectHttp(int $status, string $code, Closure $callback): void
{
    try {
        $callback();
    } catch (HttpException $error) {
        assertSameValue($status, $error->status);
        assertSameValue($code, $error->errorCode);
        return;
    }
    throw new RuntimeException("Expected HttpException {$status} {$code}");
}

$now = new DateTimeImmutable('2026-08-01T00:00:00.000Z');

test('parses the browser UTC format', function (): void {
    assertSameValue('2026-08-10 02:00:00', WorkflowRules::parseUtc('2026-08-10T02:00:00.000Z', 'startsAt')->format('Y-m-d H:i:s'));
});

test('rejects a non-UTC date', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::parseUtc('2026-08-10 09:00', 'startsAt'));
});

test('accepts a future slot inside two months', function () use ($now): void {
    WorkflowRules::assertAvailabilityWindow(
        $now,
        new DateTimeImmutable('2026-08-10T02:00:00.000Z'),
        new DateTimeImmutable('2026-08-10T03:00:00.000Z')
    );
});

test('rejects past, reversed, and distant slots', function () use ($now): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertAvailabilityWindow($now, $now, $now->modify('+1 hour')));
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertAvailabilityWindow($now, $now->modify('+2 hours'), $now->modify('+1 hour')));
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertAvailabilityWindow($now, $now->modify('+2 months +1 second'), $now->modify('+2 months +1 hour')));
});

test('requires pending trainer review and a rejection note', function (): void {
    WorkflowRules::assertTrainerApplicationDecision('pending', 'approve', '');
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertTrainerApplicationDecision('pending', 'reject', ''));
    expectHttp(409, 'TRAINER_ALREADY_REVIEWED', fn() => WorkflowRules::assertTrainerApplicationDecision('approved', 'reject', 'เอกสารไม่ครบ'));
});

test('maps trainer booking decisions to slot states', function (): void {
    assertSameValue('held', WorkflowRules::trainerBookingSlotState('pending_trainer', 'awaiting_payment'));
    assertSameValue('available', WorkflowRules::trainerBookingSlotState('pending_trainer', 'cancelled'));
    expectHttp(409, 'BOOKING_ALREADY_DECIDED', fn() => WorkflowRules::trainerBookingSlotState('awaiting_payment', 'cancelled'));
    expectHttp(422, 'INVALID_TRAINER_TRANSITION', fn() => WorkflowRules::trainerBookingSlotState('pending_trainer', 'confirmed'));
});

$failures = 0;
foreach ($tests as $name => $callback) {
    try {
        $callback();
        echo "PASS {$name}\n";
    } catch (Throwable $error) {
        $failures++;
        fwrite(STDERR, "FAIL {$name}: {$error->getMessage()}\n");
    }
}

exit($failures === 0 ? 0 : 1);
```

- [ ] **Step 2: Run the test and verify the missing class fails**

Run:

```powershell
rtk cmd /c C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
```

Expected: FAIL because `backend/src/WorkflowRules.php` does not exist.

- [ ] **Step 3: Implement the minimal rule class**

Create `backend/src/WorkflowRules.php`:

```php
<?php
declare(strict_types=1);

final class WorkflowRules
{
    public static function parseUtc(string $value, string $field): DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat(
            '!Y-m-d\TH:i:s.v\Z',
            $value,
            new DateTimeZone('UTC')
        );
        if ($date === false || $date->format('Y-m-d\TH:i:s.v\Z') !== $value) {
            throw new HttpException(422, 'รูปแบบวันและเวลาไม่ถูกต้อง', 'VALIDATION_FAILED', [$field => 'ใช้วันและเวลาแบบ UTC']);
        }
        return $date;
    }

    public static function assertAvailabilityWindow(
        DateTimeImmutable $now,
        DateTimeImmutable $startsAt,
        DateTimeImmutable $endsAt
    ): void {
        if ($startsAt <= $now) {
            throw new HttpException(422, 'เวลาเริ่มต้องอยู่ในอนาคต', 'VALIDATION_FAILED', ['startsAt' => 'เลือกเวลาในอนาคต']);
        }
        if ($endsAt <= $startsAt) {
            throw new HttpException(422, 'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม', 'VALIDATION_FAILED', ['endsAt' => 'เลือกเวลาที่อยู่หลังเวลาเริ่ม']);
        }
        if ($startsAt > $now->modify('+2 months')) {
            throw new HttpException(422, 'สร้างตารางล่วงหน้าได้ไม่เกินสองเดือน', 'VALIDATION_FAILED', ['startsAt' => 'เลือกวันภายในสองเดือน']);
        }
    }

    public static function assertTrainerApplicationDecision(string $current, string $decision, string $note): void
    {
        if ($current !== 'pending') {
            throw new HttpException(409, 'ใบสมัครนี้ได้รับการตัดสินแล้ว', 'TRAINER_ALREADY_REVIEWED');
        }
        if ($decision === 'reject' && trim($note) === '') {
            throw new HttpException(422, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'VALIDATION_FAILED', ['note' => 'จำเป็นต้องระบุเหตุผล']);
        }
    }

    public static function trainerBookingSlotState(string $current, string $target): string
    {
        if (!in_array($target, ['awaiting_payment', 'cancelled'], true)) {
            throw new HttpException(422, 'เทรนเนอร์เลือกสถานะนี้ไม่ได้', 'INVALID_TRAINER_TRANSITION', ['status' => 'เลือกตอบรับหรือปฏิเสธ']);
        }
        if ($current !== 'pending_trainer') {
            throw new HttpException(409, 'คำขอนี้ได้รับการตอบแล้ว', 'BOOKING_ALREADY_DECIDED');
        }
        return $target === 'cancelled' ? 'available' : 'held';
    }
}
```

Add this require before `Handlers.php` in `backend/index.php`:

```php
require_once __DIR__ . '/src/WorkflowRules.php';
```

- [ ] **Step 4: Run unit tests and syntax checks**

Run:

```powershell
rtk cmd /c C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk cmd /c C:\xampp\php\php.exe -l backend\src\WorkflowRules.php
rtk cmd /c C:\xampp\php\php.exe -l backend\index.php
```

Expected: every test prints `PASS`; both syntax checks report no errors.

- [ ] **Step 5: Commit the rules and tests**

```powershell
rtk git add backend/src/WorkflowRules.php backend/tests/WorkflowRulesTest.php backend/index.php
rtk git commit -m "test: define trainer workflow rules"
```

---

### Task 2: Add the Trainer Workspace and Availability API

**Files:**

- Create: `scripts/api-workflow-smoke.ps1`
- Modify: `backend/index.php:34-49`
- Modify: `backend/src/Http.php:26`
- Modify: `backend/src/Handlers.php:64-139,467-518`

**Interfaces:**

- Consumes: `WorkflowRules::parseUtc()` and `WorkflowRules::assertAvailabilityWindow()`.
- Produces: `GET /v1/trainer/me`, `POST /v1/availability-slots`, `DELETE /v1/availability-slots/{id}`, and public trainer payloads containing only available future slots.

- [ ] **Step 1: Write the failing availability smoke scenario**

Create `scripts/api-workflow-smoke.ps1` with reusable assertions and the availability scenario:

```powershell
[CmdletBinding()]
param(
    [ValidateSet('availability', 'admin', 'booking', 'all')]
    [string]$Scenario = 'all',
    [string]$ApiUrl = 'http://localhost/fitconnect-api'
)

$ErrorActionPreference = 'Stop'

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

function Login {
    param([string]$Email)
    $body = @{ email = $Email; password = 'password' } | ConvertTo-Json
    return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/auth/login" -ContentType 'application/json' -Body $body).data
}

function Auth-Headers {
    param([string]$Token)
    return @{ Authorization = "Bearer $Token" }
}

function Expect-Status {
    param([int]$Status, [scriptblock]$Action)
    try {
        & $Action | Out-Null
    } catch {
        $actual = [int]$_.Exception.Response.StatusCode
        Assert-True ($actual -eq $Status) "Expected HTTP $Status, got $actual"
        return
    }
    throw "Expected HTTP $Status, request succeeded"
}

if ($Scenario -in @('availability', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $startsAt = (Get-Date).ToUniversalTime().AddDays(7).AddMinutes((Get-Random -Minimum 1 -Maximum 300)).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $endsAt = ([DateTime]::Parse($startsAt)).ToUniversalTime().AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
    $body = @{ startsAt = $startsAt; endsAt = $endsAt } | ConvertTo-Json

    $created = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body).data
    Assert-True ($created.state -eq 'available') 'New slot must be available'

    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $body
    }

    $workspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    Assert-True (($workspace.slots.id -contains $created.id)) 'Trainer workspace must include the new slot'

    Invoke-RestMethod -Method Delete -Uri "$ApiUrl/v1/availability-slots/$($created.id)" -Headers $trainerHeaders | Out-Null

    $pendingTrainer = Login 'trainer.c@fitconnect.local'
    $pendingHeaders = Auth-Headers $pendingTrainer.token
    Expect-Status 403 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $pendingHeaders -ContentType 'application/json' -Body $body
    }
}

Write-Host "PASS API workflow scenario: $Scenario"
```

- [ ] **Step 2: Run it against the current API and verify the route fails**

Run:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario availability
```

Expected: FAIL with `404` because the availability route does not exist.

- [ ] **Step 3: Register routes, CORS, and handler behavior**

Add routes in `backend/index.php` before the dynamic public trainer route:

```php
if ($method === 'GET' && $path === '/v1/trainer/me') $handlers->trainerMe();
if ($method === 'POST' && $path === '/v1/availability-slots') $handlers->createAvailabilitySlot();
if ($method === 'DELETE' && preg_match('#^/v1/availability-slots/(\d+)$#', $path, $matches) === 1) $handlers->deleteAvailabilitySlot($matches[1]);
```

Change the CORS method list in `backend/src/Http.php`:

```php
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
```

Implement these exact transaction boundaries in `Handlers.php`:

```php
public function createAvailabilitySlot(): never
{
    $user = $this->auth->requireUser(['trainer']);
    $input = Http::body();
    Http::requireFields($input, ['startsAt', 'endsAt']);
    $startsAt = WorkflowRules::parseUtc((string) $input['startsAt'], 'startsAt');
    $endsAt = WorkflowRules::parseUtc((string) $input['endsAt'], 'endsAt');
    WorkflowRules::assertAvailabilityWindow(new DateTimeImmutable('now', new DateTimeZone('UTC')), $startsAt, $endsAt);

    $slot = $this->database->transaction(function (PDO $pdo) use ($user, $startsAt, $endsAt): array {
        $profileStatement = $pdo->prepare('SELECT id, approval_status FROM trainer_profiles WHERE user_id = ? FOR UPDATE');
        $profileStatement->execute([$user['id']]);
        $profile = $profileStatement->fetch();
        if (!$profile || $profile['approval_status'] !== 'approved') {
            throw new HttpException(403, 'เทรนเนอร์ต้องได้รับการอนุมัติก่อนสร้างตาราง', 'TRAINER_NOT_APPROVED');
        }

        $overlap = $pdo->prepare('SELECT id FROM availability_slots WHERE trainer_profile_id = ? AND starts_at < ? AND ends_at > ? LIMIT 1');
        $overlap->execute([(int) $profile['id'], $endsAt->format('Y-m-d H:i:s'), $startsAt->format('Y-m-d H:i:s')]);
        if ($overlap->fetch()) {
            throw new HttpException(409, 'ช่วงเวลานี้ทับกับตารางที่มีอยู่', 'SLOT_OVERLAP');
        }

        $insert = $pdo->prepare('INSERT INTO availability_slots (trainer_profile_id, starts_at, ends_at, state) VALUES (?, ?, ?, "available")');
        $insert->execute([(int) $profile['id'], $startsAt->format('Y-m-d H:i:s'), $endsAt->format('Y-m-d H:i:s')]);
        return ['id' => (int) $pdo->lastInsertId(), 'startsAt' => $startsAt->format('Y-m-d\TH:i:s.000\Z'), 'endsAt' => $endsAt->format('Y-m-d\TH:i:s.000\Z'), 'state' => 'available'];
    });

    Http::json($slot, 201);
}
```

Implement `trainerMe()` with the current authenticated user as the only lookup key:

```php
public function trainerMe(): never
{
    $user = $this->auth->requireUser(['trainer']);
    $profile = $this->database->fetchOne(
        'SELECT id, slug, approval_status, approval_note FROM trainer_profiles WHERE user_id = ?',
        [$user['id']]
    );
    if (!$profile) {
        Http::json(['profile' => null, 'certificates' => [], 'slots' => []]);
    }

    $profileId = (int) $profile['id'];
    $certificates = $this->database->fetchAll(
        'SELECT id, name, issuer, issued_year, status FROM trainer_certificates WHERE trainer_profile_id = ? ORDER BY id DESC',
        [$profileId]
    );
    $slots = $this->database->fetchAll(
        'SELECT id, starts_at, ends_at, state FROM availability_slots WHERE trainer_profile_id = ? AND starts_at >= UTC_TIMESTAMP() ORDER BY starts_at LIMIT 100',
        [$profileId]
    );

    Http::json([
        'profile' => [
            'id' => $profileId,
            'slug' => $profile['slug'],
            'displayName' => $user['displayName'],
            'approvalStatus' => $profile['approval_status'],
            'approvalNote' => $profile['approval_note'],
        ],
        'certificates' => array_map(fn(array $item): array => [
            'id' => (int) $item['id'],
            'name' => $item['name'],
            'issuer' => $item['issuer'],
            'issuedYear' => $item['issued_year'] === null ? null : (int) $item['issued_year'],
            'status' => $item['status'],
        ], $certificates),
        'slots' => array_map(fn(array $slot): array => [
            'id' => (int) $slot['id'],
            'startsAt' => $this->iso($slot['starts_at']),
            'endsAt' => $this->iso($slot['ends_at']),
            'state' => $slot['state'],
        ], $slots),
    ]);
}
```

Implement deletion with ownership and state checked under a row lock:

```php
public function deleteAvailabilitySlot(string $slotId): never
{
    $user = $this->auth->requireUser(['trainer']);
    $this->database->transaction(function (PDO $pdo) use ($slotId, $user): void {
        $statement = $pdo->prepare(
            'SELECT s.id, s.starts_at, s.state, tp.approval_status
             FROM availability_slots s
             JOIN trainer_profiles tp ON tp.id = s.trainer_profile_id
             WHERE s.id = ? AND tp.user_id = ? FOR UPDATE'
        );
        $statement->execute([(int) $slotId, $user['id']]);
        $slot = $statement->fetch();
        if (!$slot) {
            throw new HttpException(404, 'ไม่พบช่วงเวลาว่าง', 'SLOT_NOT_FOUND');
        }
        if ($slot['approval_status'] !== 'approved') {
            throw new HttpException(403, 'เทรนเนอร์ยังไม่ได้รับการอนุมัติ', 'TRAINER_NOT_APPROVED');
        }
        if ($slot['state'] !== 'available' || strtotime($slot['starts_at'] . ' UTC') <= time()) {
            throw new HttpException(409, 'ลบได้เฉพาะช่วงเวลาในอนาคตที่ยังว่าง', 'SLOT_NOT_DELETABLE');
        }
        $pdo->prepare('DELETE FROM availability_slots WHERE id = ?')->execute([(int) $slot['id']]);
    });
    Http::json(['id' => (int) $slotId, 'deleted' => true]);
}
```

In `trainerPayload()`, constrain the public slot query at SQL level:

```sql
WHERE trainer_profile_id = ?
  AND starts_at >= UTC_TIMESTAMP()
  AND starts_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MONTH)
  AND state = "available"
```

Map every public slot with `available => true`; never return held, booked, or blocked slots from public trainer endpoints.

Change the public detail lookup to require an active trainer account as well as an approved profile:

```php
$row = $this->trainerRow('tp.slug = ? AND u.status = "active"', [$slug]);
```

- [ ] **Step 4: Run the unit, smoke, and syntax checks**

Run:

```powershell
rtk cmd /c C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk cmd /c C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk cmd /c C:\xampp\php\php.exe -l backend\src\Http.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario availability
```

Expected: all tests pass; a duplicate/overlapping slot gets `409`; pending trainer creation gets `403`; the available slot can be deleted.

- [ ] **Step 5: Commit the availability API**

```powershell
rtk git add backend/index.php backend/src/Http.php backend/src/Handlers.php scripts/api-workflow-smoke.ps1
rtk git commit -m "feat: add trainer availability API"
```

---

### Task 3: Harden Admin Trainer Review and Certificate Payloads

**Files:**

- Modify: `backend/src/Handlers.php:326-397`
- Modify: `scripts/api-workflow-smoke.ps1`

**Interfaces:**

- Consumes: `WorkflowRules::assertTrainerApplicationDecision()` and existing protected file route `/v1/admin/files/certificate/{id}`.
- Produces: `AdminQueue.trainers[].certificates[]` and pending-only transactional admin decisions.

- [ ] **Step 1: Add a failing admin scenario to the smoke script**

Insert this scenario before the final `Write-Host`:

```powershell
if ($Scenario -in @('admin', 'all')) {
    $admin = Login 'admin.demo@fitconnect.local'
    $headers = Auth-Headers $admin.token
    $queue = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/admin/review-queue" -Headers $headers).data
    $candidate = $queue.trainers | Where-Object { $_.id -eq 3 } | Select-Object -First 1
    Assert-True ($null -ne $candidate) 'Seeded pending trainer must be in the review queue'
    Assert-True ($candidate.certificates.Count -gt 0) 'Review queue must include certificate records'
    Assert-True ($candidate.certificates[0].fileUrl -eq "/v1/admin/files/certificate/$($candidate.certificates[0].id)") 'Certificate URL must use the protected route'

    Expect-Status 422 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/3/reject" -Headers $headers -ContentType 'application/json' -Body (@{ note = '' } | ConvertTo-Json)
    }

    $approved = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/3/approve" -Headers $headers -ContentType 'application/json' -Body (@{ note = 'ผ่านการตรวจสำหรับ smoke test' } | ConvertTo-Json)).data
    Assert-True ($approved.status -eq 'approved') 'Pending trainer must become approved'

    Expect-Status 409 {
        Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/admin/trainers/3/approve" -Headers $headers -ContentType 'application/json' -Body (@{ note = 'กดซ้ำ' } | ConvertTo-Json)
    }
}
```

- [ ] **Step 2: Reset seed data, run the scenario, and verify failure**

Run:

```powershell
rtk npm run xampp:connect
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario admin
```

Expected: FAIL because trainer certificates are absent from the queue or a blank rejection is accepted. Run `rtk npm run xampp:connect` once more after the expected failure to restore trainer 3 to `pending`.

- [ ] **Step 3: Lock and validate the trainer row before deciding**

Replace the update-first logic in `decideTrainer()` with this order inside one transaction:

```php
$result = $this->database->transaction(function (PDO $pdo) use ($trainerId, $decision, $input, $admin): array {
    $statement = $pdo->prepare('SELECT id, approval_status FROM trainer_profiles WHERE id = ? FOR UPDATE');
    $statement->execute([(int) $trainerId]);
    $trainer = $statement->fetch();
    if (!$trainer) {
        throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
    }

    $note = trim((string) ($input['note'] ?? ''));
    WorkflowRules::assertTrainerApplicationDecision((string) $trainer['approval_status'], $decision, $note);
    $status = $decision === 'approve' ? 'approved' : 'rejected';
    $certificateStatus = $status === 'approved' ? 'verified' : 'rejected';

    $pdo->prepare('UPDATE trainer_profiles SET approval_status = ?, approval_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?')
        ->execute([$status, $note, $admin['id'], (int) $trainer['id']]);
    $pdo->prepare('UPDATE trainer_certificates SET status = ?, review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP() WHERE trainer_profile_id = ? AND status = "pending"')
        ->execute([$certificateStatus, $note, $admin['id'], (int) $trainer['id']]);

    return ['trainerId' => (int) $trainer['id'], 'status' => $status];
});
```

Enhance `adminReviewQueue()` by loading certificate rows for the pending trainer IDs and grouping them by `trainer_profile_id`. Each mapped certificate must have exactly these public fields:

```php
[
    'id' => (int) $certificate['id'],
    'name' => $certificate['name'],
    'issuer' => $certificate['issuer'],
    'submittedAt' => $this->iso($certificate['created_at']),
    'fileUrl' => '/v1/admin/files/certificate/' . $certificate['id'],
]
```

Keep the payment queue payload unchanged.

- [ ] **Step 4: Run rule, syntax, and admin API checks**

Run:

```powershell
rtk cmd /c C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk cmd /c C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk npm run xampp:connect
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario admin
```

Expected: blank rejection is `422`, first approval succeeds, second decision is `409`, and certificate metadata uses only the protected URL.

- [ ] **Step 5: Commit the admin API hardening**

```powershell
rtk git add backend/src/Handlers.php scripts/api-workflow-smoke.ps1
rtk git commit -m "feat: harden trainer review API"
```

---

### Task 4: Enforce Booking Ownership, Concurrency, and Trainer Decisions

**Files:**

- Modify: `backend/src/Handlers.php:140-237,520-530`
- Modify: `scripts/api-workflow-smoke.ps1`

**Interfaces:**

- Consumes: the new availability endpoints and `WorkflowRules::trainerBookingSlotState()`.
- Produces: role-aware `Booking` payloads and safe `pending_trainer -> awaiting_payment|cancelled` transitions.

- [ ] **Step 1: Add failing accept and reject-release checks to the smoke script**

Add a booking scenario that performs these exact assertions:

```powershell
if ($Scenario -in @('booking', 'all')) {
    $trainer = Login 'trainer.a@fitconnect.local'
    $member = Login 'member.demo@fitconnect.local'
    $trainerHeaders = Auth-Headers $trainer.token
    $memberHeaders = Auth-Headers $member.token

    function New-TestSlot {
        $start = (Get-Date).ToUniversalTime().AddDays(10).AddMinutes((Get-Random -Minimum 1 -Maximum 500)).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $end = ([DateTime]::Parse($start)).ToUniversalTime().AddHours(1).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
        $payload = @{ startsAt = $start; endsAt = $end } | ConvertTo-Json
        return (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/availability-slots" -Headers $trainerHeaders -ContentType 'application/json' -Body $payload).data
    }

    $acceptedSlot = New-TestSlot
    $bookingBody = @{ trainerId = 1; slotId = $acceptedSlot.id; location = 'จุดนัดหมายทดสอบ'; note = 'ทดสอบตอบรับ' } | ConvertTo-Json
    $acceptedBooking = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body $bookingBody).data
    Expect-Status 409 {
        Invoke-RestMethod -Method Delete -Uri "$ApiUrl/v1/availability-slots/$($acceptedSlot.id)" -Headers $trainerHeaders
    }
    $otherTrainer = Login 'trainer.b@fitconnect.local'
    $otherTrainerHeaders = Auth-Headers $otherTrainer.token
    Expect-Status 403 {
        Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($acceptedBooking.id)/status" -Headers $otherTrainerHeaders -ContentType 'application/json' -Body (@{ status = 'awaiting_payment' } | ConvertTo-Json)
    }
    $accepted = (Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($acceptedBooking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'awaiting_payment' } | ConvertTo-Json)).data
    Assert-True ($accepted.status -eq 'awaiting_payment') 'Trainer acceptance must move booking to awaiting_payment'
    Expect-Status 409 {
        Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($acceptedBooking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'cancelled' } | ConvertTo-Json)
    }

    $rejectedSlot = New-TestSlot
    $rejectBody = @{ trainerId = 1; slotId = $rejectedSlot.id; location = 'จุดนัดหมายทดสอบ'; note = 'ทดสอบปฏิเสธ' } | ConvertTo-Json
    $rejectedBooking = (Invoke-RestMethod -Method Post -Uri "$ApiUrl/v1/bookings" -Headers $memberHeaders -ContentType 'application/json' -Body $rejectBody).data
    Invoke-RestMethod -Method Patch -Uri "$ApiUrl/v1/bookings/$($rejectedBooking.id)/status" -Headers $trainerHeaders -ContentType 'application/json' -Body (@{ status = 'cancelled'; note = 'เวลาไม่สะดวก' } | ConvertTo-Json) | Out-Null
    $workspace = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/trainer/me" -Headers $trainerHeaders).data
    $released = $workspace.slots | Where-Object { $_.id -eq $rejectedSlot.id } | Select-Object -First 1
    Assert-True ($released.state -eq 'available') 'Rejected booking must release its slot'

    $trainerBookings = (Invoke-RestMethod -Method Get -Uri "$ApiUrl/v1/bookings" -Headers $trainerHeaders).data
    $trainerView = $trainerBookings | Where-Object { $_.id -eq $rejectedBooking.id } | Select-Object -First 1
    Assert-True (-not [string]::IsNullOrWhiteSpace($trainerView.member.displayName)) 'Trainer booking payload must include member name'
    Assert-True ($trainerView.note -eq 'ทดสอบปฏิเสธ') 'Trainer booking payload must include the member note'
}
```

After the sequential assertions, add this concurrent request block:

```powershell
$contestedSlot = New-TestSlot
$contestedBody = @{ trainerId = 1; slotId = $contestedSlot.id; location = 'ทดสอบการจองพร้อมกัน'; note = 'concurrency' } | ConvertTo-Json
$bookingRequest = {
    param([string]$Uri, [string]$Token, [string]$Body)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri $Uri -Headers @{ Authorization = "Bearer $Token" } -ContentType 'application/json' -Body $Body
        return [pscustomobject]@{ Status = [int]$response.StatusCode; Body = $response.Content }
    } catch {
        return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode; Body = '' }
    }
}
$jobs = 1..2 | ForEach-Object {
    Start-Job -ScriptBlock $bookingRequest -ArgumentList "$ApiUrl/v1/bookings", $member.token, $contestedBody
}
$results = @($jobs | Receive-Job -Wait -AutoRemoveJob)
$codes = (($results.Status | Sort-Object) -join ',')
Assert-True ($codes -eq '201,409') "Concurrent booking must return 201 and 409, got $codes"
```

- [ ] **Step 2: Run the booking scenario and verify the current transition bug**

Run:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario booking
```

Expected: FAIL because repeat/stale trainer actions are currently accepted or the trainer payload lacks member fields.

- [ ] **Step 3: Implement role-aware query and guarded transition logic**

Change `listBookings()` to join trainer and member users separately:

```sql
SELECT b.public_id, b.starts_at, b.ends_at, b.location_text, b.member_note,
       b.status, b.payment_status, b.created_at, b.is_demo,
       tp.id AS trainer_id, tp.slug,
       trainer_user.display_name AS trainer_name,
       member_user.display_name AS member_name
FROM bookings b
JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
JOIN users trainer_user ON trainer_user.id = tp.user_id
JOIN users member_user ON member_user.id = b.member_user_id
```

Keep the member filter on `b.member_user_id` and trainer filter on `tp.user_id`. Map `trainer.displayName` from `trainer_name`, plus:

```php
'member' => ['displayName' => $row['member_name']],
'note' => $row['member_note'] ?? '',
```

In `createBooking()`, extend the locked slot query to join the trainer account and require `s.starts_at > UTC_TIMESTAMP()`, profile `approved`, trainer account `active`, exact trainer ownership, and slot `available` before inserting.

In `updateBookingStatus()`, keep the booking row lock and ownership check. For a trainer, calculate the slot state before any update:

```php
$newStatus = (string) $input['status'];
if ($user['role'] === 'trainer') {
    if ((int) $booking['trainer_user_id'] !== (int) $user['id']) {
        throw new HttpException(403, 'ไม่มีสิทธิ์แก้ไขคำขอนี้', 'FORBIDDEN');
    }
    $slotState = WorkflowRules::trainerBookingSlotState((string) $booking['status'], $newStatus);
} else {
    $adminTransitions = [
        'pending_trainer' => ['cancelled'],
        'awaiting_payment' => ['cancelled'],
        'payment_review' => ['confirmed', 'cancelled'],
        'confirmed' => ['completed', 'cancelled'],
    ];
    if (!in_array($newStatus, $adminTransitions[$booking['status']] ?? [], true)) {
        throw new HttpException(409, 'ไม่สามารถเปลี่ยนจากสถานะปัจจุบันไปสถานะนี้', 'INVALID_BOOKING_TRANSITION');
    }
    $slotState = $newStatus === 'confirmed' ? 'booked' : ($newStatus === 'cancelled' ? 'available' : null);
}
```

Update the booking, insert one history row, and update the slot when `$slotState !== null` inside the same transaction. A trainer acceptance leaves the slot `held`; rejection sets it back to `available`.

- [ ] **Step 4: Run unit, syntax, sequential, and concurrent checks**

Run:

```powershell
rtk cmd /c C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk cmd /c C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario booking
```

Expected: accept, repeat-conflict, reject-release, member fields, and the `201`/`409` concurrent booking assertion all pass.

- [ ] **Step 5: Commit the booking API**

```powershell
rtk git add backend/src/Handlers.php scripts/api-workflow-smoke.ps1
rtk git commit -m "feat: enforce trainer booking transitions"
```

---

### Task 5: Add Typed Client Contracts and Structured API Errors

**Files:**

- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `lib/api.test.ts`
- Modify: `package.json:5-30`
- Modify: `package-lock.json`
- Modify: `lib/api.ts:1-78`
- Modify: `lib/types.ts:1-94`

**Interfaces:**

- Consumes: the response payloads from Tasks 2–4.
- Produces: `authHeaders()`, `authenticatedRequest<T>()`, `openProtectedFile()`, structured `ApiError`, `AdminQueue`, `TrainerWorkspace`, `TrainerAvailabilitySlot`, and role-aware `Booking` types.

- [ ] **Step 1: Install the test runner and create a failing API utility test**

Run:

```powershell
rtk npm install --save-dev vitest jsdom @testing-library/react @testing-library/jest-dom
```

Add the script to `package.json`:

```json
"test": "vitest run"
```

Create `vitest.config.ts`:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"] },
});
```

Create `tests/setup.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

Create `lib/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, authHeaders } from "@/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("apiRequest", () => {
  it("keeps the API code and field errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      json: vi.fn().mockResolvedValue({
        error: { code: "VALIDATION_FAILED", message: "แก้ไขข้อมูล", fields: { note: "จำเป็นต้องระบุเหตุผล" } },
      }),
    }));

    await expect(apiRequest("/test")).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      fields: { note: "จำเป็นต้องระบุเหตุผล" },
    });
  });
});

describe("authHeaders", () => {
  it("uses the saved bearer token", () => {
    localStorage.setItem("fitconnect_token", "abc123");
    expect(authHeaders()).toEqual({ Authorization: "Bearer abc123" });
  });
});
```

- [ ] **Step 2: Run the test and verify missing fields/helpers fail**

Run:

```powershell
rtk npm test -- lib/api.test.ts
```

Expected: FAIL because `ApiError.code`, `ApiError.fields`, and `authHeaders()` do not exist.

- [ ] **Step 3: Implement API utilities and shared contracts**

Update `ApiError` and error parsing in `lib/api.ts`:

```ts
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code = "REQUEST_FAILED",
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("fitconnect_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRequest<T>(path, { ...init, headers: { ...authHeaders(), ...init.headers } });
}
```

Parse `ApiErrorEnvelope` and throw `new ApiError(message, response.status, code, fields)`. Implement `openProtectedFile(path)` with `fetch`, `authHeaders()`, `URL.createObjectURL`, `window.open`, a 60-second revoke, and an `ApiError` when the response is not OK.

Add these exact contracts to `lib/types.ts` while preserving `AuthenticatedUser`:

```ts
export type TrainerApprovalStatus = "pending" | "approved" | "rejected";
export type SlotState = "available" | "held" | "booked" | "blocked";

export type TrainerAvailabilitySlot = {
  id: number;
  startsAt: string;
  endsAt: string;
  state: SlotState;
};

export type TrainerWorkspace = {
  profile: null | {
    id: number;
    slug: string;
    displayName: string;
    approvalStatus: TrainerApprovalStatus;
    approvalNote: string | null;
  };
  certificates: Certificate[];
  slots: TrainerAvailabilitySlot[];
};

export type AdminCertificate = {
  id: number;
  name: string;
  issuer: string;
  submittedAt: string;
  fileUrl: string;
};

export type AdminQueue = {
  trainers: Array<{
    id: number;
    slug: string;
    displayName: string;
    province: string;
    submittedAt: string;
    certificates: AdminCertificate[];
    demo?: boolean;
  }>;
  payments: Array<{
    id: number;
    bookingId: string;
    memberName: string;
    fileUrl: string;
    demo?: boolean;
  }>;
};
```

Extend `Booking` with optional trainer-only detail without breaking member rendering:

```ts
member?: { displayName: string };
note?: string;
```

- [ ] **Step 4: Run tests, lint, and typecheck**

Run:

```powershell
rtk npm test -- lib/api.test.ts
rtk npm run lint
rtk npm run typecheck
```

Expected: the API utility test passes and existing application types remain valid.

- [ ] **Step 5: Commit typed client infrastructure**

```powershell
rtk git add package.json package-lock.json vitest.config.ts tests/setup.ts lib/api.ts lib/api.test.ts lib/types.ts
rtk git commit -m "test: add typed authenticated API client"
```

---

### Task 6: Build the Admin Review Interface

**Files:**

- Create: `components/admin-review-queue.tsx`
- Create: `components/admin-review-queue.test.tsx`
- Modify: `components/role-dashboard.tsx:22-139,148-159,217-233`
- Modify: `app/globals.css:1768-1865,2305-2318`

**Interfaces:**

- Consumes: `AdminQueue`, `authenticatedRequest()`, and `openProtectedFile()`.
- Produces: `<AdminReviewQueue />`, which owns queue loading, per-row notes, protected PDF opening, decisions, and refresh.

- [ ] **Step 1: Write the failing rejection-note and refresh test**

Create `components/admin-review-queue.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminReviewQueue } from "@/components/admin-review-queue";
import { authenticatedRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  API_URL: "http://localhost/fitconnect-api",
  authenticatedRequest: vi.fn(),
  openProtectedFile: vi.fn(),
}));

const queue = {
  trainers: [{
    id: 9,
    slug: "trainer-nine",
    displayName: "ผู้สมัครทดสอบ",
    province: "เชียงใหม่",
    submittedAt: "2026-08-01T00:00:00.000Z",
    certificates: [{ id: 12, name: "ใบรับรอง", issuer: "สถาบันทดสอบ", submittedAt: "2026-08-01T00:00:00.000Z", fileUrl: "/v1/admin/files/certificate/12" }],
  }],
  payments: [],
};

describe("AdminReviewQueue", () => {
  beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

  it("requires a note before rejection and refreshes after success", async () => {
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(queue)
      .mockResolvedValueOnce({ trainerId: 9, status: "rejected" })
      .mockResolvedValueOnce({ trainers: [], payments: [] });

    render(<AdminReviewQueue />);
    await screen.findByText("ผู้สมัครทดสอบ");
    fireEvent.click(screen.getByRole("button", { name: "ปฏิเสธ" }));
    expect(screen.getByText("กรุณาระบุเหตุผลก่อนปฏิเสธ")).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("หมายเหตุสำหรับผู้สมัครทดสอบ"), { target: { value: "เอกสารไม่ชัดเจน" } });
    fireEvent.click(screen.getByRole("button", { name: "ปฏิเสธ" }));

    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/admin/trainers/9/reject",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ note: "เอกสารไม่ชัดเจน" }) }),
    ));
    await waitFor(() => expect(screen.queryByText("ผู้สมัครทดสอบ")).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the test and verify the component is missing**

Run:

```powershell
rtk npm test -- components/admin-review-queue.test.tsx
```

Expected: FAIL because `AdminReviewQueue` does not exist.

- [ ] **Step 3: Implement queue loading, file opening, and decisions**

Move the admin queue and payment action behavior out of `role-dashboard.tsx`. The trainer decision function must follow this structure:

```tsx
async function decide(trainerId: number, decision: "approve" | "reject") {
  const note = notes[trainerId]?.trim() ?? "";
  if (decision === "reject" && !note) {
    setRowErrors((current) => ({ ...current, [trainerId]: "กรุณาระบุเหตุผลก่อนปฏิเสธ" }));
    return;
  }

  setBusy(`trainer-${trainerId}`);
  setRowErrors((current) => ({ ...current, [trainerId]: "" }));
  try {
    await authenticatedRequest(`/v1/admin/trainers/${trainerId}/${decision}`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    await loadQueue();
  } catch (error) {
    const message = error instanceof Error ? error.message : "บันทึกผลไม่สำเร็จ";
    setRowErrors((current) => ({ ...current, [trainerId]: message }));
    if (error instanceof ApiError && error.status === 409) await loadQueue();
  } finally {
    setBusy(null);
  }
}
```

Render every certificate with name, issuer, submitted date, and a button that calls `openProtectedFile(certificate.fileUrl)`. Use an associated textarea label `หมายเหตุสำหรับ${trainer.displayName}`. Disable only the row being submitted. Keep the existing payment file/approve/reject behavior and empty state. On initial load failure, show the API message and a `ลองใหม่` button; do not load `demoAdminQueue`.

When queue loading or a decision returns `401`, remove `fitconnect_token` and route to `/login`. A failed decision must leave the current queue and note values visible. A `409` must refresh the queue after displaying that another admin already changed the row.

Replace the admin branch in `RoleDashboard` with:

```tsx
{role === "admin" && <AdminReviewQueue />}
```

Add CSS for `.certificate-list`, `.certificate-action`, `.review-note`, `.row-error`, and `.queue-retry`; at the existing mobile breakpoint, make `.verification-row` and `.queue-actions` one column with full-width controls.

- [ ] **Step 4: Run focused tests and application checks**

Run:

```powershell
rtk npm test -- components/admin-review-queue.test.tsx
rtk npm run lint
rtk npm run typecheck
```

Expected: the note/refresh test passes and the payment/admin dashboard still typechecks.

- [ ] **Step 5: Commit the admin UI**

```powershell
rtk git add components/admin-review-queue.tsx components/admin-review-queue.test.tsx components/role-dashboard.tsx app/globals.css
rtk git commit -m "feat: build trainer review interface"
```

---

### Task 7: Build the Trainer Scheduling and Request Workbench

**Files:**

- Create: `components/trainer-workbench.tsx`
- Create: `components/trainer-workbench.test.tsx`
- Modify: `components/role-dashboard.tsx:174-197`
- Modify: `app/globals.css:1754-1767,2058-2085,2268-2318`

**Interfaces:**

- Consumes: `TrainerWorkspace`, `Booking[]`, `authenticatedRequest()`, and `ApiError`.
- Produces: `<TrainerWorkbench />` with approval status, future slot creation/deletion, and one-time accept/reject actions.

- [ ] **Step 1: Write the failing approval-gate and booking-action tests**

Create `components/trainer-workbench.test.tsx` with these two cases:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrainerWorkbench } from "@/components/trainer-workbench";
import { authenticatedRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  authenticatedRequest: vi.fn(),
  ApiError: class ApiError extends Error { constructor(message: string, public status = 500) { super(message); } },
}));

const rejectedWorkspace = {
  profile: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค.", approvalStatus: "rejected" as const, approvalNote: "กรุณาส่งเอกสารใหม่" },
  certificates: [],
  slots: [],
};

describe("TrainerWorkbench", () => {
  beforeEach(() => vi.mocked(authenticatedRequest).mockReset());

  it("shows the rejection reason and blocks slot creation", async () => {
    vi.mocked(authenticatedRequest).mockImplementation((path) => Promise.resolve(path === "/v1/trainer/me" ? rejectedWorkspace : []));
    render(<TrainerWorkbench />);
    expect(await screen.findByText("กรุณาส่งเอกสารใหม่")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มช่วงเวลาว่าง" })).toBeDisabled();
  });

  it("accepts only the selected pending booking", async () => {
    const approved = { ...rejectedWorkspace, profile: { ...rejectedWorkspace.profile, approvalStatus: "approved" as const, approvalNote: null } };
    const bookings = [{
      id: "BK-TEST",
      trainer: { id: 3, slug: "trainer-c", displayName: "เทรนเนอร์ ค." },
      member: { displayName: "สมาชิกทดสอบ" },
      startsAt: "2026-08-10T02:00:00.000Z",
      endsAt: "2026-08-10T03:00:00.000Z",
      location: "ฟิตเนสทดสอบ",
      note: "มีอาการเจ็บเข่า",
      status: "pending_trainer" as const,
      paymentStatus: "not_submitted" as const,
      createdAt: "2026-08-01T00:00:00.000Z",
      demo: false,
    }];
    vi.mocked(authenticatedRequest)
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce(bookings)
      .mockResolvedValueOnce({ id: "BK-TEST", status: "awaiting_payment" })
      .mockResolvedValueOnce(approved)
      .mockResolvedValueOnce([]);

    render(<TrainerWorkbench />);
    await screen.findByText("สมาชิกทดสอบ");
    fireEvent.click(screen.getByRole("button", { name: "ตอบรับคำขอ BK-TEST" }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith(
      "/v1/bookings/BK-TEST/status",
      { method: "PATCH", body: JSON.stringify({ status: "awaiting_payment" }) },
    ));
  });
});
```

- [ ] **Step 2: Run the tests and verify the component is missing**

Run:

```powershell
rtk npm test -- components/trainer-workbench.test.tsx
```

Expected: FAIL because `TrainerWorkbench` does not exist.

- [ ] **Step 3: Implement the trainer workbench**

Load workspace and bookings together, but preserve independent error messages:

```tsx
const [workspaceResult, bookingResult] = await Promise.allSettled([
  authenticatedRequest<TrainerWorkspace>("/v1/trainer/me"),
  authenticatedRequest<Booking[]>("/v1/bookings"),
]);
```

Do not clear the last successfully loaded workspace or booking list when a refresh fails. Show a retry action beside the affected error and retain the user's unsent date fields.

The availability submit converts browser-local fields to UTC:

```tsx
const startsAt = new Date(form.startsAt).toISOString();
const endsAt = new Date(form.endsAt).toISOString();
await authenticatedRequest<TrainerAvailabilitySlot>("/v1/availability-slots", {
  method: "POST",
  body: JSON.stringify({ startsAt, endsAt }),
});
await loadWorkspace();
```

Use `ApiError.fields.startsAt` and `.endsAt` beside their inputs. Disable the form unless `workspace.profile?.approvalStatus === "approved"`. Set `min` to the next local minute and `max` to the local date two months ahead as convenience only; the server remains authoritative. Delete through `DELETE /v1/availability-slots/{id}` and show delete only for future `available` slots.

Render pending bookings with member name, Thai-formatted time, location, and note. Use accessible action labels that include the booking ID. Map actions exactly:

```tsx
const target = decision === "accept" ? "awaiting_payment" : "cancelled";
await authenticatedRequest(`/v1/bookings/${encodeURIComponent(bookingId)}/status`, {
  method: "PATCH",
  body: JSON.stringify({ status: target }),
});
await Promise.all([loadWorkspace(), loadBookings()]);
```

On `409`, display that the request changed and refresh both lists. On `401`, clear `fitconnect_token` and route to `/login`. If `profile` is null, show a link to `/trainer/apply`. Replace the trainer branch in `RoleDashboard` with `<TrainerWorkbench />`.

While simplifying `RoleDashboard`, remove `demoBookings`, `demoAdminQueue`, and the admin queue state. Initialize member bookings with `[]`; if `/v1/bookings` fails, keep the last successful list and show the API error with a retry button. API rows marked `demo` may still display the existing demo notice, but an API failure must never substitute imported bookings.

Add styles for `.trainer-workbench`, `.approval-panel`, `.availability-form`, `.trainer-slot-list`, `.trainer-booking-list`, `.trainer-booking-card`, `.field-error`, and row-level busy states. At `max-width: 58rem`, use one column and full-width actions.

- [ ] **Step 4: Run focused tests and quality checks**

Run:

```powershell
rtk npm test -- components/trainer-workbench.test.tsx
rtk npm run lint
rtk npm run typecheck
```

Expected: rejected trainers are visibly blocked, the correct booking status is sent, and all TypeScript checks pass.

- [ ] **Step 5: Commit the trainer UI**

```powershell
rtk git add components/trainer-workbench.tsx components/trainer-workbench.test.tsx components/role-dashboard.tsx app/globals.css
rtk git commit -m "feat: build trainer scheduling workbench"
```

---

### Task 8: Replace Demo Booking Selection with Live API Data

**Files:**

- Create: `components/booking-form.test.tsx`
- Modify: `components/booking-form.tsx:1-77`
- Modify: `lib/api.ts:47-78`
- Modify: `app/trainers/page.tsx:1-23`
- Modify: `app/globals.css:1545-1635,2268-2285`

**Interfaces:**

- Consumes: public `GET /v1/trainers/{slug}`, live public slots, `authenticatedRequest()`, and structured `ApiError`.
- Produces: a strict booking form that cannot submit an unavailable in-memory demo selection.

- [ ] **Step 1: Write failing live-load and stale-slot tests**

Create `components/booking-form.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookingForm } from "@/components/booking-form";
import { apiRequest, authenticatedRequest, ApiError } from "@/lib/api";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
  authenticatedRequest: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(message: string, public status = 500, public code = "REQUEST_FAILED", public fields = {}) { super(message); }
  },
}));

const liveTrainer = {
  id: 1,
  slug: "live-trainer",
  displayName: "เทรนเนอร์จริง",
  headline: "ทดสอบ",
  bio: "",
  yearsExperience: 1,
  province: { id: 57, nameTh: "สกลนคร", region: "ตะวันออกเฉียงเหนือ" },
  serviceAreas: [],
  trainingTypes: [],
  serviceMode: "freelance" as const,
  priceFrom: 500,
  reviewCount: 0,
  verification: "verified" as const,
  certificates: [],
  slots: [{ id: 44, startsAt: "2026-08-10T02:00:00.000Z", endsAt: "2026-08-10T03:00:00.000Z", available: true }],
  demo: false,
};

describe("BookingForm", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(authenticatedRequest).mockReset();
    push.mockReset();
  });

  it("loads the selected trainer from the API before submitting", async () => {
    vi.mocked(apiRequest).mockResolvedValue(liveTrainer);
    vi.mocked(authenticatedRequest).mockResolvedValue({ id: "BK-LIVE", status: "pending_trainer" });
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    fireEvent.change(screen.getByLabelText("สถานที่ที่สะดวก"), { target: { value: "ฟิตเนสกลางเมือง" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ }));
    await waitFor(() => expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings", expect.objectContaining({ method: "POST" })));
    expect(push).toHaveBeenCalledWith("/member?booking=BK-LIVE");
  });

  it("keeps form values and reports a stale slot", async () => {
    vi.mocked(apiRequest).mockResolvedValueOnce(liveTrainer).mockResolvedValueOnce({ ...liveTrainer, slots: [] });
    vi.mocked(authenticatedRequest).mockRejectedValue(new ApiError("ช่วงเวลานี้ไม่พร้อมจองแล้ว", 409, "SLOT_UNAVAILABLE"));
    render(<BookingForm trainerSlug="live-trainer" slotId="44" />);
    await screen.findByText("เทรนเนอร์จริง");
    const location = screen.getByLabelText("สถานที่ที่สะดวก");
    fireEvent.change(location, { target: { value: "สถานที่เดิม" } });
    fireEvent.click(screen.getByRole("button", { name: /ยืนยันและส่งคำขอ/ }));
    expect(await screen.findByText("ช่วงเวลานี้ไม่พร้อมจองแล้ว")).toBeInTheDocument();
    expect(location).toHaveValue("สถานที่เดิม");
    await waitFor(() => expect(apiRequest).toHaveBeenCalledTimes(2));
  });
});
```

- [ ] **Step 2: Run tests and verify the demo-data import breaks the contract**

Run:

```powershell
rtk npm test -- components/booking-form.test.tsx
```

Expected: FAIL because the current form reads `lib/demo-data` and does not navigate after success.

- [ ] **Step 3: Implement strict live selection and recoverable errors**

Remove `import { trainers } from "@/lib/demo-data"`. Add controlled `location` and `note`, plus loading/error/trainer state. Resolve selection only from:

```tsx
const trainer = await apiRequest<Trainer>(`/v1/trainers/${encodeURIComponent(trainerSlug)}`, { cache: "no-store" });
const slot = trainer.slots.find((item) => item.id === Number(slotId) && item.available) ?? null;
```

Add a strict catalog helper in `lib/api.ts` that never catches into `lib/demo-data`:

```ts
export async function getLiveTrainerCatalog(): Promise<{
  trainers: Trainer[];
  provinces: Province[];
  trainingTypes: TrainingType[];
}> {
  const request: RequestInit = { cache: "no-store" };
  const [liveTrainers, liveProvinces, liveTrainingTypes] = await Promise.all([
    apiRequest<Trainer[]>("/v1/trainers", request),
    apiRequest<Province[]>("/v1/provinces", request),
    apiRequest<TrainingType[]>("/v1/training-types", request),
  ]);
  return { trainers: liveTrainers, provinces: liveProvinces, trainingTypes: liveTrainingTypes };
}
```

Change `app/trainers/page.tsx` to use `getLiveTrainerCatalog()`. Pass `isDemo={catalog.trainers.some((trainer) => trainer.demo)}` when it succeeds. When the helper rejects, render a truthful unavailable state with the error message and a `/trainers` retry link; do not render fallback trainers on this booking-discovery route. Leave the landing page's non-writing presentation fallback unchanged.

If API loading fails, show the real error and a `ลองโหลดข้อมูลอีกครั้ง` button. If trainer or slot is absent, show the existing missing-selection state. Submit with `authenticatedRequest`; do not call `apiRequest` with a demo object:

```tsx
const booking = await authenticatedRequest<{ id: string; status: "pending_trainer" }>("/v1/bookings", {
  method: "POST",
  body: JSON.stringify({ trainerId: trainer.id, slotId: slot.id, location, note }),
});
router.push(`/member?booking=${encodeURIComponent(booking.id)}`);
```

For `409`, preserve controlled field values, display the server message, and reload the trainer so the stale slot disappears. For `422`, show `error.fields.location` beside the location field. For `401`, clear the stored token and route to `/login`. Keep the submit button disabled during requests.

Add CSS for live loading/retry and inline field errors, while retaining the existing two-column desktop form and one-column mobile layout.

- [ ] **Step 4: Run focused and full frontend checks**

Run:

```powershell
rtk npm test -- components/booking-form.test.tsx
rtk npm test
rtk npm run lint
rtk npm run typecheck
rtk npm run build
```

Expected: all Vitest suites, lint, typecheck, and production build pass.

- [ ] **Step 5: Commit the live booking UI**

```powershell
rtk git add components/booking-form.tsx components/booking-form.test.tsx lib/api.ts app/trainers/page.tsx app/globals.css
rtk git commit -m "feat: submit bookings from live availability"
```

---

### Task 9: Verify the Complete XAMPP Flow and Update Documentation

**Files:**

- Modify: `backend/README.md:14-46`
- Modify: `README.md:16-51`
- Modify: files above only if verification reveals a scoped defect

**Interfaces:**

- Consumes: every endpoint and component produced by Tasks 1–8.
- Produces: documented commands and evidence that admin approval, availability, booking, acceptance, and rejection work together.

- [ ] **Step 1: Update route and verification documentation**

Document these routes in `backend/README.md`:

```text
GET /v1/trainer/me
POST /v1/availability-slots
DELETE /v1/availability-slots/{id}
GET /v1/admin/review-queue
POST /v1/admin/trainers/{id}/approve
POST /v1/admin/trainers/{id}/reject
PATCH /v1/bookings/{publicId}/status
```

Add this local verification command to both READMEs:

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario all
```

State that the script mutates only the local development database and that `npm run xampp:connect` restores seeded statuses before another clean run.

- [ ] **Step 2: Run every automated check from a clean seeded state**

Run:

```powershell
rtk npm run xampp:connect
rtk cmd /c C:\xampp\php\php.exe backend\tests\WorkflowRulesTest.php
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario all
rtk npm test
rtk npm run check
```

Expected: rule tests and all API scenarios pass; concurrent booking yields exactly one `201` and one `409`; lint, typecheck, and build pass.

- [ ] **Step 3: Verify the admin and trainer UI in a desktop browser**

With `http://localhost:3000` running:

1. Sign in as `admin.demo@fitconnect.local` / `password`.
2. Confirm the pending applicant shows certificate metadata, note input, and protected open-file action.
3. Confirm blank rejection is blocked inline.
4. Approve the applicant and confirm the row disappears after refresh.
5. Sign in as an approved trainer, create a future slot, and confirm Thai local time is displayed.
6. Sign in as the member, find the trainer, select the new live slot, enter location/note, and submit.
7. Sign back in as the trainer; confirm member name, time, location, and note; accept once and confirm the buttons disappear.
8. Repeat with another slot and reject; confirm the slot returns to the public available list.

Capture browser console and network failures if any; fix only behavior inside the approved spec, then rerun the smallest failing automated check followed by `rtk npm run check`.

- [ ] **Step 4: Verify mobile and failure states**

At a viewport near 390 × 844, confirm admin rows, trainer forms, booking cards, and member booking fields use one column without horizontal scrolling. Then verify:

- expired/missing token routes the write flow to login;
- pending/rejected trainer sees status and cannot create slots;
- API stopped shows retry without false success;
- stale slot/action shows conflict and refreshes current data;
- keyboard focus reaches certificate, decision, slot, booking, and retry controls in visual order.

- [ ] **Step 5: Review the final diff and commit documentation/fixes**

Run:

```powershell
rtk git status --short
rtk git diff --check
rtk git diff --stat
```

Confirm no upload, token, `.env`, generated graph, or unrelated user file is staged. Then commit only documentation and any scoped verification fixes:

```powershell
rtk git add README.md backend/README.md
rtk git commit -m "docs: document trainer booking workflow"
```

If a scoped source fix was required, add only that named source/test pair to the same final verification commit after its focused test passes.

---

## Final Acceptance Checklist

- [ ] Admin can open real submitted certificate PDFs through the protected endpoint.
- [ ] Admin can decide only a pending trainer; rejection requires a note; repeat decisions return `409`.
- [ ] Only an approved active trainer can create non-overlapping future slots within two months.
- [ ] Trainer can delete only their own future `available` slot.
- [ ] Public trainer payloads expose only approved active trainers and available future slots.
- [ ] Booking form resolves trainer and slot from the live API and never writes from imported demo fallback data.
- [ ] Row locking allows only one booking for a contested slot.
- [ ] Trainer sees member name, time, location, note, and only their own requests.
- [ ] Acceptance moves booking to `awaiting_payment` and leaves the slot held.
- [ ] Rejection moves booking to `cancelled` and releases the slot in one transaction.
- [ ] Every booking transition inserts one history row.
- [ ] `401`, `403`, `404`, `409`, `422`, and API-unavailable states have truthful UI behavior.
- [ ] PHP tests, API smoke checks, Vitest, lint, typecheck, build, desktop flow, and mobile flow pass.
- [ ] Existing auth/header, payment, chat, and review behavior remains intact.
