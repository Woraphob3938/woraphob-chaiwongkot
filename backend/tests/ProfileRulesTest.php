<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Http.php';
$rulesPath = __DIR__ . '/../src/ProfileRules.php';
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

function expectHttp(int $status, string $code, Closure $callback, ?string $field = null): void
{
    try {
        $callback();
    } catch (HttpException $error) {
        assertSameValue($status, $error->status);
        assertSameValue($code, $error->errorCode);
        if ($field !== null && !array_key_exists($field, $error->fields)) {
            throw new RuntimeException("Expected field error for {$field}");
        }
        return;
    }
    throw new RuntimeException("Expected HttpException {$status} {$code}");
}

test('normalizes a member profile', function (): void {
    assertSameValue([
        'firstName' => 'สมชาย',
        'lastName' => 'ใจดี',
        'phone' => '0812345678',
        'fitnessGoal' => 'เพิ่มความแข็งแรง',
        'experienceLevel' => 'beginner',
        'weight' => 70.5,
        'height' => 175.0,
    ], ProfileRules::member([
        'firstName' => ' สมชาย ',
        'lastName' => ' ใจดี ',
        'phone' => ' 0812345678 ',
        'fitnessGoal' => ' เพิ่มความแข็งแรง ',
        'experienceLevel' => 'beginner',
        'weight' => '70.50',
        'height' => '175',
    ]));
});

test('requires both member names', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::member([
        'firstName' => 'สมชาย',
        'lastName' => ' ',
    ]), 'lastName');
});

test('rejects non-positive body measurements', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::member([
        'firstName' => 'สมชาย',
        'lastName' => 'ใจดี',
        'weight' => '0',
        'height' => '-1',
    ]), 'weight');
});

test('rejects an unsupported experience level', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::member([
        'firstName' => 'สมชาย',
        'lastName' => 'ใจดี',
        'experienceLevel' => 'expert',
    ]), 'experienceLevel');
});

test('rejects an invalid member phone', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::member([
        'firstName' => 'สมชาย',
        'lastName' => 'ใจดี',
        'phone' => 'abc',
    ]), 'phone');
});

test('normalizes a trainer profile', function (): void {
    assertSameValue([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'phone' => '0899999999',
        'headline' => 'สร้างความแข็งแรงอย่างเป็นระบบ',
        'bio' => 'วางแผนตามเป้าหมาย',
        'yearsExperience' => 6,
        'serviceMode' => 'both',
        'gymName' => 'Fit Gym',
        'priceFrom' => 650.0,
        'monthlyPrice' => 2400.0,
        'monthlySessionCount' => 4,
        'trainingTypeIds' => [1, 3],
    ], ProfileRules::trainer([
        'displayName' => ' ครูเมย์ ',
        'legalName' => ' เมย์ ใจดี ',
        'phone' => '0899999999',
        'headline' => ' สร้างความแข็งแรงอย่างเป็นระบบ ',
        'bio' => ' วางแผนตามเป้าหมาย ',
        'yearsExperience' => '6',
        'serviceMode' => 'both',
        'gymName' => ' Fit Gym ',
        'priceFrom' => '650',
        'monthlyPrice' => '2400',
        'monthlySessionCount' => '4',
        'trainingTypeIds' => [3, 1, 3],
    ]));
});

test('requires monthly price and session count together', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'serviceMode' => 'freelance',
        'yearsExperience' => 3,
        'monthlyPrice' => 2400,
        'trainingTypeIds' => [1],
    ]), 'monthlySessionCount');
});

test('limits a monthly package to thirty sessions', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'serviceMode' => 'freelance',
        'yearsExperience' => 3,
        'monthlyPrice' => 2400,
        'monthlySessionCount' => 31,
        'trainingTypeIds' => [1],
    ]), 'monthlySessionCount');
});

test('requires a gym name for gym service', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'serviceMode' => 'gym',
        'gymName' => '',
        'yearsExperience' => 3,
        'trainingTypeIds' => [1],
    ]), 'gymName');
});

test('requires at least one training type', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'serviceMode' => 'freelance',
        'yearsExperience' => 3,
        'trainingTypeIds' => [],
    ]), 'trainingTypeIds');
});

test('rejects an unsupported trainer service mode', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'serviceMode' => 'online',
        'yearsExperience' => 3,
        'trainingTypeIds' => [1],
    ]), 'serviceMode');
});

test('rejects a negative trainer experience', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'serviceMode' => 'freelance',
        'yearsExperience' => -1,
        'trainingTypeIds' => [1],
    ]), 'yearsExperience');
});

test('rejects a non-positive trainer price', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์',
        'legalName' => 'เมย์ ใจดี',
        'serviceMode' => 'freelance',
        'yearsExperience' => 3,
        'priceFrom' => 0,
        'trainingTypeIds' => [1],
    ]), 'priceFrom');
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

echo count($tests) . " tests, {$failures} failures\n";
exit($failures === 0 ? 0 : 1);
