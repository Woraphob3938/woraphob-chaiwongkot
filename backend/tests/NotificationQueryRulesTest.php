<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Http.php';
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

test('parses and caps a zero-based page', function (): void {
    assertSameValue(0, NotificationService::parsePage('0'));
    assertSameValue(100000, NotificationService::parsePage('100001'));
    expectHttp(422, 'VALIDATION_FAILED', fn() => NotificationService::parsePage('-1'));
});

test('accepts only approved notification categories', function (): void {
    assertSameValue('all', NotificationService::parseCategory('all'));
    assertSameValue('appointment', NotificationService::parseCategory('appointment'));
    expectHttp(422, 'VALIDATION_FAILED', fn() => NotificationService::parseCategory('admin'));
});

test('parses an explicit unread boolean', function (): void {
    assertSameValue(false, NotificationService::parseUnread('false'));
    assertSameValue(true, NotificationService::parseUnread('true'));
    expectHttp(422, 'VALIDATION_FAILED', fn() => NotificationService::parseUnread('sometimes'));
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
