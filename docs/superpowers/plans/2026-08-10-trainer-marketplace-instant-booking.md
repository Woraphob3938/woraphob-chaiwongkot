# FitConnect Trainer Marketplace and Instant Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างหน้าค้นหาและหน้าโปรไฟล์เทรนเนอร์แบบ marketplace พร้อม workflow จองทันที ล็อกเวลา 10 นาที และให้แก้สลิปได้หนึ่งครั้งโดยไม่ต้องให้เทรนเนอร์กดรับ

**Architecture:** PHP และ MySQL เป็นแหล่งความจริงของราคา เส้นตาย และสถานะ slot การหมดเวลาใช้ฟังก์ชันกลางที่ทำงานภายใน transaction ก่อนอ่านหรือเปลี่ยนข้อมูลที่เกี่ยวข้อง ส่วน Next.js แสดงตัวนับและสถานะจาก `paymentDeadlineAt` แต่ไม่ตัดสิน expiry เอง UI ใช้โครง Marketplace Grid และ Commerce Detail โดยประกอบจาก shadcn primitives ที่มีอยู่

**Tech Stack:** Next.js 16.3.0, React 19, TypeScript 6, shadcn/Radix, Vitest, PHP 8 ภายใต้ XAMPP, MySQL/MariaDB, PowerShell smoke และ migration scripts

## Global Constraints

- อ่านคำแนะนำที่เกี่ยวข้องใน `node_modules/next/dist/docs/` ก่อนแก้โค้ด Next.js ตาม `AGENTS.md`
- ห้ามเพิ่ม UI library, payment gateway, cron, worker หรือ MariaDB Event Scheduler
- ราคาจาก `trainer_profiles.price_from` คือค่าฝึกต่อครั้งและถูก snapshot ไป `bookings.quoted_price`
- การจองใหม่เริ่มที่ `awaiting_payment`; ห้ามสร้าง `pending_trainer`
- เส้นตายแรกและเส้นตายแก้ไขคือ 10 นาทีจากเวลาฐานข้อมูล UTC
- เวลาเท่ากับ `payment_deadline_at` ถือว่าหมดเวลา
- แอดมินตรวจสลิปด้วยตนเอง การปฏิเสธครั้งแรกให้ส่งใหม่หนึ่งครั้ง การปฏิเสธครั้งที่สองทำให้ booking เป็น `expired`
- การหมดเวลาหรือปฏิเสธครั้งที่สองต้องคืน slot เป็น `available` ใน transaction เดียว
- ไม่มีจังหวัด พื้นที่ให้บริการ หรือสถานที่นัดฝึกใน UI, API หรือฐานข้อมูล
- เก็บแชต ประวัติสถานะ การปิดงาน และรีวิวเดิมไว้ การจอง `expired` อ่านแชตได้แต่ส่งเพิ่มไม่ได้
- ภาษาไทยต้องตรงสถานะจริง เป้าหมาย WCAG 2.2 AA, touch target อย่างน้อย 44px, รองรับ 200% zoom และ reduced motion
- ตรวจ responsive ที่ 320, 375, 414, 768 และ 1280px โดยไม่มี page-level horizontal overflow
- ห้าม stage หรือ commit `.superpowers/` และ `graphify-out/`

---

## File map

### Backend และข้อมูล

- `backend/src/WorkflowRules.php`: กฎเส้นตายและผลของการปฏิเสธสลิป
- `backend/src/Handlers.php`: expiry transaction, สร้าง booking, อัปโหลดสลิป, ตรวจสลิป และ payload
- `backend/tests/WorkflowRulesTest.php`: unit tests ของกฎเวลาและจำนวนครั้ง
- `backend/database/schema.sql`: schema ใหม่สำหรับติดตั้งฐานข้อมูลเปล่า
- `backend/database/seed.sql`: demo booking ที่ไม่ใช้ `pending_trainer`
- `backend/database/manual-migrations/20260810_instant_booking_payment_deadline.sql`: migration ข้อมูลและ enum
- `scripts/migrate-instant-booking.ps1`: preflight, backup, migration และ postflight
- `scripts/migrate-instant-booking.test.ps1`: state detection tests
- `backend/database/audit_booking.sql`: audit deadline, history, payment attempts และ slot
- `scripts/api-payment-chat-review-smoke.ps1`: live workflow ปฏิเสธหนึ่งครั้งแล้วอนุมัติ และ workflow expiry

### Frontend domain และสถานะ

- `lib/types.ts`: `expired`, `paymentDeadlineAt` และ response type
- `lib/dashboard-actions.ts`: next action ของสมาชิกและเทรนเนอร์
- `lib/dashboard-actions.test.ts`: priority tests หลังตัด trainer acceptance
- `components/status-badge.tsx`: ป้าย “หมดเวลา”
- `components/status-badge.test.tsx`: label, tone และ decorative icon
- `components/payment-deadline.tsx`: ตัวนับจาก server deadline
- `components/payment-deadline.test.tsx`: fake timer และ callback เมื่อหมดเวลา

### หน้าค้นหาและโปรไฟล์

- `components/trainer-discovery.tsx`: query, filters, sort และ grid
- `components/trainer-discovery.test.tsx`: filter/sort/empty/a11y
- `components/trainer-marketplace-filters.tsx`: filter controls ที่ใช้ id prefix แยก desktop/mobile
- `components/trainer-marketplace-card.tsx`: card facts และ profile CTA
- `components/trainer-marketplace-card.test.tsx`: ราคา เวลาว่าง และข้อมูลสาธิต
- `components/trainer-detail.tsx`: Commerce Detail layout และ price editor copy
- `components/trainer-detail.test.tsx`: hierarchy, owner price edit และ disclosure
- `components/profile-booking-panel.tsx`: slot selection, fixed price และ CTA
- `components/profile-booking-panel.test.tsx`: disabled/ready states และ URL
- `components/booking-form.tsx`: confirmation dialog และ create-booking response
- `components/booking-form.test.tsx`: dialog, request body, redirect และ stale slot
- `app/booking/page.tsx`: copy ขั้นจองและเส้นตาย
- `components/booking-strip.tsx`, `components/booking-strip.test.tsx`: ลบหลังไม่มีผู้ใช้

### Dashboard และภาพรวมระบบ

