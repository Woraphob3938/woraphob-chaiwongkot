<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Http.php';
$rulesPath = __DIR__ . '/../src/WorkflowRules.php';
if (is_file($rulesPath)) {
    require_once $rulesPath;
}

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
    assertSameValue(
        '2026-08-10 02:00:00',
        WorkflowRules::parseUtc('2026-08-10T02:00:00.000Z', 'startsAt')->format('Y-m-d H:i:s')
    );
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

test('rejects a slot that starts now', function () use ($now): void {
    expectHttp(
        422,
        'VALIDATION_FAILED',
        fn() => WorkflowRules::assertAvailabilityWindow($now, $now, $now->modify('+1 hour'))
    );
});

test('rejects a slot whose end precedes its start', function () use ($now): void {
    expectHttp(
        422,
        'VALIDATION_FAILED',
        fn() => WorkflowRules::assertAvailabilityWindow($now, $now->modify('+2 hours'), $now->modify('+1 hour'))
    );
});

test('rejects a slot that starts beyond two months', function () use ($now): void {
    expectHttp(
        422,
        'VALIDATION_FAILED',
        fn() => WorkflowRules::assertAvailabilityWindow(
            $now,
            $now->modify('+2 months +1 second'),
            $now->modify('+2 months +1 hour')
        )
    );
});

test('allows approval of a pending trainer without a note', function (): void {
    WorkflowRules::assertTrainerApplicationDecision('pending', 'approve', '');
});

test('requires a rejection note for a pending trainer', function (): void {
    expectHttp(
        422,
        'VALIDATION_FAILED',
        fn() => WorkflowRules::assertTrainerApplicationDecision('pending', 'reject', '')
    );
});

test('rejects a repeated trainer application decision', function (): void {
    expectHttp(
        409,
        'TRAINER_ALREADY_REVIEWED',
        fn() => WorkflowRules::assertTrainerApplicationDecision('approved', 'reject', 'เอกสารไม่ครบ')
    );
});

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

test('accepts or rejects only while the trainer decision is pending', function (): void {
    WorkflowRules::assertTrainerDecision('pending_trainer', 'accept');
    WorkflowRules::assertTrainerDecision('pending_trainer', 'reject');
    expectHttp(409, 'INVALID_BOOKING_TRANSITION', fn() => WorkflowRules::assertTrainerDecision('awaiting_payment', 'accept'));
    expectHttp(409, 'INVALID_BOOKING_TRANSITION', fn() => WorkflowRules::assertTrainerDecision('confirmed', 'reject'));
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertTrainerDecision('pending_trainer', 'maybe'));
});

function utc(string $value): DateTimeImmutable
{
    return new DateTimeImmutable($value, new DateTimeZone('UTC'));
}

test('accepting opens a ten minute payment window at once', function (): void {
    $deadline = WorkflowRules::acceptancePaymentDeadline(utc('2026-08-20 02:30:00'), utc('2026-08-22 02:00:00'));
    assertSameValue('2026-08-20 02:40:00', $deadline->format('Y-m-d H:i:s'));
});

test('refuses an acceptance the member could not pay for before the session', function (): void {
    expectHttp(
        422,
        'ACCEPTANCE_TOO_LATE',
        fn() => WorkflowRules::acceptancePaymentDeadline(utc('2026-08-20 02:30:00'), utc('2026-08-20 02:35:00'))
    );
    // Exactly ten minutes before the session is still allowed.
    WorkflowRules::acceptancePaymentDeadline(utc('2026-08-20 02:30:00'), utc('2026-08-20 02:40:00'));
});

test('trainer cancellation covers every stage before completion', function (): void {
    foreach (['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed'] as $status) {
        WorkflowRules::assertTrainerCancellation($status);
    }
});

test('trainer cancellation refuses closed bookings', function (): void {
    foreach (['completed', 'cancelled', 'expired'] as $status) {
        expectHttp(409, 'BOOKING_CANCELLATION_NOT_ALLOWED', fn() => WorkflowRules::assertTrainerCancellation($status));
    }
});

test('a member may withdraw a request that still waits for the trainer', function (): void {
    WorkflowRules::assertMemberCancellation('pending_trainer', 'not_submitted');
    expectHttp(
        409,
        'MEMBER_CANCELLATION_NOT_ALLOWED',
        fn() => WorkflowRules::assertMemberCancellation('confirmed', 'approved')
    );
});

test('a free future slot can be moved', function (): void {
    $now = new DateTimeImmutable('2026-08-01T00:00:00.000Z');
    WorkflowRules::assertSlotEditable('available', $now->modify('+1 day'), $now);
});

test('a held, booked or started slot cannot be moved', function (): void {
    $now = new DateTimeImmutable('2026-08-01T00:00:00.000Z');
    expectHttp(409, 'SLOT_NOT_EDITABLE', fn() => WorkflowRules::assertSlotEditable('held', $now->modify('+1 day'), $now));
    expectHttp(409, 'SLOT_NOT_EDITABLE', fn() => WorkflowRules::assertSlotEditable('booked', $now->modify('+1 day'), $now));
    expectHttp(409, 'SLOT_NOT_EDITABLE', fn() => WorkflowRules::assertSlotEditable('available', $now->modify('-1 hour'), $now));
});

