<?php
declare(strict_types=1);

$rulesPath = __DIR__ . '/../src/NotificationRules.php';
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

function assertTrueValue(bool $actual, string $message): void
{
    if (!$actual) {
        throw new RuntimeException($message);
    }
}

function bookingContext(array $overrides = []): array
{
    return array_merge([
        'bookingId' => 91,
        'bookingPublicId' => 'BK-AB12CD34',
        'memberUserId' => 1,
        'trainerUserId' => 2,
        'memberName' => 'สมาชิกทดสอบ',
        'trainerName' => 'เทรนเนอร์ทดสอบ',
        'startsAt' => '2026-08-20 02:00:00',
        'endsAt' => '2026-08-20 03:00:00',
        'quotedPrice' => 650.0,
        'previousStatus' => 'payment_review',
        'nextStatus' => 'confirmed',
        'reviewNote' => '',
    ], $overrides);
}

test('maps approved events to the exact recipients and email policy', function (): void {
    $cases = [
        [NotificationRules::BOOKING_CREATED, [1], true],
        [NotificationRules::PAYMENT_SUBMITTED, [1], false],
        [NotificationRules::PAYMENT_APPROVED, [1, 2], true],
        [NotificationRules::PAYMENT_REJECTED_RETRY, [1], true],
        [NotificationRules::PAYMENT_REJECTED_FINAL, [1], true],
        [NotificationRules::BOOKING_EXPIRED, [1], true],
        [NotificationRules::BOOKING_CANCELLED, [1, 2], true],
        [NotificationRules::APPOINTMENT_REMINDER, [1, 2], true],
    ];

    foreach ($cases as [$event, $recipientIds, $emailRequired]) {
        $definitions = NotificationRules::forEvent($event, bookingContext([
            'previousStatus' => $event === NotificationRules::BOOKING_CANCELLED ? 'confirmed' : 'payment_review',
        ]));
        assertSameValue($recipientIds, array_column($definitions, 'recipientUserId'));
        foreach ($definitions as $definition) {
            assertSameValue($emailRequired, $definition['emailRequired']);
        }
    }
});

test('does not notify trainer when a booking was cancelled before confirmation', function (): void {
    $definitions = NotificationRules::forEvent(
        NotificationRules::BOOKING_CANCELLED,
        bookingContext(['previousStatus' => 'awaiting_payment', 'nextStatus' => 'cancelled'])
    );
    assertSameValue([1], array_column($definitions, 'recipientUserId'));
});

test('maps booking decision events to the member with the decision details', function (): void {
    $accepted = NotificationRules::forEvent(NotificationRules::BOOKING_ACCEPTED, bookingContext([
        'confirmedStartsAt' => '2026-08-20 12:00:00',
        'confirmedEndsAt' => '2026-08-20 13:00:00',
        'previousStatus' => 'pending_trainer',
        'nextStatus' => 'awaiting_payment',
    ]));
    assertSameValue([1], array_column($accepted, 'recipientUserId'));
    assertSameValue(true, $accepted[0]['emailRequired']);
    assertTrueValue(
        str_contains($accepted[0]['message'], '20/08/2569 19:00–20:00'),
        'the acceptance names the session in Bangkok time and the Buddhist-era year'
    );

    $rejected = NotificationRules::forEvent(NotificationRules::BOOKING_REJECTED, bookingContext([
        'reviewNote' => 'ติดนัดอื่นในเวลานั้น',
        'previousStatus' => 'pending_trainer',
        'nextStatus' => 'cancelled',
    ]));
    assertSameValue([1], array_column($rejected, 'recipientUserId'));
    assertSameValue(true, $rejected[0]['emailRequired']);
    assertSameValue('/trainers', $rejected[0]['actionPath']);
    assertTrueValue(str_contains($rejected[0]['message'], 'ติดนัดอื่นในเวลานั้น'), 'the rejection carries the reason');
});

test('notifies only the chat recipient of a new message, in app only', function (): void {
    $definitions = NotificationRules::forEvent(NotificationRules::MESSAGE_RECEIVED, [
        'bookingId' => 91,
        'bookingPublicId' => 'BK-AB12CD34',
        'memberUserId' => 1,
        'trainerUserId' => 2,
        'recipientUserId' => 2,
        'senderName' => 'สมาชิกทดสอบ',
        'messageId' => 55,
    ]);
    assertSameValue([2], array_column($definitions, 'recipientUserId'));
    assertSameValue('message_received_55', $definitions[0]['type']);
    assertSameValue('/chat', $definitions[0]['actionPath']);
    assertSameValue(false, $definitions[0]['emailRequired']);
    assertTrueValue(str_contains($definitions[0]['message'], 'สมาชิกทดสอบ'), 'the message names the sender');
});

test('routes application decisions to the trainer without any booking', function (): void {
    $approved = NotificationRules::forEvent(NotificationRules::TRAINER_APPLICATION_APPROVED, ['trainerUserId' => 4]);
    assertSameValue([4], array_column($approved, 'recipientUserId'));
    assertSameValue('/trainer', $approved[0]['actionPath']);
    assertSameValue(true, $approved[0]['emailRequired']);

    $rejected = NotificationRules::forEvent(NotificationRules::TRAINER_APPLICATION_REJECTED, [
        'trainerUserId' => 4,
        'reviewNote' => 'ใบรับรองไม่ชัดเจน',
    ]);
    assertSameValue([4], array_column($rejected, 'recipientUserId'));
    assertSameValue('/trainer/apply', $rejected[0]['actionPath']);
    assertSameValue(true, $rejected[0]['emailRequired']);
    assertTrueValue(str_contains($rejected[0]['message'], 'ใบรับรองไม่ชัดเจน'), 'the rejection carries the reason');
});

test('booking events still demand the full booking context', function (): void {
    $thrown = false;
    try {
        NotificationRules::forEvent(NotificationRules::BOOKING_CREATED, ['bookingId' => 1]);
    } catch (InvalidArgumentException) {
        $thrown = true;
    }
    assertTrueValue($thrown, 'a booking event without a booking context must be refused');
});

test('creates safe internal Thai notification copy', function (): void {
    $events = [
        NotificationRules::BOOKING_CREATED,
        NotificationRules::PAYMENT_SUBMITTED,
        NotificationRules::PAYMENT_APPROVED,
        NotificationRules::PAYMENT_REJECTED_RETRY,
        NotificationRules::PAYMENT_REJECTED_FINAL,
        NotificationRules::BOOKING_EXPIRED,
        NotificationRules::BOOKING_CANCELLED,
        NotificationRules::APPOINTMENT_REMINDER,
    ];
    foreach ($events as $event) {
        $definitions = NotificationRules::forEvent($event, bookingContext(['previousStatus' => 'confirmed']));
        foreach ($definitions as $definition) {
            assertTrueValue($definition['title'] !== '', 'Notification title must not be empty.');
            assertTrueValue($definition['message'] !== '', 'Notification message must not be empty.');
            assertTrueValue(str_starts_with($definition['actionPath'], '/'), 'Action path must be internal.');
            $serialized = json_encode($definition, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
            foreach (['จังหวัด', 'สถานที่นัดฝึก', 'token', 'slip_path', 'certificate_path'] as $forbidden) {
                assertTrueValue(!str_contains($serialized, $forbidden), "Notification copy contains forbidden value: {$forbidden}");
            }
        }
    }
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
