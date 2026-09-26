<?php
declare(strict_types=1);

$servicePath = __DIR__ . '/../src/NotificationService.php';
if (is_file($servicePath)) {
    require_once $servicePath;
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

test('uses bounded retry delays for the first four failures', function (): void {
    assertSameValue(1, NotificationService::retryDelayMinutes(1));
    assertSameValue(5, NotificationService::retryDelayMinutes(2));
    assertSameValue(15, NotificationService::retryDelayMinutes(3));
    assertSameValue(60, NotificationService::retryDelayMinutes(4));
});

test('stops retrying after the fifth failed attempt', function (): void {
    $state = NotificationService::failureState(5, 'smtp password=secret failed');
    assertSameValue('failed', $state['status']);
    assertSameValue(5, $state['attemptCount']);
    assertSameValue(null, $state['nextAttemptAt']);
    assertSameValue(false, str_contains($state['lastError'], 'secret'));
});

test('schedules a retry before the fifth failed attempt', function (): void {
    $state = NotificationService::failureState(2, 'temporary connection failed');
    assertSameValue('failed', $state['status']);
    assertSameValue(2, $state['attemptCount']);
    assertSameValue(true, $state['nextAttemptAt'] instanceof DateTimeImmutable);
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