- `components/role-dashboard.tsx`: countdown, expired state และ payment retry
- `components/role-dashboard.test.tsx`: member hierarchy และ expiry refresh
- `components/payment-panel.tsx`: copy การส่งครั้งแรก/ครั้งแก้ไข
- `components/payment-panel.test.tsx`: retry limit copy และ late state
- `components/trainer-workbench.tsx`: ลบ accept/reject/quote controls
- `components/trainer-workbench.test.tsx`: held slot แบบอ่านอย่างเดียวและ confirmed appointments
- `components/admin-review-queue.tsx`, `components/admin-review-queue.test.tsx`: ผล reject ครั้งแรกและครั้งที่สอง
- `components/chat-workbench.tsx`, `components/chat-workbench.test.tsx`: expired label และ read-only chat
- `components/site-header.tsx`, `components/site-header.test.tsx`: navigation ที่เข้ากับ lint contract ของ Next.js 16.3
- `app/globals.css`: marketplace, profile, countdown และ responsive rules
- `PRODUCT.md`, `DESIGN.md`, `.impeccable/surfaces/transaction-surfaces.md`, `README.md`: contract หลังส่งงาน

---

### Task 1: กฎเวลาและการปฏิเสธสลิป

**Files:**
- Modify: `backend/src/WorkflowRules.php`
- Modify: `backend/tests/WorkflowRulesTest.php`

**Interfaces:**
- Produces: `WorkflowRules::isPaymentDeadlineExpired(DateTimeImmutable $deadline, DateTimeImmutable $now): bool`
- Produces: `WorkflowRules::paymentRejectionTransition(int $priorRejectedCount, DateTimeImmutable $now): array{bookingStatus:string,slotState:string,paymentDeadlineAt:?DateTimeImmutable}`
- Consumes: ไม่มี dependency จาก task อื่น

- [ ] **Step 1: เขียน unit tests ที่ล้มเหลว**

เพิ่ม tests ต่อไปนี้และลบ tests ที่ยืนยัน trainer accept/reject:

```php
$deadline = new DateTimeImmutable('2026-08-10T03:10:00.000Z');

test('payment remains active before the deadline', function () use ($deadline): void {
    assertSameValue(false, WorkflowRules::isPaymentDeadlineExpired(
        $deadline,
        $deadline->modify('-1 millisecond')
    ));
});

test('payment expires exactly at the deadline', function () use ($deadline): void {
    assertSameValue(true, WorkflowRules::isPaymentDeadlineExpired($deadline, $deadline));
});

test('first rejected payment opens one ten minute retry', function (): void {
    $now = new DateTimeImmutable('2026-08-10T04:00:00.000Z');
    $result = WorkflowRules::paymentRejectionTransition(0, $now);
    assertSameValue('awaiting_payment', $result['bookingStatus']);
    assertSameValue('held', $result['slotState']);
    assertSameValue('2026-08-10T04:10:00+00:00', $result['paymentDeadlineAt']->format(DateTimeInterface::ATOM));
});

test('second rejected payment expires and releases the slot', function (): void {
    $result = WorkflowRules::paymentRejectionTransition(
        1,
        new DateTimeImmutable('2026-08-10T04:00:00.000Z')
    );
    assertSameValue('expired', $result['bookingStatus']);
    assertSameValue('available', $result['slotState']);
    assertSameValue(null, $result['paymentDeadlineAt']);
});
```

- [ ] **Step 2: รัน RED**

Run: `rtk npm run test:php`

Expected: FAIL เพราะยังไม่มี `isPaymentDeadlineExpired()` และ `paymentRejectionTransition()`

- [ ] **Step 3: เพิ่มกฎขั้นต่ำ**

```php
public static function isPaymentDeadlineExpired(
    DateTimeImmutable $deadline,
    DateTimeImmutable $now
): bool {
    return $now >= $deadline;
}

public static function paymentRejectionTransition(
    int $priorRejectedCount,
    DateTimeImmutable $now
): array {
    if ($priorRejectedCount === 0) {
        return [
            'bookingStatus' => 'awaiting_payment',
            'slotState' => 'held',
            'paymentDeadlineAt' => $now->modify('+10 minutes'),
        ];
    }

    return [
        'bookingStatus' => 'expired',
        'slotState' => 'available',
        'paymentDeadlineAt' => null,
    ];
}
```

- [ ] **Step 4: รัน GREEN และ syntax check**

Run: `rtk npm run test:php`

Expected: ทุก PHP test PASS

Run: `rtk C:\xampp\php\php.exe -l backend/src/WorkflowRules.php`

Expected: `No syntax errors detected`

- [ ] **Step 5: Commit**

```powershell
rtk git add backend/src/WorkflowRules.php backend/tests/WorkflowRulesTest.php
rtk git commit -m "test: define instant booking payment rules"
```

---

### Task 2: Schema และ migration สำหรับ deadline

**Files:**
- Create: `backend/database/manual-migrations/20260810_instant_booking_payment_deadline.sql`
- Create: `scripts/migrate-instant-booking.ps1`
- Create: `scripts/migrate-instant-booking.test.ps1`
- Modify: `backend/database/schema.sql`
- Modify: `backend/database/seed.sql`
- Modify: `package.json`

**Interfaces:**
- Produces: `bookings.payment_deadline_at DATETIME NULL`
- Produces: booking status enum `awaiting_payment|payment_review|confirmed|completed|cancelled|expired`
- Produces: index `idx_booking_payment_deadline (status, payment_deadline_at)`
- Produces: `npm run migrate:instant-booking`
- Consumes: สถานะ `expired` จาก Task 1

- [ ] **Step 1: เขียน preflight tests ที่ล้มเหลว**

```powershell
$scriptPath = Join-Path $PSScriptRoot 'migrate-instant-booking.ps1'

foreach ($state in @('legacy', 'migrated')) {
    & $scriptPath -PreflightOnly -SchemaState $state
    if ($LASTEXITCODE -ne 0) { throw "$state schema should be accepted" }
}

$partialFailed = $false
try { & $scriptPath -PreflightOnly -SchemaState 'partial' } catch { $partialFailed = $true }
if (-not $partialFailed) { throw 'partial schema must be rejected before DDL' }

Write-Output 'PASS instant booking migration preflight state checks'
```

- [ ] **Step 2: รัน RED**

Run: `rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-instant-booking.test.ps1`

Expected: FAIL เพราะยังไม่มี migration runner

- [ ] **Step 3: สร้าง migration SQL แบบ deterministic**

SQL ต้องทำตามลำดับนี้:

```sql
ALTER TABLE bookings
  ADD COLUMN payment_deadline_at DATETIME NULL AFTER payment_status;

ALTER TABLE bookings
  MODIFY status ENUM(
    'pending_trainer', 'awaiting_payment', 'payment_review',
    'confirmed', 'completed', 'cancelled', 'expired'
  ) NOT NULL;

INSERT INTO booking_status_history
  (booking_id, from_status, to_status, changed_by_user_id, note)
SELECT id, 'pending_trainer', 'expired', NULL,
       'ระบบเปลี่ยนขั้นตอนการจอง กรุณาจองใหม่'
FROM bookings
WHERE status = 'pending_trainer';

UPDATE availability_slots s
JOIN bookings b
  ON b.availability_slot_id = s.id
 AND b.status = 'pending_trainer'
SET s.state = 'available'
WHERE s.state = 'held';

UPDATE bookings
SET status = 'expired', cancellation_reason = 'ระบบเปลี่ยนขั้นตอนการจอง กรุณาจองใหม่',
    updated_at = UTC_TIMESTAMP()
WHERE status = 'pending_trainer';

UPDATE bookings
SET payment_deadline_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)
WHERE status = 'awaiting_payment' AND payment_deadline_at IS NULL;

ALTER TABLE bookings
  MODIFY status ENUM(
    'awaiting_payment', 'payment_review', 'confirmed',
    'completed', 'cancelled', 'expired'
  ) NOT NULL;

CREATE INDEX idx_booking_payment_deadline
  ON bookings (status, payment_deadline_at);
```

