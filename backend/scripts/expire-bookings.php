<?php
declare(strict_types=1);

// Scheduler worker: CLI only. Over HTTP this would let anyone trigger the
// booking-expiry sweep, so the web SAPI answers as if the file is absent.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Http.php';
require_once __DIR__ . '/../src/Auth.php';
require_once __DIR__ . '/../src/RateLimiter.php';
require_once __DIR__ . '/../src/PasswordResetRules.php';
require_once __DIR__ . '/../src/WorkflowRules.php';
require_once __DIR__ . '/../src/PaymentRouting.php';
require_once __DIR__ . '/../src/ProfileRules.php';
require_once __DIR__ . '/../src/UserAdminRules.php';
require_once __DIR__ . '/../src/NotificationRules.php';
require_once __DIR__ . '/../src/GmailMailer.php';
require_once __DIR__ . '/../src/NotificationService.php';
require_once __DIR__ . '/../src/Handlers.php';

$config = require __DIR__ . '/../src/config.php';

try {
    $database = new Database($config['database']);
    $handlers = new Handlers($database, $config);
    $expired = $handlers->expireAwaitingPaymentsForScheduler();

    echo json_encode([
        'expired' => $expired,
        'checkedAt' => gmdate('c'),
    ], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $error) {
    fwrite(STDERR, "Booking expiry failed: {$error->getMessage()}" . PHP_EOL);
    exit(1);
}
