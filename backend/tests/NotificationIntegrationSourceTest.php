<?php
declare(strict_types=1);

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

function assertSourceContains(string $source, string $needle): void
{
    assertSameValue(true, str_contains($source, $needle));
}

function assertSourceDoesNotContain(string $source, string $needle): void
{
    assertSameValue(false, str_contains($source, $needle));
}

$source = implode("\n", array_map('file_get_contents', [__DIR__ . '/../src/Handlers.php', ...glob(__DIR__ . '/../src/handlers/*.php')]));
if ($source === false) {
    throw new RuntimeException('Could not read Handlers.php');
}

// Slip submitted / rejected events belonged to the bank-slip review, which
// Stripe Checkout replaced.
test('wires all approved notification events into booking workflows', function () use ($source): void {
    foreach ([
        'NotificationRules::BOOKING_CREATED',
        'NotificationRules::PAYMENT_APPROVED',
        'NotificationRules::BOOKING_EXPIRED',
        'NotificationRules::BOOKING_CANCELLED',
        'NotificationRules::BOOKING_ACCEPTED',
        'NotificationRules::BOOKING_REJECTED',
        'NotificationRules::MESSAGE_RECEIVED',
        'NotificationRules::TRAINER_APPLICATION_APPROVED',
        'NotificationRules::TRAINER_APPLICATION_REJECTED',
    ] as $event) {
        assertSourceContains($source, $event);
    }
});

test('starts the payment clock as soon as the trainer accepts', function () use ($source): void {
    assertSourceContains($source, 'WorkflowRules::acceptancePaymentDeadline');
    assertSourceContains($source, 'NotificationRules::BOOKING_ACCEPTED');
    assertSourceContains($source, 'WorkflowRules::assertTrainerDecision');
    assertSourceContains($source, 'WorkflowRules::assertTrainerCancellation');
});

test('delivers notification ids only after database transactions return', function () use ($source): void {
    assertSourceContains($source, '$this->notifications->deliverByIds($notificationIds)');
});

$failures = 0;
test('allows administrators through every personal notification endpoint', function () use ($source): void {
    foreach (['notifications', 'notification', 'readNotification', 'readAllNotifications'] as $method) {
        preg_match('/public function ' . $method . '\([^)]*\): never\s*\{(.*?)\n    \}/s', $source, $matches);
        assertSourceContains($matches[1] ?? '', "requireUser(['member', 'trainer', 'admin'])");
    }
});

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
