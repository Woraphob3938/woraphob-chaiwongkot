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

test('first rejected payment opens one ten minute retry', function (): void {
    $rejectedAt = new DateTimeImmutable('2026-08-10T04:00:00.000Z');
    $result = WorkflowRules::paymentRejectionTransition(0, $rejectedAt);
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

test('trainer booking decisions are no longer part of workflow rules', function (): void {
    assertSameValue(false, method_exists(WorkflowRules::class, 'trainerBookingSlotState'));
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

test('accepts the agreed monthly sessions inside thirty days', function (): void {
    WorkflowRules::assertMonthlyBookingSlots([
        ['id' => 11, 'starts_at' => '2026-08-03 02:00:00', 'ends_at' => '2026-08-03 03:00:00'],
        ['id' => 12, 'starts_at' => '2026-08-10 02:00:00', 'ends_at' => '2026-08-10 03:00:00'],
        ['id' => 13, 'starts_at' => '2026-08-17 02:00:00', 'ends_at' => '2026-08-17 03:00:00'],
        ['id' => 14, 'starts_at' => '2026-08-24 02:00:00', 'ends_at' => '2026-08-24 03:00:00'],
    ], 4);
});

test('rejects a monthly booking with the wrong session count', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertMonthlyBookingSlots([
        ['id' => 11, 'starts_at' => '2026-08-03 02:00:00', 'ends_at' => '2026-08-03 03:00:00'],
        ['id' => 12, 'starts_at' => '2026-08-10 02:00:00', 'ends_at' => '2026-08-10 03:00:00'],
    ], 4));
});

test('rejects monthly sessions outside the thirty day period', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertMonthlyBookingSlots([
        ['id' => 11, 'starts_at' => '2026-08-03 02:00:00', 'ends_at' => '2026-08-03 03:00:00'],
        ['id' => 12, 'starts_at' => '2026-09-02 03:00:00', 'ends_at' => '2026-09-02 04:00:01'],
    ], 2));
});

test('requires a payment rejection note', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => WorkflowRules::assertPaymentDecision('reviewing', 'payment_review', 'reject', ''));
});

test('payment decisions require a reviewing payment and payment review booking', function (): void {
    expectHttp(409, 'PAYMENT_ALREADY_REVIEWED', fn() => WorkflowRules::assertPaymentDecision('rejected', 'awaiting_payment', 'approve', ''));
});

test('blocks chat after an unpaid booking expires', function (): void {
    expectHttp(409, 'CHAT_READ_ONLY', fn() => WorkflowRules::assertChatWritable('expired'));
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
