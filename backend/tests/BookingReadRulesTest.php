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

// ---------------------------------------------------------------------------
// Document compliance: the pending_trainer decision flow and the endpoints
// that grew around it.
// ---------------------------------------------------------------------------

test('a new booking waits for the trainer instead of starting the payment clock', function () use ($handlers): void {
    $body = methodBody($handlers, 'createBooking');
    assertTrue(
        str_contains($body, '"pending_trainer", "not_submitted", NULL)'),
        'creation must start pending_trainer with a null payment deadline'
    );
    assertFalse(
        str_contains($body, 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE)'),
        'the ten minute clock must not start at creation'
    );
});

test('completion compares against the confirmed end when the trainer gave one', function () use ($handlers): void {
    assertTrue(
        str_contains(methodBody($handlers, 'updateBookingStatus'), "(\$booking['confirmed_ends_at'] ?? \$booking['ends_at'])"),
        'assertTrainerCompletion must receive confirmed_ends_at ?? ends_at'
    );
});

test('administrators can cancel a request at every open stage', function () use ($handlers): void {
    $body = methodBody($handlers, 'updateBookingStatus');
    assertTrue(
        str_contains($body, "'pending_trainer' => ['cancelled']"),
        'admin transitions must include the request stage'
    );
});

test('the booking payload reports the confirmed window and trainer decisions', function () use ($handlers): void {
    $payload = methodBody($handlers, 'bookingPayload');
    foreach (["'confirmedStartsAt'", "'confirmedEndsAt'", "'requestedStartsAt'", "'cancellationReason'"] as $field) {
        assertTrue(str_contains($payload, $field), $field . ' must be in the booking payload');
    }
    preg_match('/\'actions\' => \[(.*?)\n            \],/s', $payload, $matches);
    $actions = $matches[1] ?? '';
    foreach (["'canAccept'", "'canReject'", "'canCancelBooking'"] as $action) {
        assertTrue(str_contains($actions, $action), $action . ' must be in the booking actions');
    }
});

test('user search also matches stored phone numbers and hides deleted accounts', function () use ($handlers): void {
    $body = methodBody($handlers, 'adminOperations');
    assertTrue(str_contains($body, 'mp.phone LIKE ?'), 'member phones must be searchable');
    assertTrue(str_contains($body, 'tp.phone LIKE ?'), 'trainer phones must be searchable');
    assertTrue(str_contains($body, 'LEFT JOIN member_profiles mp ON mp.user_id = u.id'), 'member profiles must join for the search');
    assertTrue(str_contains($body, 'u.status <> "deleted"'), 'deleted accounts must leave the lists');
    assertTrue(str_contains($body, "'pending_trainer', 'awaiting_payment'"), 'the request stage must be a filterable booking status');
});

test('gym salaries aggregate approved gym payments by session month', function () use ($handlers): void {
    $body = methodBody($handlers, 'adminOperations');
    assertTrue(str_contains($body, 'payment_service_mode = "gym"'), 'salary rows are gym-routed only');
    assertTrue(str_contains($body, 'b.status IN ("confirmed", "completed")'), 'only settled bookings accrue salary');
    assertTrue(str_contains($body, 'DATE_FORMAT(b.starts_at, "%Y-%m") AS month'), 'salary buckets by session month');
    assertTrue(str_contains($body, "'gymSalaries' => \$gymSalaries"), 'operations must publish the salary rows');
});

test('reports and trainer stats exist behind their permission checks', function () use ($handlers, $entry): void {
    $reports = methodBody($handlers, 'adminReports');
    assertTrue($reports !== '', 'adminReports should exist');
    assertTrue(str_contains($reports, "'manageBookings'"), 'reports require manageBookings or reviewPayments');
    assertTrue(str_contains($reports, "'reviewPayments'"), 'reports require manageBookings or reviewPayments');
    $stats = methodBody($handlers, 'trainerStats');
    assertTrue($stats !== '', 'trainerStats should exist');
    assertTrue(str_contains($stats, 'salarySummary'), 'gym trainers must get a salary summary');
    assertTrue(str_contains($entry, "\$handlers->adminReports()"), 'the route must exist');
    assertTrue(str_contains($entry, "\$handlers->trainerStats()"), 'the route must exist');
    assertTrue(str_contains($entry, "\$handlers->deleteUser("), 'the delete user route must exist');
    assertTrue(str_contains($entry, "\$handlers->updateAvailabilitySlot("), 'the slot edit route must exist');
});

test('a chat message can carry an image and a file at the same time', function () use ($handlers): void {
    $body = methodBody($handlers, 'sendMessage');
    assertTrue(str_contains($body, "'image',"), 'the image field must be accepted');
    assertTrue(str_contains($body, "'file',"), 'the file field must be accepted');
    assertTrue(str_contains($body, 'image_path'), 'images must land in the image columns');
    assertTrue(str_contains($body, 'attachment_path'), 'files must land in the attachment columns');
    assertTrue(str_contains($body, 'NotificationRules::MESSAGE_RECEIVED'), 'the peer learns about the message');
    $payload = methodBody($handlers, 'messagePayload');
    foreach (["'imageUrl'", "'imageName'", "'imageSize'", "'attachmentUrl'", "'attachmentName'", "'attachmentSize'"] as $field) {
        assertTrue(str_contains($payload, $field), $field . ' must be in the message payload');
    }
    assertTrue(str_contains($payload, "'attachment' =>"), 'the legacy attachment key must survive');
    $attachment = methodBody($handlers, 'chatAttachment');
    assertTrue(str_contains($attachment, "kind === 'image'"), 'images must be served by kind');
    assertTrue(str_contains($attachment, "kind === 'file'"), 'files must be served by kind');
});

test('deleting a user is a guarded soft delete that revokes sessions', function () use ($handlers): void {
    $body = methodBody($handlers, 'deleteUser');
    assertTrue(str_contains($body, 'UserAdminRules::assertDeletionAllowed'), 'self and last-manager guards must run first');
    assertTrue(str_contains($body, 'UPDATE users SET status = "deleted"'), 'the account must be soft deleted');
    assertTrue(str_contains($body, 'UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP()'), 'every session must be revoked');
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
