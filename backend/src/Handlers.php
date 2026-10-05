<?php
declare(strict_types=1);
require_once __DIR__ . '/PaymentRouting.php';
require_once __DIR__ . '/handlers/TrainerHandlers.php';
require_once __DIR__ . '/handlers/AccountHandlers.php';
require_once __DIR__ . '/handlers/BookingHandlers.php';
require_once __DIR__ . '/handlers/PaymentHandlers.php';
require_once __DIR__ . '/handlers/ChatHandlers.php';
require_once __DIR__ . '/handlers/AdminHandlers.php';

/**
 * Every API handler. The handlers themselves live in src/handlers/, one trait per
 * area; this class holds the wiring and the helpers they all share.
 */
final class Handlers
{
    use TrainerHandlers;
    use AccountHandlers;
    use BookingHandlers;
    use PaymentHandlers;
    use ChatHandlers;
    use AdminHandlers;

    private Auth $auth;
    private NotificationService $notifications;
    private RateLimiter $rateLimiter;
    private ?StripeClient $stripeClient = null;
    /** @var list<array{0: string, 1: ?string}> */
    private array $checkoutsToExpire = [];

    public function __construct(
        private readonly Database $database,
        private readonly array $config
    ) {
        $this->auth = new Auth($database);
        $this->notifications = new NotificationService($database, $config);
        $this->rateLimiter = new RateLimiter($database);
        // Checkout Sessions of bookings closed during this request are expired
        // in Stripe once the database work is committed.
        register_shutdown_function(function (): void {
            $ids = $this->checkoutsToExpire;
            $this->checkoutsToExpire = [];
            $this->expireCheckoutSessions($ids);
        });
    }

    public function health(): never
    {
        $this->database->fetchOne('SELECT 1 AS ok');
        Http::json([
            'status' => 'ok',
            'service' => 'fitconnect-api',
            'database' => 'connected',
            'time' => gmdate('c'),
        ]);
    }

    private static function blankToNull(string $value): ?string
    {
        return $value === '' ? null : $value;
    }

    private function saveUpload(string $field, array $allowedMimeTypes, int $maxBytes, string $directory, bool $required = true): ?array
    {
        if (!isset($_FILES[$field]) || !is_array($_FILES[$field])) {
            if (!$required) {
                return null;
            }
            throw new HttpException(422, 'กรุณาเลือกไฟล์', 'FILE_REQUIRED', [$field => 'จำเป็นต้องแนบไฟล์']);
        }
        $file = $_FILES[$field];
        $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($uploadError === UPLOAD_ERR_NO_FILE && !$required) {
            return null;
        }
        if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw new HttpException(413, 'ขนาดไฟล์เกินที่กำหนด', 'FILE_TOO_LARGE');
        }
        if ($uploadError !== UPLOAD_ERR_OK) {
            throw new HttpException(422, 'อัปโหลดไฟล์ไม่สำเร็จ', 'UPLOAD_FAILED');
        }
        if ((int) $file['size'] <= 0) {
            throw new HttpException(422, 'อัปโหลดไฟล์ไม่สำเร็จ', 'UPLOAD_FAILED');
        }
        if ((int) $file['size'] > $maxBytes) {
            throw new HttpException(413, 'ขนาดไฟล์เกินที่กำหนด', 'FILE_TOO_LARGE');
        }
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file((string) $file['tmp_name']);
        if ($mime === false || !in_array($mime, $allowedMimeTypes, true)) {
            throw new HttpException(415, 'ประเภทไฟล์ไม่รองรับ', 'INVALID_FILE_TYPE');
        }
        $extensions = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        $uploadRoot = dirname(__DIR__) . '/uploads/' . $directory;
        if (!is_dir($uploadRoot) && !mkdir($uploadRoot, 0750, true) && !is_dir($uploadRoot)) {
            throw new RuntimeException('สร้างโฟลเดอร์อัปโหลดไม่สำเร็จ');
        }
        $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
        $target = $uploadRoot . '/' . $filename;
        if (!move_uploaded_file((string) $file['tmp_name'], $target)) {
            throw new RuntimeException('บันทึกไฟล์ไม่สำเร็จ');
        }
        $rawName = trim((string) basename((string) $file['name']));
        $safeName = preg_replace('/[^\pL\pN._ -]+/u', '_', $rawName) ?? '';
        $displayName = mb_substr($safeName, 0, 255);
        return [
            'path' => 'uploads/' . $directory . '/' . $filename,
            'mime' => $mime,
            'name' => $displayName === '' ? 'ไฟล์แนบ' : $displayName,
            'size' => (int) $file['size'],
        ];
    }

    private function removeUpload(string $relativePath): void
    {
        $target = self::uploadPath($relativePath);
        if ($target !== null) {
            unlink($target);
        }
    }

    /** The real path of a stored upload, or null when it is missing or outside the uploads folder. */
    private static function uploadPath(string $relativePath, string $directory = ''): ?string
    {
        $root = realpath(dirname(__DIR__) . '/uploads' . ($directory === '' ? '' : '/' . $directory));
        $target = realpath(dirname(__DIR__) . '/' . ltrim($relativePath, '/\\'));
        $inside = $root !== false && $target !== false && str_starts_with($target, $root . DIRECTORY_SEPARATOR);
        return $inside && is_file($target) ? $target : null;
    }

    private function serveUploadedImage(string $relativePath, string $directory, string $filename, bool $cache): never
    {
        $target = self::uploadPath($relativePath, $directory);
        $mime = $target === null ? false : (new finfo(FILEINFO_MIME_TYPE))->file($target);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw new HttpException(404, 'ไม่พบรูปภาพ', 'IMAGE_NOT_FOUND');
        }
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($target));
        header('Content-Disposition: inline; filename="' . $filename . '"');
        header('Cache-Control: ' . ($cache ? 'public, max-age=86400' : 'no-store'));
        header('X-Content-Type-Options: nosniff');
        readfile($target);
        exit;
    }

    private static function utc(string $value = 'now'): DateTimeImmutable
    {
        return new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }

    /** One "?" per value, for an IN (...) list. */
    private static function marks(array $values): string
    {
        return implode(',', array_fill(0, count($values), '?'));
    }

    /** Records an event; the ids are delivered after the transaction commits. */
    private function notify(PDO $pdo, array &$ids, string $event, array $context): void
    {
        $ids = array_merge($ids, $this->notifications->recordEvent($pdo, $event, $context));
    }

    private function iso(string $value): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', strtotime($value . ' UTC'));
    }
}