test('normalizes a positive money value', function (): void {
    assertSameValue('1200.50', WorkflowRules::normalizeMoney('1200.5', 'quotedPrice'));
});

test('rejects money with more than two decimal places', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::normalizeMoney('1200.555', 'amount'));
});

test('sets every availability slot to one hour', function (): void {
    $startsAt = new DateTimeImmutable('2026-08-10T02:00:00.000Z');
    assertSameValue('2026-08-10 03:00:00', WorkflowRules::availabilityEnd($startsAt)->format('Y-m-d H:i:s'));
});

test('starts a monthly package with exactly one appointment', function (): void {
    WorkflowRules::assertMonthlyBookingStart([
        ['id' => 11, 'starts_at' => '2026-08-03 02:00:00', 'ends_at' => '2026-08-03 03:00:00'],
    ], 4);
});

test('rejects selecting every monthly appointment before payment', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertMonthlyBookingStart([
        ['id' => 11, 'starts_at' => '2026-08-03 02:00:00', 'ends_at' => '2026-08-03 03:00:00'],
        ['id' => 12, 'starts_at' => '2026-08-10 02:00:00', 'ends_at' => '2026-08-10 03:00:00'],
    ], 4));
});

test('accepts a remaining monthly appointment only after approved payment and inside the package period', function (): void {
    WorkflowRules::assertMonthlySessionScheduling(
        'confirmed',
        'approved',
        1,
        4,
        new DateTimeImmutable('2026-08-03 02:00:00', new DateTimeZone('UTC')),
        new DateTimeImmutable('2026-09-02 02:00:00', new DateTimeZone('UTC')),
        new DateTimeImmutable('2026-08-10 02:00:00', new DateTimeZone('UTC')),
        new DateTimeImmutable('2026-08-10 03:00:00', new DateTimeZone('UTC')),
    );
});

test('blocks chat after an unpaid booking expires', function (): void {
    expectHttp(409, 'CHAT_READ_ONLY', fn() => WorkflowRules::assertChatWritable('expired'));
});

test('completed bookings close chat while ongoing bookings remain writable', function (): void {
    expectHttp(409, 'CHAT_READ_ONLY', fn() => WorkflowRules::assertChatWritable('completed'));
    WorkflowRules::assertChatWritable('confirmed');
});

test('allows a member to cancel before submitting payment evidence', function (): void {
    WorkflowRules::assertMemberCancellation('awaiting_payment', 'not_submitted');
    WorkflowRules::assertMemberCancellation('awaiting_payment', 'rejected');
});

test('blocks member cancellation after payment evidence is submitted', function (): void {
    expectHttp(
        409,
        'MEMBER_CANCELLATION_NOT_ALLOWED',
        fn() => WorkflowRules::assertMemberCancellation('payment_review', 'reviewing')
    );
    expectHttp(
        409,
        'MEMBER_CANCELLATION_NOT_ALLOWED',
        fn() => WorkflowRules::assertMemberCancellation('confirmed', 'approved')
    );
});

test('allows completion after a paid appointment ends', function (): void {
    WorkflowRules::assertTrainerCompletion(
        'confirmed',
        'approved',
        new DateTimeImmutable('2026-08-01T01:00:00.000Z'),
        new DateTimeImmutable('2026-08-01T01:01:00.000Z')
    );
});

test('blocks monthly completion until every package session is scheduled', function (): void {
    expectHttp(
        409,
        'MONTHLY_SESSIONS_INCOMPLETE',
        fn() => WorkflowRules::assertTrainerCompletion(
            'confirmed',
            'approved',
            new DateTimeImmutable('2026-08-01T01:00:00.000Z'),
            new DateTimeImmutable('2026-08-01T02:00:00.000Z'),
            1,
            4,
            new DateTimeImmutable('2026-08-31T01:00:00.000Z')
        )
    );
});

test('allows monthly completion after package period ends even if not all sessions scheduled', function (): void {
    WorkflowRules::assertTrainerCompletion(
        'confirmed',
        'approved',
        new DateTimeImmutable('2026-08-01T01:00:00.000Z'),
        new DateTimeImmutable('2026-09-02T00:00:00.000Z'),
        2,
        10,
        new DateTimeImmutable('2026-09-01T00:00:00.000Z')
    );
});

test('blocks completion exactly at a paid appointment end', function (): void {
    $endsAt = new DateTimeImmutable('2026-08-01T01:00:00.000Z');
    expectHttp(
        409,
        'BOOKING_END_NOT_REACHED',
        fn() => WorkflowRules::assertTrainerCompletion('confirmed', 'approved', $endsAt, $endsAt)
    );
});

test('requires a non-empty review comment', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertReviewSubmission('completed', 5, '   '));
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