- [ ] **Step 4: สร้าง migration runner พร้อม backup**

ใช้โครงเดียวกับ `scripts/migrate-remove-province-location.ps1` โดยตรวจสามเงื่อนไข:

```powershell
function Test-SchemaState([string]$State) {
    if ($State -eq 'partial') {
        throw 'Refusing migration: instant booking schema is partially migrated.'
    }
    if ($State -notin @('legacy', 'migrated')) {
        throw "Unknown schema state: $State"
    }
}
```

`legacy` หมายถึงไม่มี `payment_deadline_at` และ enum ยังมี `pending_trainer`; `migrated` หมายถึงมี column, index, `expired` และไม่มี `pending_trainer`; สถานะอื่นเป็น `partial` และต้องหยุดก่อน backup/DDL

เพิ่ม package script:

```json
"migrate:instant-booking": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-instant-booking.ps1"
```

- [ ] **Step 5: ปรับ schema และ seed**

ใน `schema.sql` ใช้ enum สุดท้าย เพิ่ม deadline และ index ใน `CREATE TABLE bookings`

ใน `seed.sql` เปลี่ยน demo booking เป็น `expired`, กำหนด `quoted_price`, `payment_deadline_at`, เปลี่ยน slot 102 เป็น `available` และใช้ history `NULL -> awaiting_payment -> expired` โดยไม่มี `pending_trainer`

- [ ] **Step 6: รัน GREEN และ schema assertions**

Run: `rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-instant-booking.test.ps1`

Expected: PASS ทั้ง legacy, migrated และ partial refusal

Run: `rtk rg -n "payment_deadline_at|idx_booking_payment_deadline|expired" backend/database/schema.sql backend/database/seed.sql backend/database/manual-migrations/20260810_instant_booking_payment_deadline.sql`

Expected: พบ contract ใหม่ครบทั้งสามไฟล์

- [ ] **Step 7: Commit**

```powershell
rtk git add backend/database/schema.sql backend/database/seed.sql backend/database/manual-migrations/20260810_instant_booking_payment_deadline.sql scripts/migrate-instant-booking.ps1 scripts/migrate-instant-booking.test.ps1 package.json
rtk git commit -m "feat: add instant booking database contract"
```

---

### Task 3: Backend booking, expiry และ payment transitions

**Files:**
- Modify: `backend/src/Handlers.php`
- Modify: `backend/src/WorkflowRules.php`
- Modify: `backend/tests/WorkflowRulesTest.php`

**Interfaces:**
- Consumes: schema และ index จาก Task 2
- Consumes: `WorkflowRules::isPaymentDeadlineExpired()` และ `paymentRejectionTransition()` จาก Task 1
- Produces: `POST /v1/bookings -> {id,status,quotedPrice,paymentDeadlineAt}`
- Produces: booking payload field `paymentDeadlineAt: string|null`
- Produces: error `409 PAYMENT_DEADLINE_EXPIRED`
- Produces: expiry side effect `awaiting_payment -> expired`, `held -> available`, history หนึ่งแถว

- [ ] **Step 1: เพิ่ม PHP contract tests ที่ล้มเหลว**

เพิ่ม tests ว่า trainer transition เดิมไม่อยู่ใน `WorkflowRules` และยืนยัน payment decision ยังต้องรับเฉพาะ `payment_review/reviewing` จากนั้นรัน:

Run: `rtk npm run test:php`

Expected: FAIL จนกว่าจะนำ `trainerBookingSlotState()` และ tests เดิมออก

- [ ] **Step 2: เพิ่ม expiry helpers ใน `Handlers`**

เพิ่ม private methods สองระดับเพื่อใช้ได้ทั้ง public endpoint และ transaction ที่เปิดอยู่:

```php
private function expireAwaitingPayments(?int $slotId = null): void
{
    $this->database->transaction(
        fn(PDO $pdo): array => $this->expireAwaitingPaymentsInTransaction($pdo, $slotId)
    );
}

private function expireAwaitingPaymentsInTransaction(PDO $pdo, ?int $slotId = null): array
{
    $sql = 'SELECT id, public_id, availability_slot_id
            FROM bookings
            WHERE status = "awaiting_payment"
              AND payment_deadline_at <= UTC_TIMESTAMP()';
    $params = [];
    if ($slotId !== null) {
        $sql .= ' AND availability_slot_id = ?';
        $params[] = $slotId;
    }
    $sql .= ' ORDER BY id FOR UPDATE';

    $statement = $pdo->prepare($sql);
    $statement->execute($params);
    $expired = $statement->fetchAll();

    foreach ($expired as $booking) {
        $pdo->prepare('UPDATE bookings SET status = "expired", updated_at = UTC_TIMESTAMP() WHERE id = ?')
            ->execute([$booking['id']]);
        if ($booking['availability_slot_id'] !== null) {
            $pdo->prepare('UPDATE availability_slots SET state = "available" WHERE id = ? AND state = "held"')
                ->execute([$booking['availability_slot_id']]);
        }
        $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, "awaiting_payment", "expired", NULL, "หมดเวลาส่งหลักฐานการชำระ")')
            ->execute([$booking['id']]);
    }

    return $expired;
}
```

เรียก wrapper ก่อน `trainers()`, `trainer()`, `trainerMe()`, `listBookings()` และ admin queue เรียก in-transaction variant ก่อนตรวจ slot ใน `createBooking()` และก่อนตัดสิน deadline ใน `payment()`

- [ ] **Step 3: เปลี่ยนการสร้าง booking**

Query slot ต้อง join `trainer_profiles.price_from` และล็อก stale booking ของ slot ก่อนล็อก slot เพื่อรักษาลำดับ lock เดียวกับ payment flow

Insert ใหม่:

```php
$insert = $pdo->prepare(
    'INSERT INTO bookings
     (public_id, member_user_id, trainer_profile_id, availability_slot_id,
      starts_at, ends_at, member_note, quoted_price, status, payment_status,
      payment_deadline_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, "awaiting_payment", "not_submitted",
             DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))'
);
```

