<?php
declare(strict_types=1);

$mailerPath = __DIR__ . '/../src/GmailMailer.php';
if (is_file($mailerPath)) {
    require_once $mailerPath;
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

function assertContainsValue(string $needle, string $actual): void
{
    if (!str_contains($actual, $needle)) {
        throw new RuntimeException("Expected payload to contain: {$needle}");
    }
}

function assertNotContainsValue(string $needle, string $actual): void
{
    if (str_contains($actual, $needle)) {
        throw new RuntimeException("Payload must not contain: {$needle}");
    }
}

function mailConfig(bool $enabled): array
{
    return [
        'enabled' => $enabled,
        'host' => 'smtp.gmail.com',
        'port' => 587,
        'username' => 'fitconnect.sender@gmail.com',
        'app_password' => 'secret-app-password',
        'from_email' => 'fitconnect.sender@gmail.com',
        'from_name' => 'FitConnect',
        'app_url' => 'http://localhost:3000',
    ];
}

test('disabled mail never invokes the transport', function (): void {
    $called = false;
    $mailer = new GmailMailer(mailConfig(false), function () use (&$called): void {
        $called = true;
    });
    assertSameValue(false, $mailer->isEnabled());
    $mailer->send('member@example.com', 'สมาชิก', 'หัวข้อ', 'ข้อความ', '/member');
    assertSameValue(false, $called);
});

test('builds a safe multipart Gmail SMTP request', function (): void {
    $captured = null;
    $mailer = new GmailMailer(mailConfig(true), function (array $request) use (&$captured): void {
        $captured = $request;
    });
    $mailer->send(
        'member@example.com',
        '<script>สมาชิก</script>',
        'ยืนยันการจองแล้ว',
        '<script>เปิดไม่ได้</script>',
        '/member'
    );

    assertSameValue('smtp://smtp.gmail.com:587', $captured['url']);
    assertSameValue('fitconnect.sender@gmail.com', $captured['username']);
    assertSameValue('secret-app-password', $captured['password']);
    assertContainsValue('Subject: [FitConnect]', $captured['payload']);
    assertContainsValue('multipart/alternative', $captured['payload']);
    assertContainsValue('http://localhost:3000/member', $captured['payload']);
    assertContainsValue('Content-Type: text/plain; charset=UTF-8', $captured['payload']);
    assertContainsValue('Content-Type: text/html; charset=UTF-8', $captured['payload']);
    assertNotContainsValue('<script>', $captured['payload']);
    assertNotContainsValue('secret-app-password', $captured['payload']);
});

test('rejects external action paths before transport', function (): void {
    $mailer = new GmailMailer(mailConfig(true), static function (): void {});
    try {
        $mailer->send('member@example.com', 'สมาชิก', 'หัวข้อ', 'ข้อความ', 'https://example.com');
    } catch (InvalidArgumentException) {
        return;
    }
    throw new RuntimeException('Expected external action path to be rejected.');
});

test('rejects backslash action paths before transport', function (): void {
    $mailer = new GmailMailer(mailConfig(true), static function (): void {});
    try {
        $mailer->send('member@example.com', 'สมาชิก', 'หัวข้อ', 'ข้อความ', '/\\example.com');
    } catch (InvalidArgumentException) {
        return;
    }
    throw new RuntimeException('Expected backslash action path to be rejected.');
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
