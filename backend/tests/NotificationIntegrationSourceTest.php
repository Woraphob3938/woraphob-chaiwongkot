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

$source = file_get_contents(__DIR__ . '/../src/Handlers.php');
if ($source === false) {
    throw new RuntimeException('Could not read Handlers.php');
}

test('wires all approved notification events into booking workflows', function () use ($source): void {
    foreach ([
        'NotificationRules::BOOKING_CREATED',
        'NotificationRules::PAYMENT_SUBMITTED',
        'NotificationRules::PAYMENT_APPROVED',
        'NotificationRules::PAYMENT_REJECTED_RETRY',
        'NotificationRules::PAYMENT_REJECTED_FINAL',
        'NotificationRules::BOOKING_EXPIRED',
        'NotificationRules::BOOKING_CANCELLED',
    ] as $event) {
        assertSourceContains($source, $event);
    }
});

test('keeps trainer acceptance out of the workflow', function () use ($source): void {
    assertSourceDoesNotContain($source, 'trainer_accept');
    assertSourceDoesNotContain($source, 'notifyTrainerBeforePayment');
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