Reject slot เมื่อราคาเป็น `NULL` หรือไม่มากกว่า 0 ด้วย `409 TRAINER_PRICE_UNAVAILABLE`

Response อ่าน deadline ที่บันทึกจริงกลับจากฐานข้อมูล:

```php
return [
    'id' => $publicId,
    'status' => 'awaiting_payment',
    'quotedPrice' => (float) $slot['price_from'],
    'paymentDeadlineAt' => $this->iso($created['payment_deadline_at']),
];
```

- [ ] **Step 4: ทำ payment upload ให้ commit expiry ก่อนตอบ 409**

ห้าม throw ภายใน transaction หลังเปลี่ยนเป็น `expired` เพราะ rollback จะคืนสถานะเดิม ให้ transaction คืน sentinel:

```php
if (WorkflowRules::isPaymentDeadlineExpired($deadline, $now)) {
    $this->expireAwaitingPaymentsInTransaction($pdo, (int) $booking['availability_slot_id']);
    return ['expired' => true, 'paymentId' => null];
}
```

หลัง transaction commit ให้ลบ upload ที่รับไว้และ throw:

```php
if ($result['expired']) {
    $this->removeUpload($file['path']);
    throw new HttpException(
        409,
        'หมดเวลาส่งหลักฐาน กรุณาเลือกเวลาใหม่',
        'PAYMENT_DEADLINE_EXPIRED'
    );
}
```

- [ ] **Step 5: เปลี่ยน admin rejection**

นับ payment ที่ rejected ก่อนรายการปัจจุบัน:

```sql
SELECT COUNT(*)
FROM payments
WHERE booking_id = ? AND status = 'rejected' AND id <> ?
```

ใช้ `paymentRejectionTransition()` กำหนด booking, deadline และ slot ถ้าผลเป็น `awaiting_payment` ให้ deadline ใหม่ 10 นาที ถ้าเป็น `expired` ให้ deadline `NULL` และ slot `available` Approval ยังเป็น `confirmed/approved/booked`

- [ ] **Step 6: ลบ trainer acceptance**

- `updateBookingStatus()` อนุญาต trainer เฉพาะ `completed`
- ลบ path ที่รับ `quotedPrice` จาก trainer
- ลบ `trainerBookingSlotState()` และ tests ของ accept/reject
- admin transitions ไม่อ้าง `pending_trainer`
- `bookingPayload()` เพิ่ม `paymentDeadlineAt`
- `canPay` เป็น true เฉพาะ `awaiting_payment` ที่ deadline ยังไม่หมด
- `canSendChat` ไม่รวม `expired`; `canReadChat` ยังคง true สำหรับ participant

- [ ] **Step 7: รัน backend verification**

Run: `rtk npm run test:php`

Expected: ทุก test PASS

Run: `rtk C:\xampp\php\php.exe -l backend/src/Handlers.php`

Expected: `No syntax errors detected`

Run: `rtk rg -n "pending_trainer|trainerBookingSlotState|quotedPrice.*input" backend/src backend/tests`

Expected: ไม่พบ trainer acceptance contract

- [ ] **Step 8: Commit**

```powershell
rtk git add backend/src/Handlers.php backend/src/WorkflowRules.php backend/tests/WorkflowRulesTest.php
rtk git commit -m "feat: expire unpaid bookings transactionally"
```

---

### Task 4: Frontend types, status และ countdown

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/dashboard-actions.ts`
- Modify: `lib/dashboard-actions.test.ts`
- Modify: `components/status-badge.tsx`
- Modify: `components/status-badge.test.tsx`
- Create: `components/payment-deadline.tsx`
- Create: `components/payment-deadline.test.tsx`

**Interfaces:**
- Consumes: API fields จาก Task 3
- Produces: `BookingStatus` ที่เพิ่ม `expired` โดยคง `pending_trainer` ไว้ชั่วคราวเพื่อให้ consumers เดิมยัง compile ได้; Task 7 ต้องลบ compatibility value นี้
- Produces: `Booking.paymentDeadlineAt: string|null`
- Produces: `CreateBookingResponse`
- Produces: `<PaymentDeadline deadlineAt onExpired />`

- [ ] **Step 1: เขียน focused tests ที่ล้มเหลว**

```tsx
it("เรียก onExpired เมื่อถึงเวลาของเซิร์ฟเวอร์", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-10T03:00:00.000Z"));
  const onExpired = vi.fn();
  render(<PaymentDeadline deadlineAt="2026-08-10T03:00:02.000Z" onExpired={onExpired} />);
  expect(screen.getByText("00:02")).toBeInTheDocument();
  act(() => vi.advanceTimersByTime(2_000));
  expect(onExpired).toHaveBeenCalledTimes(1);
  expect(screen.getByText("หมดเวลาแล้ว")).toBeInTheDocument();
});
```

เพิ่ม status test:

```tsx
render(<StatusBadge status="expired" />);
expect(screen.getByText("หมดเวลาแล้ว")).toBeInTheDocument();
```

- [ ] **Step 2: รัน RED**

Run: `rtk npm test -- components/payment-deadline.test.tsx components/status-badge.test.tsx lib/dashboard-actions.test.ts`

Expected: FAIL เพราะ type/status/component ยังไม่มี

- [ ] **Step 3: ปรับ types และ status map**

```ts
export type BookingStatus =
  | "pending_trainer" // transitional only; remove in Task 7
  | "awaiting_payment"
  | "payment_review"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "expired";

