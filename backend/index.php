<?php
declare(strict_types=1);

// A warning printed by display_errors lands in front of the JSON body, leaks
// absolute server paths and breaks response.json() in every client. The API
// answers JSON only; warnings still reach the Apache error log through
// log_errors. Http::json() drops anything already buffered as a second guard.
ini_set('display_errors', '0');
ini_set('log_errors', '1');

require_once __DIR__ . '/src/Database.php';
require_once __DIR__ . '/src/Http.php';
require_once __DIR__ . '/src/Auth.php';
require_once __DIR__ . '/src/RateLimiter.php';
require_once __DIR__ . '/src/PasswordResetRules.php';
require_once __DIR__ . '/src/WorkflowRules.php';
require_once __DIR__ . '/src/PaymentRouting.php';
require_once __DIR__ . '/src/StripeClient.php';
require_once __DIR__ . '/src/StripePayments.php';
require_once __DIR__ . '/src/ProfileRules.php';
require_once __DIR__ . '/src/UserAdminRules.php';
require_once __DIR__ . '/src/NotificationRules.php';
require_once __DIR__ . '/src/GmailMailer.php';
require_once __DIR__ . '/src/NotificationService.php';
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
    if ($method === 'POST' && $path === '/v1/auth/forgot-password') $handlers->forgotPassword();
    if ($method === 'POST' && $path === '/v1/auth/reset-password') $handlers->resetPassword();
    if ($method === 'POST' && $path === '/v1/auth/logout') $handlers->logout();
    if ($method === 'GET' && $path === '/v1/me') $handlers->me();
    if ($method === 'GET' && $path === '/v1/profile') $handlers->profile();
    if ($method === 'PATCH' && $path === '/v1/profile') $handlers->updateProfile();
    if ($method === 'DELETE' && $path === '/v1/profile') $handlers->deleteOwnAccount();
    if ($method === 'POST' && $path === '/v1/profile/image') $handlers->uploadProfileImage();
    if ($method === 'DELETE' && $path === '/v1/profile/image') $handlers->deleteProfileImage();
    if ($method === 'GET' && $path === '/v1/trainer/photos') $handlers->trainerPhotos();
    if ($method === 'POST' && $path === '/v1/trainer/photos') $handlers->uploadTrainerPhoto();
    if ($method === 'DELETE' && preg_match('#^/v1/trainer/photos/(\d+)$#', $path, $matches) === 1) $handlers->deleteTrainerPhoto($matches[1]);
    if ($method === 'PATCH' && $path === '/v1/profile/password') $handlers->changeProfilePassword();
    if ($method === 'POST' && $path === '/v1/trainer-applications') $handlers->trainerApplication();
    if ($method === 'GET' && $path === '/v1/trainer/me') $handlers->trainerMe();
    if ($method === 'PATCH' && $path === '/v1/trainer/me') $handlers->updateTrainerMe();
    if ($method === 'POST' && $path === '/v1/availability-slots') $handlers->createAvailabilitySlot();
    if ($method === 'GET' && $path === '/v1/chat-rooms') $handlers->inquiryRooms();
    if ($method === 'POST' && $path === '/v1/chat-rooms') $handlers->openInquiryRoom();
    if ($method === 'GET' && $path === '/v1/trainer/members') $handlers->trainerMembers();
    if ($method === 'GET' && $path === '/v1/trainer/reviews') $handlers->trainerReviews();
    if ($method === 'GET' && $path === '/v1/bookings') $handlers->listBookings();
    if ($method === 'POST' && $path === '/v1/bookings') $handlers->createBooking();
    if ($method === 'POST' && $path === '/v1/payments') $handlers->payment();
    if ($method === 'POST' && $path === '/v1/payments/confirm') $handlers->confirmPayment();
    if ($method === 'POST' && $path === '/v1/stripe/webhook') $handlers->stripeWebhook();
    if ($method === 'GET' && $path === '/v1/trainer/stripe') $handlers->trainerStripeStatus();
    if ($method === 'POST' && $path === '/v1/trainer/stripe/onboarding') $handlers->trainerStripeOnboarding();
    if ($method === 'POST' && $path === '/v1/trainer/stripe/dashboard') $handlers->trainerStripeDashboard();
    if ($method === 'POST' && $path === '/v1/reviews') $handlers->review();
    if ($method === 'GET' && $path === '/v1/notifications') $handlers->notifications();
    if ($method === 'POST' && $path === '/v1/notifications/read-all') $handlers->readAllNotifications();
    if ($method === 'GET' && $path === '/v1/admin/review-queue') $handlers->adminReviewQueue();
    if ($method === 'GET' && $path === '/v1/admin/payment-routing') $handlers->paymentRouting();
    if ($method === 'POST' && $path === '/v1/admin/payment-routing') $handlers->savePaymentRouting();
    if ($method === 'GET' && $path === '/v1/admin/operations') $handlers->adminOperations();
    if ($method === 'GET' && $path === '/v1/admin/reports') $handlers->adminReports();
    if ($method === 'POST' && $path === '/v1/admin/users') $handlers->createAdminUser();
    if ($method === 'GET' && $path === '/v1/trainer/stats') $handlers->trainerStats();

    if ($method === 'GET' && preg_match('#^/v1/trainers/([^/]+)$#', $path, $matches) === 1) $handlers->trainer(urldecode($matches[1]));
    if ($method === 'GET' && preg_match('#^/v1/profile-images/(member|trainer)/(\d+)$#', $path, $matches) === 1) $handlers->profileImage($matches[1], $matches[2]);
    if ($method === 'GET' && preg_match('#^/v1/trainer-photos/(\d+)$#', $path, $matches) === 1) $handlers->trainerPhoto($matches[1]);
    if ($method === 'DELETE' && preg_match('#^/v1/availability-slots/(\d+)$#', $path, $matches) === 1) $handlers->deleteAvailabilitySlot($matches[1]);
    if ($method === 'PATCH' && preg_match('#^/v1/availability-slots/(\d+)$#', $path, $matches) === 1) $handlers->updateAvailabilitySlot($matches[1]);
    if ($method === 'POST' && preg_match('#^/v1/bookings/([^/]+)/cancel$#', $path, $matches) === 1) $handlers->cancelMemberBooking(urldecode($matches[1]));
    if ($method === 'POST' && preg_match('#^/v1/bookings/([^/]+)/sessions$#', $path, $matches) === 1) $handlers->addMonthlyBookingSession(urldecode($matches[1]));
    if ($method === 'PATCH' && preg_match('#^/v1/bookings/([^/]+)/status$#', $path, $matches) === 1) $handlers->updateBookingStatus(urldecode($matches[1]));
    if ($method === 'GET' && preg_match('#^/v1/chat-rooms/(\d+)/messages/(\d+)/attachment$#', $path, $matches) === 1) $handlers->chatAttachment($matches[1], $matches[2]);
    if ($method === 'GET' && preg_match('#^/v1/chat-rooms/(\d+)/messages$#', $path, $matches) === 1) $handlers->messages($matches[1]);
    if ($method === 'POST' && preg_match('#^/v1/chat-rooms/(\d+)/messages$#', $path, $matches) === 1) $handlers->sendMessage($matches[1]);
    if ($method === 'POST' && preg_match('#^/v1/admin/trainers/(\d+)/(approve|reject)$#', $path, $matches) === 1) $handlers->decideTrainer($matches[1], $matches[2]);
    if ($method === 'GET' && preg_match('#^/v1/admin/files/(payment|certificate)/(\d+)$#', $path, $matches) === 1) $handlers->adminFile($matches[1], $matches[2]);
    if ($method === 'PATCH' && preg_match('#^/v1/admin/users/(\d+)$#', $path, $matches) === 1) $handlers->updateAdminUser($matches[1]);
    if ($method === 'DELETE' && preg_match('#^/v1/admin/users/(\d+)$#', $path, $matches) === 1) $handlers->deleteUser($matches[1]);
    if ($method === 'GET' && preg_match('#^/v1/notifications/(\d+)$#', $path, $matches) === 1) $handlers->notification($matches[1]);
    if ($method === 'PATCH' && preg_match('#^/v1/notifications/(\d+)/read$#', $path, $matches) === 1) $handlers->readNotification($matches[1]);

    throw new HttpException(404, 'ไม่พบเส้นทางบริการนี้', 'NOT_FOUND');
} catch (HttpException $error) {
    Http::error($error);
} catch (Throwable $error) {
    $trace = bin2hex(random_bytes(6));
    error_log(sprintf(
        '[fitconnect:%s] %s in %s:%d%s%s',
        $trace,
        $error->getMessage(),
        $error->getFile(),
        $error->getLine(),
        PHP_EOL,
        $error->getTraceAsString()
    ));
    Http::error(new HttpException(
        500,
        'บริการขัดข้อง กรุณาลองใหม่ (รหัสอ้างอิง ' . $trace . ')',
        'SERVER_ERROR'
    ));
}
