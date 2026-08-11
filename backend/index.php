<?php
declare(strict_types=1);

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Http.php';
require_once __DIR__ . '/src/Auth.php';
require_once __DIR__ . '/src/WorkflowRules.php';
require_once __DIR__ . '/src/ProfileRules.php';
require_once __DIR__ . '/src/Handlers.php';

$config = require __DIR__ . '/src/config.php';
Http::cors((string) $config['origin']);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $database = new Database($config['database']);
    $handlers = new Handlers($database, $config);
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $base = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    if ($base !== '' && $base !== '/' && str_starts_with($path, $base)) {
        $path = substr($path, strlen($base)) ?: '/';
    }
    $path = '/' . trim($path, '/');

    if ($method === 'GET' && $path === '/v1/health') $handlers->health();
    if ($method === 'GET' && $path === '/v1/training-types') $handlers->trainingTypes();
    if ($method === 'GET' && $path === '/v1/trainers') $handlers->trainers();
    if ($method === 'POST' && $path === '/v1/auth/register') $handlers->register();
    if ($method === 'POST' && $path === '/v1/auth/login') $handlers->login();
    if ($method === 'POST' && $path === '/v1/auth/logout') $handlers->logout();
    if ($method === 'GET' && $path === '/v1/me') $handlers->me();
    if ($method === 'GET' && $path === '/v1/profile') $handlers->profile();
    if ($method === 'PATCH' && $path === '/v1/profile') $handlers->updateProfile();
    if ($method === 'POST' && $path === '/v1/trainer-applications') $handlers->trainerApplication();
    if ($method === 'GET' && $path === '/v1/trainer/me') $handlers->trainerMe();
    if ($method === 'PATCH' && $path === '/v1/trainer/me') $handlers->updateTrainerMe();
    if ($method === 'POST' && $path === '/v1/availability-slots') $handlers->createAvailabilitySlot();
    if ($method === 'GET' && $path === '/v1/bookings') $handlers->listBookings();
    if ($method === 'POST' && $path === '/v1/bookings') $handlers->createBooking();
    if ($method === 'POST' && $path === '/v1/payments') $handlers->payment();
    if ($method === 'POST' && $path === '/v1/reviews') $handlers->review();
    if ($method === 'GET' && $path === '/v1/admin/review-queue') $handlers->adminReviewQueue();

    if ($method === 'GET' && preg_match('#^/v1/trainers/([^/]+)$#', $path, $matches) === 1) $handlers->trainer(urldecode($matches[1]));
    if ($method === 'DELETE' && preg_match('#^/v1/availability-slots/(\d+)$#', $path, $matches) === 1) $handlers->deleteAvailabilitySlot($matches[1]);
    if ($method === 'POST' && preg_match('#^/v1/bookings/([^/]+)/cancel$#', $path, $matches) === 1) $handlers->cancelMemberBooking(urldecode($matches[1]));
    if ($method === 'PATCH' && preg_match('#^/v1/bookings/([^/]+)/status$#', $path, $matches) === 1) $handlers->updateBookingStatus(urldecode($matches[1]));
    if ($method === 'GET' && preg_match('#^/v1/chat-rooms/(\d+)/messages/(\d+)/attachment$#', $path, $matches) === 1) $handlers->chatAttachment($matches[1], $matches[2]);
    if ($method === 'GET' && preg_match('#^/v1/chat-rooms/(\d+)/messages$#', $path, $matches) === 1) $handlers->messages($matches[1]);
    if ($method === 'POST' && preg_match('#^/v1/chat-rooms/(\d+)/messages$#', $path, $matches) === 1) $handlers->sendMessage($matches[1]);
    if ($method === 'POST' && preg_match('#^/v1/admin/trainers/(\d+)/(approve|reject)$#', $path, $matches) === 1) $handlers->decideTrainer($matches[1], $matches[2]);
    if ($method === 'POST' && preg_match('#^/v1/admin/payments/(\d+)/(approve|reject)$#', $path, $matches) === 1) $handlers->decidePayment($matches[1], $matches[2]);
    if ($method === 'GET' && preg_match('#^/v1/admin/files/(payment|certificate)/(\d+)$#', $path, $matches) === 1) $handlers->adminFile($matches[1], $matches[2]);

    throw new HttpException(404, 'ไม่พบเส้นทางบริการนี้', 'NOT_FOUND');
} catch (HttpException $error) {
    Http::error($error);
} catch (Throwable $error) {
    error_log($error->getMessage());
    $message = ($config['environment'] ?? 'production') === 'local'
        ? 'บริการขัดข้อง: ' . $error->getMessage()
        : 'บริการขัดข้อง กรุณาลองใหม่';
    Http::error(new HttpException(500, $message, 'SERVER_ERROR'));
}
