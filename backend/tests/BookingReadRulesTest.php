<?php
declare(strict_types=1);

/**
 * Guard the booking read path. Expiry is a write, so it belongs to the
 * scheduler and to the handlers that change state; a read that quietly writes
 * made an anonymous GET mutate rows and enqueue mail. These checks fail loudly
 * if that sweep is wired back into a read handler, if the payload stops
 * reporting a passed hold as expired, or if the payload and
 * WorkflowRules::assertTrainerCompletion drift apart again.
 */

$tests = [];

function test(string $name, Closure $callback): void
{
    global $tests;
    $tests[$name] = $callback;
}

function assertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function assertFalse(bool $condition, string $message): void
{
    assertTrue(!$condition, $message);
}

$handlers = file_get_contents(__DIR__ . '/../src/Handlers.php');
$entry = file_get_contents(__DIR__ . '/../index.php');
if ($handlers === false || $entry === false) {
    throw new RuntimeException('Could not read the API sources');
}

/** Returns the body of a method, or an empty string when it is absent. */
function methodBody(string $source, string $method): string
{
    $pattern = '/(?:public|private|protected) function ' . preg_quote($method, '/') . '\([^)]*\)[^{]*\{(.*?)\n    \}/s';
    return preg_match($pattern, $source, $matches) === 1 ? $matches[1] : '';
}

test('read handlers never expire bookings as a side effect', function () use ($handlers): void {
    foreach ([
        'trainers',
        'trainer',
        'trainerMe',
        'messages',
        'adminOperations',
        'adminReviewQueue',
    ] as $method) {
        $body = methodBody($handlers, $method);
        assertTrue($body !== '', $method . ' should exist');
        assertFalse(
            str_contains($body, 'expireAwaitingPayments'),
            $method . ' must not expire bookings while answering a read'
        );
    }
});

test('the booking list may still sweep because it is scoped to one account', function () use ($handlers): void {
    assertTrue(
        str_contains(methodBody($handlers, 'listBookings'), 'expireAwaitingPayments()'),
        'listBookings keeps the opportunistic sweep for a single signed-in account'
    );
});

test('write handlers expire due holds before they decide', function () use ($handlers): void {
    foreach (['createBooking', 'cancelMemberBooking', 'payment'] as $method) {
        assertTrue(
            str_contains(methodBody($handlers, $method), 'expireAwaitingPaymentsInTransaction'),
            $method . ' must expire due holds inside its transaction'
        );
    }
});

test('the scheduler entry point still expires bookings', function () use ($handlers): void {
    assertTrue(
        str_contains($handlers, 'public function expireAwaitingPaymentsForScheduler(): int'),
        'the cron entry point must survive so expiry never depends on traffic'
    );
});

test('a passed deadline is reported as expired when reading', function () use ($handlers): void {
    assertTrue(
        str_contains(
            $handlers,
            "\$status = \$row['status'] === 'awaiting_payment' && \$deadlinePassed ? 'expired' : \$row['status'];"
        ),
        'bookingPayload must derive an effective status'
    );
    assertTrue(
        str_contains($handlers, "'status' => \$status,"),
        'bookingPayload must publish the effective status rather than the stored one'
    );
});

test('every booking action reads the effective status', function () use ($handlers): void {
    $payload = methodBody($handlers, 'bookingPayload');
    assertTrue($payload !== '', 'bookingPayload should exist');

    preg_match('/\'actions\' => \[(.*?)\n            \],/s', $payload, $matches);
    $actions = $matches[1] ?? '';
    assertTrue($actions !== '', 'the actions block should exist');
    assertFalse(
        str_contains($actions, "\$row['status']"),
        'actions must not branch on the stored status once an effective one exists'
    );
});

test('completion matches the rule the trainer endpoint enforces', function () use ($handlers): void {
    $payload = methodBody($handlers, 'bookingPayload');
    assertTrue(
        str_contains($payload, '$periodExpired'),
        'a package past its window must remain completable in the UI hint'
    );
    assertTrue(
        str_contains($payload, '|| $periodExpired'),
        'the period-expiry allowance must be part of canComplete'
    );
});

test('a cancelled booking closes a slip that was still queued', function () use ($handlers): void {
    $body = methodBody($handlers, 'updateBookingStatus');
    assertTrue($body !== '', 'updateBookingStatus should exist');
    assertTrue(
        str_contains($body, 'status = "rejected"') && str_contains($body, 'status = "reviewing"'),
        'cancelling must settle the reviewing payment instead of orphaning it'
    );
});

test('the trainer application replaces its certificate instead of appending', function () use ($handlers): void {
    $body = methodBody($handlers, 'trainerApplication');
    assertTrue($body !== '', 'trainerApplication should exist');
    assertTrue(
        str_contains($body, 'DELETE FROM trainer_certificates WHERE trainer_profile_id = ?'),
        'a resubmission must not stack duplicate certificate rows'
    );
    assertTrue(
        str_contains($body, 'ProfileRules::trainer(Http::body())'),
        'the form owns the whole professional record, not a subset of it'
    );
    assertFalse(
        str_contains($body, '$input['),
        'the handler must read the validated profile, not raw request keys'
    );
});

test('a submitted application always returns to the review queue', function () use ($handlers): void {
    $body = methodBody($handlers, 'trainerApplication');
    assertTrue(
        str_contains($body, 'approval_status = "pending"'),
        'submitting is a re-reviewable act, so approval cannot be carried over'
    );
    assertTrue(
        str_contains($body, 'status = "pending", review_note = NULL'),
        'a retained certificate must also return to the queue'
    );
});

test('a certificate is demanded only when the profile has none', function () use ($handlers): void {
    $body = methodBody($handlers, 'trainerApplication');
    assertTrue(
        str_contains($body, 'SELECT COUNT(*) AS total FROM trainer_certificates'),
        'the handler must check whether a certificate is already on file'
    );
    assertTrue(
        str_contains($body, 'if ($certificate === null && !$hasStoredCertificate)'),
        'an approved trainer editing details must not be forced to re-upload'
    );
    assertTrue(
        str_contains($body, "'certificates', false)"),
        'the certificate upload is optional at the transport layer'
    );
});

test('unexpected failures never return the raw exception', function () use ($entry): void {
    assertFalse(
        str_contains($entry, "'บริการขัดข้อง: ' . \$error->getMessage()"),
        'the client must not receive PDO or filesystem details'
    );
    assertTrue(
        str_contains($entry, 'รหัสอ้างอิง'),
        'the client should receive a reference id that matches the server log'
    );
});

$failures = 0;
foreach ($tests as $name => $callback) {
    try {
        $callback();
        echo 'PASS ' . $name . PHP_EOL;
    } catch (Throwable $error) {
        $failures++;
        echo 'FAIL ' . $name . ' — ' . $error->getMessage() . PHP_EOL;
    }
}

echo PHP_EOL . count($tests) . ' tests, ' . $failures . ' failures' . PHP_EOL;
exit($failures === 0 ? 0 : 1);
