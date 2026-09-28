<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/SlipRules.php';

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

function tlv(string $tag, string $value): string
{
    return $tag . str_pad((string) strlen($value), 2, '0', STR_PAD_LEFT) . $value;
}

/** A slip mini QR as Thai banks print it, with a valid CRC. */
function slipPayload(string $bank, string $reference): string
{
    $inner = tlv('00', '000001') . tlv('01', $bank) . tlv('02', $reference);
    $body = tlv('00', $inner) . tlv('51', 'TH') . '9104';
    return $body . SlipRules::crc16($body);
}

test('computes the CRC-16/CCITT-FALSE check value', function (): void {
    assertSameValue('29B1', SlipRules::crc16('123456789'));
});

test('reads the bank and reference from a genuine slip payload', function (): void {
    $parsed = SlipRules::parseSlipQr(slipPayload('004', '2026092712345678901'));
    assertSameValue('004', $parsed['bank'] ?? null);
    assertSameValue('2026092712345678901', $parsed['reference'] ?? null);
    assertSameValue('004:2026092712345678901', $parsed['key'] ?? null);
});

test('rejects a payload that was edited after printing', function (): void {
    $payload = slipPayload('004', '2026092712345678901');
    $edited = str_replace('2026092712345678901', '2026092712345678902', $payload);
    assertSameValue(null, SlipRules::parseSlipQr($edited));
});

test('rejects anything that is not a slip payload', function (): void {
    foreach (['', 'hello', 'https://example.com', str_repeat('0', 600), '00020101021129370016A000000677010111'] as $value) {
        assertSameValue(null, SlipRules::parseSlipQr($value));
    }
});

test('keeps the quoted price and adds the first free satang', function (): void {
    assertSameValue('500.01', SlipRules::transferAmount('500.00', []));
    assertSameValue('500.03', SlipRules::transferAmount('500.00', [1, 2]));
});

test('never charges less than a quoted price that already has satang', function (): void {
    assertSameValue('1234.51', SlipRules::transferAmount('1234.50', []));
    // 51 is taken, so the next distinct satang is used.
    assertSameValue('1234.52', SlipRules::transferAmount('1234.50', [51]));
});

test('skips a whole-baht result so every amount carries satang', function (): void {
    assertSameValue('100.01', SlipRules::transferAmount('99.99', [1 => 0]));
    assertSameValue('101.01', SlipRules::transferAmount('100.99', []));
});

test('accepts a collision only when all 99 satang are taken', function (): void {
    assertSameValue('500.01', SlipRules::transferAmount('500.00', range(1, 99)));
});

$failures = 0;
foreach ($tests as $name => $callback) {
    try {
        $callback();
        echo "PASS {$name}" . PHP_EOL;
    } catch (Throwable $error) {
        $failures++;
        echo "FAIL {$name}: {$error->getMessage()}" . PHP_EOL;
    }
}
echo count($tests) . ' tests, ' . $failures . ' failures' . PHP_EOL;
exit($failures === 0 ? 0 : 1);
