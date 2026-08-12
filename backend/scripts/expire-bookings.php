<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/Http.php';
require_once __DIR__ . '/../src/Auth.php';
require_once __DIR__ . '/../src/WorkflowRules.php';
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