export type CreateBookingResponse = {
  id: string;
  status: "awaiting_payment";
  quotedPrice: number;
  paymentDeadlineAt: string;
};
```

เพิ่ม `paymentDeadlineAt: string | null` ใน `Booking` และ map `expired` ไป label “หมดเวลาแล้ว”, error tone และ `CircleX`

- [ ] **Step 4: สร้าง countdown ที่ประกาศเฉพาะเมื่อหมดเวลา**

```tsx
export function PaymentDeadline({
  deadlineAt,
  onExpired,
}: {
  deadlineAt: string;
  onExpired: () => void;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Date.parse(deadlineAt) - Date.now()));
  const notified = useRef(false);

  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Date.parse(deadlineAt) - Date.now()));
    tick();
    const id = window.setInterval(tick, 1_000);
    return () => window.clearInterval(id);
  }, [deadlineAt]);

  useEffect(() => {
    if (remaining === 0 && !notified.current) {
      notified.current = true;
      onExpired();
    }
  }, [onExpired, remaining]);

  if (remaining === 0) return <p role="status">หมดเวลาแล้ว</p>;
  const seconds = Math.ceil(remaining / 1_000);
  return <time dateTime={deadlineAt} aria-label="เวลาที่เหลือสำหรับส่งสลิป">{`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`}</time>;
}
```

- [ ] **Step 5: ปรับ next-action selectors**

- สมาชิกให้ `canPay` มี priority แรกตามเดิม แต่ description ใช้ “ส่งสลิปก่อนหมดเวลา”
- ลบ member action “รอเทรนเนอร์ตอบรับ”
- ลบ trainer action “ตอบรับคำขอจอง”
- `expired` ไม่เป็น action และไม่บัง booking ที่ยังทำต่อได้

- [ ] **Step 6: รัน GREEN และ typecheck**

Run: `rtk npm test -- components/payment-deadline.test.tsx components/status-badge.test.tsx lib/dashboard-actions.test.ts`

Expected: PASS

Run: `rtk npm run typecheck`

Expected: PASS เพราะ compatibility type `pending_trainer` ยังอยู่ชั่วคราว แต่ selector ใหม่ต้องไม่สร้าง action ที่อ้าง workflow นี้

- [ ] **Step 7: Commit**

ห้าม commit จนกว่า focused tests และ `tsc --noEmit` จะผ่าน:

```powershell
rtk git add lib/types.ts lib/dashboard-actions.ts lib/dashboard-actions.test.ts components/status-badge.tsx components/status-badge.test.tsx components/payment-deadline.tsx components/payment-deadline.test.tsx
rtk git commit -m "feat: add unpaid booking countdown state"
```

---

### Task 5: Marketplace trainer discovery

**Files:**
- Create: `components/trainer-marketplace-filters.tsx`
- Create: `components/trainer-marketplace-card.tsx`
- Create: `components/trainer-marketplace-card.test.tsx`
- Modify: `components/trainer-discovery.tsx`
- Modify: `components/trainer-discovery.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `Trainer`, `TrainingType` และ `formatMoney()`
- Produces: `TrainerMarketplaceFilters` ที่ใช้ `idPrefix="desktop"|"mobile"`
- Produces: `TrainerMarketplaceCard` ที่ link ไป `/trainers/{slug}` เท่านั้น
- Produces: sort modes `availability|price_asc|price_desc`

- [ ] **Step 1: เขียน RED tests สำหรับ hierarchy และ behavior**

```tsx
expect(screen.getByRole("complementary", { name: "ตัวกรองเทรนเนอร์" })).toBeInTheDocument();
expect(screen.getByRole("list", { name: /ผลการค้นหาเทรนเนอร์/ })).toBeInTheDocument();
expect(screen.getAllByRole("link", { name: "ดูโปรไฟล์และเลือกเวลา" })).toHaveLength(trainers.length);
expect(screen.queryByText("เทรนเนอร์ที่เลือก")).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: /เลือก .*ตรวจคุณสมบัติ/ })).not.toBeInTheDocument();
```

เพิ่ม tests สำหรับ price range, available-only, sort ราคา และ empty state

- [ ] **Step 2: รัน RED**

Run: `rtk npm test -- components/trainer-discovery.test.tsx components/trainer-marketplace-card.test.tsx`

Expected: FAIL เพราะ marketplace components ยังไม่มี

- [ ] **Step 3: สร้าง filter component โดยไม่ใช้ duplicate ids**

Props ต้องเป็น:

```ts
type TrainerMarketplaceFiltersProps = {
  idPrefix: "desktop" | "mobile";
  trainingTypes: TrainingType[];
  trainingType: string;
  priceRange: "all" | "under_700" | "701_1000" | "over_1000";
  verifiedOnly: boolean;
  availableOnly: boolean;
  onTrainingTypeChange: (value: string) => void;
  onPriceRangeChange: (value: TrainerMarketplaceFiltersProps["priceRange"]) => void;
  onVerifiedOnlyChange: (value: boolean) => void;
  onAvailableOnlyChange: (value: boolean) => void;
};
```

ใช้ `id={`${idPrefix}-training-type`}` และ prefix เดียวกันกับทุก field

- [ ] **Step 4: สร้าง card ที่แสดงข้อเท็จจริงเท่านั้น**

Card ต้องคำนวณ slot แรกจาก `trainer.slots[0]`, ซ่อน rating เมื่อ `reviewCount === 0`, แสดง “ยังไม่มีเวลาว่าง” เมื่อไม่มี slot และแสดงป้าย “ภาพสังเคราะห์ · ข้อมูลสาธิต” เมื่อ `trainer.demo`

- [ ] **Step 5: เปลี่ยน discovery เป็น filter + sort + grid**

ลบ selected trainer state, `AvailabilityPanel`, `CredentialCard`, process rule และ `BookingStrip`

Sort ต้องไม่ mutate props:

```ts
const visibleTrainers = useMemo(() => {
  const matches = initialTrainers.filter(matchesAllFilters);
  return [...matches].sort((a, b) => {
    if (sortMode === "price_asc") return (a.priceFrom ?? Number.POSITIVE_INFINITY) - (b.priceFrom ?? Number.POSITIVE_INFINITY);
    if (sortMode === "price_desc") return (b.priceFrom ?? -1) - (a.priceFrom ?? -1);
    return Date.parse(a.slots[0]?.startsAt ?? "9999-12-31") - Date.parse(b.slots[0]?.startsAt ?? "9999-12-31");
  });
}, [availableOnly, initialTrainers, priceRange, query, sortMode, trainingType, verifiedOnly]);
```

Desktop render filter `<aside>`; mobile render shadcn `Sheet` พร้อม `idPrefix="mobile"`

- [ ] **Step 6: เพิ่ม responsive CSS**

- Desktop 1280: 205-240px filter rail, grid 3 columns
- 768: filter rail hidden, Sheet trigger visible, grid 2 columns
- 414/375/320: grid 1 column
- card media ใช้ aspect ratio เดียวกันและไม่บังคับความสูงของข้อความ
- focus-visible ใช้ token เดิมและไม่มี raw hex ใน production CSS

- [ ] **Step 7: รัน GREEN และ detector เฉพาะไฟล์**

Run: `rtk npm test -- components/trainer-discovery.test.tsx components/trainer-marketplace-card.test.tsx`

Expected: PASS

Run: `rtk npm run typecheck`

Expected: PASS

Run: `rtk node C:\Users\HP\.agents\skills\impeccable\scripts\detect.mjs --json components/trainer-discovery.tsx components/trainer-marketplace-filters.tsx components/trainer-marketplace-card.tsx`

Expected: `[]`

- [ ] **Step 8: Commit**

```powershell
rtk git add components/trainer-discovery.tsx components/trainer-discovery.test.tsx components/trainer-marketplace-filters.tsx components/trainer-marketplace-card.tsx components/trainer-marketplace-card.test.tsx app/globals.css
rtk git commit -m "feat: add marketplace trainer discovery"
```

---

### Task 6: Commerce profile และ booking confirmation

