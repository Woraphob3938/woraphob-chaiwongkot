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

test('keeps a slot held when the trainer accepts', function (): void {
    assertSameValue('held', WorkflowRules::trainerBookingSlotState('pending_trainer', 'awaiting_payment'));
});

test('releases a slot when the trainer rejects', function (): void {
    assertSameValue('available', WorkflowRules::trainerBookingSlotState('pending_trainer', 'cancelled'));
});

test('rejects a repeated trainer booking decision', function (): void {
    expectHttp(
        409,
        'BOOKING_ALREADY_DECIDED',
        fn() => WorkflowRules::trainerBookingSlotState('awaiting_payment', 'cancelled')
    );
});

test('rejects a trainer booking status outside the decision flow', function (): void {
    expectHttp(
        422,
        'INVALID_TRAINER_TRANSITION',
        fn() => WorkflowRules::trainerBookingSlotState('pending_trainer', 'confirmed')
    );
});

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
