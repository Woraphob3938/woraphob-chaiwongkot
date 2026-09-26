<?php
declare(strict_types=1);

// Scheduler worker: CLI only. Over HTTP this would let anyone drain and send
// the queued notification e-mails, so the web SAPI answers 404.
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/NotificationRules.php';
require_once __DIR__ . '/../src/GmailMailer.php';
require_once __DIR__ . '/../src/NotificationService.php';

$config = require __DIR__ . '/../src/config.php';

try {
    $service = new NotificationService(new Database($config['database']), $config);
    $result = $service->processDue();
    echo json_encode($result + ['checkedAt' => gmdate('c')], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $error) {
    error_log('Notification worker failed: ' . $error->getMessage());
    fwrite(STDERR, "Notification worker failed.\n");
    exit(1);
}