**Files:**
- Create: `components/profile-booking-panel.tsx`
- Create: `components/profile-booking-panel.test.tsx`
- Modify: `components/trainer-detail.tsx`
- Modify: `components/trainer-detail.test.tsx`
- Modify: `components/booking-form.tsx`
- Modify: `components/booking-form.test.tsx`
- Modify: `app/booking/page.tsx`
- Modify: `app/globals.css`
- Delete: `components/booking-strip.tsx`
- Delete: `components/booking-strip.test.tsx`

**Interfaces:**
- Consumes: `CreateBookingResponse` จาก Task 4 และ API จาก Task 3
- Produces: `<ProfileBookingPanel trainer selectedSlot onSelectSlot />`
- Produces: confirmation Dialog ก่อน `POST /v1/bookings`
- Produces: request body `{trainerId,slotId,note}` โดยไม่มีราคา

- [ ] **Step 1: เขียน RED tests ของ profile hierarchy**

```tsx
expect(screen.getByRole("heading", { level: 1, name: trainer.displayName })).toBeInTheDocument();
expect(screen.getByText("ค่าฝึกต่อครั้ง")).toBeInTheDocument();
expect(screen.getByRole("complementary", { name: "เลือกเวลาฝึก" })).toBeInTheDocument();
expect(screen.getByRole("link", { name: "จองเวลานี้" })).toHaveAttribute(
  "href",
  `/booking?trainer=${trainer.slug}&slot=${trainer.slots[0].id}`
);
```

เพิ่ม test ว่า null price ทำให้ CTA disabled พร้อมข้อความ “เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก”

- [ ] **Step 2: เขียน RED tests ของ confirmation**

```tsx
fireEvent.submit(screen.getByRole("form", { name: "ยืนยันการจอง" }));
expect(screen.getByRole("dialog", { name: "ยืนยันและเริ่มเวลา 10 นาที" })).toBeInTheDocument();
expect(authenticatedRequest).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole("button", { name: "ยืนยันและเริ่มเวลา 10 นาที" }));
expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings", {
  method: "POST",
  body: JSON.stringify({ trainerId: trainer.id, slotId: slot.id, note: "" }),
});
```

- [ ] **Step 3: รัน RED**

Run: `rtk npm test -- components/trainer-detail.test.tsx components/profile-booking-panel.test.tsx components/booking-form.test.tsx`

Expected: FAIL ตาม hierarchy และ dialog ที่ยังไม่มี

- [ ] **Step 4: สร้างสามคอลัมน์ Commerce Detail**

`TrainerDetail` render ตามลำดับ DOM: media, identity/evidence, booking panel ใช้ `DisclosureSection` เดิมสำหรับใบรับรองและตารางทั้งหมด Owner price editor เปลี่ยน label/copy จาก “ราคาเริ่มต้น” เป็น “ค่าฝึกต่อครั้ง” โดยยัง PATCH `/v1/trainer/me` เหมือนเดิม

`ProfileBookingPanel` ใช้ `AvailabilityPanel` เดิมสำหรับ slot selection และแสดงราคา, policy 10 นาที, CTA เดียว

- [ ] **Step 5: เพิ่ม confirmation Dialog และ response type**

แยก `onSubmit` ให้เปิด Dialog และ `createBooking()` ทำ POST จริง:

```ts
const booking = await authenticatedRequest<CreateBookingResponse>("/v1/bookings", {
  method: "POST",
  body: JSON.stringify({ trainerId: trainer.id, slotId: slot.id, note }),
});
router.push(`/member?booking=${encodeURIComponent(booking.id)}`);
```

Summary ใน Dialog แสดงชื่อ วัน เวลา `trainer.priceFrom` และข้อความ “ระบบจะเก็บเวลานี้ไว้ 10 นาทีหลังยืนยัน”

- [ ] **Step 6: ลบ BookingStrip หลังไม่มี imports**

Run: `rtk rg -n "BookingStrip|booking-strip" app components lib`

Expected ก่อนลบ: พบเฉพาะไฟล์ที่จะลบ ถ้ายังมี consumer ให้ย้ายไป `ProfileBookingPanel` ก่อน

- [ ] **Step 7: เพิ่ม responsive CSS**

- 1280: media 31%, identity flexible, booking panel 30% sticky
- 768: media + identity สองคอลัมน์, booking panel full widthด้านล่าง
- 414/375/320: หนึ่งคอลัมน์และ mobile booking summary ติดล่างโดยไม่ทับ content
- ใช้ `overflow-wrap:anywhere` กับชื่อ ราคา และเวลา

- [ ] **Step 8: รัน GREEN**

Run: `rtk npm test -- components/trainer-detail.test.tsx components/profile-booking-panel.test.tsx components/booking-form.test.tsx`

Expected: PASS

Run: `rtk npm run typecheck`

Expected: PASS

Run: `rtk npm run lint`

Expected: exit 0; warning จาก Next 16.3 ที่มีอยู่เดิมต้องไม่เพิ่มจำนวนจากไฟล์ task นี้

- [ ] **Step 9: Commit**

```powershell
rtk git add components/trainer-detail.tsx components/trainer-detail.test.tsx components/profile-booking-panel.tsx components/profile-booking-panel.test.tsx components/booking-form.tsx components/booking-form.test.tsx components/booking-strip.tsx components/booking-strip.test.tsx app/booking/page.tsx app/globals.css
rtk git commit -m "feat: add direct trainer profile booking"
```

---

### Task 7: Member, trainer, admin และ chat states

