<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/Http.php';
require_once __DIR__ . '/../src/PaymentRouting.php';
require_once __DIR__ . '/../src/Database.php';
$config = require __DIR__ . '/../src/config.php';
$database = new Database($config['database']);
$pdo = $database->pdo();
// Connection-local tables shadow production names; no user records are changed.
$pdo->exec('CREATE TEMPORARY TABLE bookings (id INT, trainer_profile_id INT, payment_service_mode VARCHAR(20))');
$pdo->exec('CREATE TEMPORARY TABLE trainer_profiles (id INT, user_id INT)');
$pdo->exec('CREATE TEMPORARY TABLE admin_permissions (user_id INT, review_payments INT)');
$pdo->exec('INSERT INTO trainer_profiles VALUES (1,11),(2,12)');
$pdo->exec('INSERT INTO bookings VALUES (1,1,"freelance"),(2,2,"freelance"),(3,1,"gym"),(4,2,"gym"),(5,1,NULL),(6,1,"gym")');
$pdo->exec('INSERT INTO admin_permissions VALUES (21,1),(22,1),(23,0),(24,1)');
function check(mixed $expected, mixed $actual): void {
    if ($expected !== $actual) throw new RuntimeException('Expected ' . json_encode($expected) . ', got ' . json_encode($actual));
}
function visible(PDO $pdo, string $role, int $id): array {
    [$scope, $params] = PaymentRouting::scope(['role' => $role, 'id' => $id]);
    $query = $pdo->prepare('SELECT b.id FROM bookings b JOIN trainer_profiles tp ON tp.id=b.trainer_profile_id WHERE ' . $scope . ' ORDER BY b.id');
    $query->execute($params);
    return array_map('intval', $query->fetchAll(PDO::FETCH_COLUMN));
}
check([1], visible($pdo, 'trainer', 11));
check([2], visible($pdo, 'trainer', 12));
check([3,4,6], visible($pdo, 'admin', 21));
check([3,4,6], visible($pdo, 'admin', 22));
check([], visible($pdo, 'admin', 23));
check([3,4,6], visible($pdo, 'admin', 24));
check([], visible($pdo, 'member', 11));
check([], visible($pdo, 'trainer', 99));
$pdo->exec('UPDATE admin_permissions SET review_payments=0 WHERE user_id=21');
check([], visible($pdo, 'admin', 21));
foreach (['gym', 'freelance'] as $mode) {
    check($mode, PaymentRouting::serviceMode($mode, null));
    check($mode, PaymentRouting::serviceMode('both', $mode));
}
foreach ([['both', null], ['gym', 'freelance'], ['freelance', 'gym'], ['both', []], ['both', 'other']] as [$mode, $request]) {
    try { PaymentRouting::serviceMode($mode, $request); }
    catch (HttpException $error) { check(422, $error->status); continue; }
    throw new RuntimeException('Invalid service mode accepted');
}
require_once __DIR__ . '/../src/NotificationRules.php';
require_once __DIR__ . '/../src/GmailMailer.php';
require_once __DIR__ . '/../src/NotificationService.php';
$pdo->exec('UPDATE admin_permissions SET review_payments=1 WHERE user_id=21');
$pdo->exec('CREATE TEMPORARY TABLE notifications (
    id INT AUTO_INCREMENT PRIMARY KEY, recipient_user_id INT, type VARCHAR(80), category VARCHAR(20),
    title VARCHAR(255), message TEXT, booking_id INT, action_path VARCHAR(255),
    email_status VARCHAR(20), email_next_attempt_at DATETIME,
    UNIQUE KEY (recipient_user_id, type, booking_id))');
$pdo->exec('CREATE TEMPORARY TABLE payments (id INT, booking_id INT)');
$pdo->exec('CREATE TEMPORARY TABLE users (id INT, role VARCHAR(20), status VARCHAR(20))');
$pdo->exec('INSERT INTO users VALUES (11,"trainer","active"),(12,"trainer","active"),(21,"admin","active"),(22,"admin","active"),(23,"admin","active")');
$pdo->exec('INSERT INTO payments VALUES (101,1),(104,4)');
$notifications = new NotificationService($database, ['mail' => ['enabled' => false]]);
foreach ([1 => [11], 4 => [21,22]] as $bookingId => $reviewerIds) {
    $context = ['bookingId' => $bookingId, 'bookingPublicId' => 'BK-TEST-' . $bookingId,
        'memberUserId' => 100, 'trainerUserId' => 11];
    $notifications->recordEvent($pdo, NotificationRules::PAYMENT_SUBMITTED, $context);
    $query = $pdo->prepare('SELECT recipient_user_id FROM notifications WHERE booking_id=? AND type LIKE "payment_review_%"');
    $query->execute([$bookingId]);
    check($reviewerIds, array_map('intval', $query->fetchAll(PDO::FETCH_COLUMN)));
    check([], $notifications->recordEvent($pdo, NotificationRules::PAYMENT_SUBMITTED, $context));
}
echo "PASS: freelance ownership, single-gym administrator permissions, mode validation and reviewer notifications. No persistent data or email changed.\n";