**Files:**
- Modify: `lib/types.ts`
- Modify: `components/role-dashboard.tsx`
- Modify: `components/role-dashboard.test.tsx`
- Modify: `components/payment-panel.tsx`
- Modify: `components/payment-panel.test.tsx`
- Modify: `components/trainer-workbench.tsx`
- Modify: `components/trainer-workbench.test.tsx`
- Modify: `components/admin-review-queue.tsx`
- Modify: `components/admin-review-queue.test.tsx`
- Modify: `components/chat-workbench.tsx`
- Modify: `components/chat-workbench.test.tsx`
- Modify: `components/status-badge.tsx`
- Modify: `components/status-badge.test.tsx`
- Modify: `components/site-header.tsx`
- Modify: `components/site-header.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `Booking.paymentDeadlineAt`, `expired`, `<PaymentDeadline>` จาก Task 4
- Consumes: first/second rejection response จาก Task 3
- Produces: `BookingStatus` สุดท้ายที่ไม่มี `pending_trainer`
- Produces: member retry UI, trainer read-only held slots, admin queue refresh และ expired chat copy

- [ ] **Step 1: เขียน RED tests ของ member states**

```tsx
expect(screen.getByText("อัปโหลดสลิปภายใน 10 นาที")).toBeInTheDocument();
expect(screen.getByLabelText("เวลาที่เหลือสำหรับส่งสลิป")).toBeInTheDocument();
```

สำหรับ retry booking ที่ `paymentStatus: "rejected"`:

```tsx
expect(screen.getByText("สลิปไม่ผ่าน กรุณาส่งใหม่ภายใน 10 นาที")).toBeInTheDocument();
```

สำหรับ expired:

```tsx
expect(screen.getByText("การจองหมดเวลา ช่วงเวลานี้ถูกคืนแล้ว")).toBeInTheDocument();
expect(screen.queryByLabelText("อัปโหลดสลิป")).not.toBeInTheDocument();
```

- [ ] **Step 2: เขียน RED tests ของ trainer/admin/chat**

- trainer ไม่มีปุ่ม “ตอบรับ”, “ปฏิเสธ” หรือ field “ราคาที่แจ้ง”
- held slot แสดง “ล็อกชั่วคราว” และไม่มี action
- admin reject response ทั้งสองแบบทำให้รายการที่ตัดสินหายจาก queue และประกาศผลผ่าน status
- expired chat แสดง “หมดเวลาแล้ว” และ composer disabled/read-only

- [ ] **Step 3: รัน RED**

Run: `rtk npm test -- components/role-dashboard.test.tsx components/payment-panel.test.tsx components/trainer-workbench.test.tsx components/admin-review-queue.test.tsx components/chat-workbench.test.tsx`

Expected: FAIL เฉพาะ behavior ใหม่

- [ ] **Step 4: เชื่อม countdown กับการโหลดข้อมูลใหม่**

```tsx
{booking.actions.canPay && booking.paymentDeadlineAt && (
  <PaymentDeadline
    deadlineAt={booking.paymentDeadlineAt}
    onExpired={() => void loadMemberBookings()}
  />
)}
```

`PaymentPanel` ใช้ `booking.paymentStatus === "rejected"` เลือก heading/copy ของการส่งแก้ไข ไม่เก็บ attempt state เพิ่มใน client

- [ ] **Step 5: ตัด trainer decision UI และ state**

ลบ `quotedPrices`, decision notice, `decideBooking()`, pending booking projection และ request PATCH ไป `awaiting_payment/cancelled` เหลือ confirmed/completed appointments กับ availability slots

ส่วน schedule map state:

```ts
const slotStateCopy = {
  available: "พร้อมจอง",
  held: "ล็อกชั่วคราว",
  booked: "ยืนยันแล้ว",
  blocked: "ปิดช่วงเวลา",
} satisfies Record<SlotState, string>;
```

หลัง consumers เดิมถูกลบแล้ว ให้ลบ `pending_trainer` ออกจาก `BookingStatus` และ status map โดยไม่ใช้ cast หรือ fallback เพื่อกลบ type error

- [ ] **Step 6: ปรับ admin และ chat copy**

Admin ใช้ response `bookingStatus` เพื่อประกาศ “ให้สมาชิกส่งใหม่ภายใน 10 นาที” หรือ “ปฏิเสธครั้งที่สองและคืนช่วงเวลาแล้ว” โดยไม่คาดเดาจากจำนวน click

เพิ่ม `expired: "หมดเวลาแล้ว"` ใน chat status map; `canReadChat` ยังแสดงประวัติและ `canSendChat` ปิด composer

ไฟล์ที่แตะใน task นี้ให้เปลี่ยน `window.location.assign/href` เป็น `useRouter().push()` พร้อม test navigation เดิม รวมทั้ง `site-header` เพื่อให้กฎ lint ของ Next.js 16.3 ไม่มี warning ค้าง

- [ ] **Step 7: รัน GREEN และ full focused set**

Run: `rtk npm test -- components/role-dashboard.test.tsx components/payment-panel.test.tsx components/trainer-workbench.test.tsx components/admin-review-queue.test.tsx components/chat-workbench.test.tsx lib/dashboard-actions.test.ts components/status-badge.test.tsx components/payment-deadline.test.tsx`

Expected: PASS

Run: `rtk npm run typecheck`

Expected: PASS และไม่มี `pending_trainer` ใน TypeScript

Run: `rtk rg -n "pending_trainer|รอเทรนเนอร์ตอบรับ|ราคาที่แจ้ง" components lib app`

Expected: ไม่พบ workflow เดิม

- [ ] **Step 8: Commit**

```powershell
rtk git add lib/types.ts components/role-dashboard.tsx components/role-dashboard.test.tsx components/payment-panel.tsx components/payment-panel.test.tsx components/trainer-workbench.tsx components/trainer-workbench.test.tsx components/admin-review-queue.tsx components/admin-review-queue.test.tsx components/chat-workbench.tsx components/chat-workbench.test.tsx components/status-badge.tsx components/status-badge.test.tsx components/site-header.tsx components/site-header.test.tsx lib/dashboard-actions.ts lib/dashboard-actions.test.ts app/globals.css
rtk git commit -m "feat: align role workspaces with instant booking"
```

---

### Task 8: Live migration, smoke, audit, docs และ final verification

**Files:**
- Modify: `scripts/api-payment-chat-review-smoke.ps1`
- Modify: `backend/database/audit_booking.sql`
- Modify: `scripts/audit-booking.ps1`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `.impeccable/surfaces/transaction-surfaces.md`

**Interfaces:**
- Consumes: ทุก API, schema และ UI จาก Task 1-7
- Produces: live booking IDs สำหรับ retry-approved flow และ expired-rebook flow
- Produces: ignored evidence file `output/smoke/instant-booking-result.json` ที่มี `approvedBookingId` และ `expiredBookingId`
- Produces: phpMyAdmin/audit evidence ของ booking, history, payments, chat และ slot

- [ ] **Step 1: เขียน smoke assertions ก่อนแก้ script flow**

แก้ scenario `all` ให้ assert response สร้าง booking:

```powershell
Assert-Equal 'awaiting_payment' $booking.status 'new booking status'
Assert-True ($booking.quotedPrice -gt 0) 'quoted price must be snapshotted'
Assert-True ([DateTime]::Parse($booking.paymentDeadlineAt).ToUniversalTime() -gt [DateTime]::UtcNow) 'deadline must be in the future'
```

ลบ trainer acceptance request จาก smoke และเพิ่ม sequence: upload 1 -> admin reject -> assert new deadline -> upload 2 -> admin approve

- [ ] **Step 2: เพิ่ม expiry smoke**

สร้าง booking ที่สอง ใช้ MySQL test setup เปลี่ยน deadline เป็นอดีต แล้วเรียก `GET /v1/bookings` เพื่อ trigger expiry:

```sql
SET @expiry_booking_id = ?;

UPDATE bookings
SET payment_deadline_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)
WHERE public_id = @expiry_booking_id;
```

ให้ smoke script bind ID ที่เพิ่งสร้างแทน `?`, assert booking เป็น `expired`, history มี transition หนึ่งแถว, slot เป็น `available` จากนั้นให้สมาชิกอีกคน POST slot เดิมและ assert success สุดท้ายเขียน ID ของทั้งสอง flow ลง `output/smoke/instant-booking-result.json`

- [ ] **Step 3: อัปเดต audit SQL**

สำหรับ booking ID ที่รับจาก parameter ให้รายงาน:

```sql
SELECT public_id, status, payment_status, quoted_price, payment_deadline_at
FROM bookings WHERE public_id = @booking_public_id;

SELECT from_status, to_status, note, created_at
FROM booking_status_history
WHERE booking_id = (SELECT id FROM bookings WHERE public_id = @booking_public_id)
ORDER BY id;

SELECT status, amount, submitted_at, reviewed_at
FROM payments
WHERE booking_id = (SELECT id FROM bookings WHERE public_id = @booking_public_id)
ORDER BY id;
```

เพิ่ม slot assertion ว่า approved flow เป็น `booked` และ expired flow หลัง rebook เป็น `held`

- [ ] **Step 4: รัน migration preflight และ backup จริง**

Run: `rtk npm run xampp:connect`

Expected: API junction ถูกต้องหรือรายงานว่าเชื่อมกับ checkout นี้อยู่แล้ว

Run: `rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-instant-booking.ps1 -PreflightOnly`

Expected: `legacy` หรือ `migrated`; ห้ามเป็น `partial`

Run: `rtk npm run migrate:instant-booking`

Expected: สร้าง backup นอก repository ก่อน DDL และ postflight รายงาน migrated contract ครบ

- [ ] **Step 5: รัน PHP และ live workflow**

Run: `rtk npm run test:php`

Expected: ทุก PHP test PASS

Run: `rtk npm run smoke:postbooking`

Expected: retry-approved flow และ expired-rebook flow PASS พร้อม booking IDs ใหม่

Run:

```powershell
rtk powershell -NoProfile -Command "$result = Get-Content 'output/smoke/instant-booking-result.json' | ConvertFrom-Json; & 'scripts/audit-booking.ps1' -BookingId $result.approvedBookingId"
```

Expected: booking/history/payments/rooms/messages/reviews และ slot ตรงกับ approved flow จาก ID จริงใน evidence file จากนั้นรันคำสั่งเดียวกันกับ `$result.expiredBookingId` เพื่อตรวจ expiry history และ slot ที่ถูก rebook

- [ ] **Step 6: อัปเดตเอกสาร contract**

- `PRODUCT.md`: เปลี่ยน operating context จาก trainer accept เป็น fixed price + 10-minute payment hold
- `DESIGN.md`: บันทึก Marketplace Grid, Commerce Detail, fixed-price copy, expired state และ mobile Sheet
- `.impeccable/surfaces/transaction-surfaces.md`: ลบ trainer-response notice และเพิ่ม `paymentDeadlineAt`, retry once, request-driven expiry
- `README.md`: คำสั่ง migration, smoke, audit และคำอธิบาย manual admin review

- [ ] **Step 7: รัน frontend gate หนึ่งรอบ**

Run: `rtk npm test -- --run`

Expected: ทุก test file และทุก test PASS

Run: `rtk npm run lint`

Expected: exit 0 และไม่มี warning จาก `window.location.assign/href` หลัง cleanup ใน Task 7

Run: `rtk npm run typecheck`

Expected: PASS

Run: `rtk npm run build`

Expected: Next.js 16.3.0 build PASS ครบ 13 routes

Run: `rtk node C:\Users\HP\.agents\skills\impeccable\scripts\detect.mjs --json components/trainer-discovery.tsx components/trainer-marketplace-filters.tsx components/trainer-marketplace-card.tsx components/trainer-detail.tsx components/profile-booking-panel.tsx components/booking-form.tsx components/role-dashboard.tsx components/payment-panel.tsx components/trainer-workbench.tsx components/admin-review-queue.tsx components/chat-workbench.tsx app/globals.css`

Expected: `[]`

- [ ] **Step 8: รัน bounded browser matrix**

ใช้ fresh dev server และตรวจ `/trainers`, โปรไฟล์หนึ่งคน, `/booking`, `/member`, `/trainer`, `/admin`, `/chat` ที่ 1280/768/414/375/320

Assert ต่อ route/state:

- page `scrollWidth === clientWidth`
- mobile filter Sheet เปิด ปิด และคืน focus
- profile CTA ไม่ถูก sticky panel ทับ
- confirmation Dialog ใช้ Tab, Shift+Tab, Escape และคืน focus
- countdown แสดงโดยไม่ประกาศทุกวินาที
- expired, retry, loading, empty, error, disabled และ busy state อ่านได้
- 200% zoom ยังเข้าถึง primary CTA
- reduced motion ไม่มี non-essential transition

ใช้รอบตรวจหนึ่งรอบ แก้ defects เป็น batch เดียว และยืนยันอีกไม่เกินหนึ่งรอบ

- [ ] **Step 9: Final scope audit และ commit**

Run: `rtk git diff --check`

Expected: ไม่มี whitespace errors

Run: `rtk git status --short`

Expected: มีเฉพาะไฟล์ task ที่ตั้งใจแก้; `.superpowers/` และ `graphify-out/` ไม่ถูก stage

```powershell
rtk git add scripts/api-payment-chat-review-smoke.ps1 backend/database/audit_booking.sql scripts/audit-booking.ps1 README.md PRODUCT.md DESIGN.md .impeccable/surfaces/transaction-surfaces.md
rtk git commit -m "test: verify instant booking end to end"
```

---

## Final acceptance checklist

- [ ] Next.js และ `eslint-config-next` เป็น 16.3.0
- [ ] Marketplace Grid และ Commerce Detail ตรงตามสเปกที่อนุมัติ
- [ ] ราคาใน UI, booking, payment, admin และ chat ใช้ snapshot เดียวกัน
- [ ] ไม่มี `pending_trainer` หรือ trainer accept/reject/quote path
- [ ] เส้นตายแรก 10 นาทีและ retry 10 นาทีใช้เวลาฐานข้อมูล
- [ ] เวลาเท่ากับ deadline ถูกปฏิเสธ
- [ ] first reject เปิด retry หนึ่งครั้ง และ second reject คืน slot
- [ ] expiry และ booking ใหม่ไม่ทำให้ slot ถูกถือพร้อมกันสองรายการ
- [ ] upload หลังหมดเวลาถูกลบและไม่สร้างไฟล์กำพร้า
- [ ] `expired` อ่าน chat history ได้แต่ส่งไม่ได้
- [ ] migration มี backup, partial refusal และ postflight
- [ ] XAMPP smoke และ audit ใช้ booking IDs ใหม่และตรวจ phpMyAdmin data ครบ
- [ ] frontend tests, PHP tests, lint, typecheck, build และ detector ผ่าน
- [ ] responsive, keyboard, 200% zoom และ reduced motion ผ่าน bounded visual matrix
