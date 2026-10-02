<?php
declare(strict_types=1);

/**
 * Fixed-window counters for the endpoints that accept credentials, reset codes
 * or file uploads. Nothing capped these before, so a single client could guess
 * passwords or fill the upload directory as fast as the network allowed.
 *
 * The storage is one row per (scope, subject) with the start of the current
 * window, so the whole check is a single atomic upsert and stays correct under
 * concurrent requests without holding a lock across the request.
 */
final class RateLimiter
{
    public const LOGIN = 'login';
    public const REGISTER = 'register';
    public const PASSWORD_RESET_REQUEST = 'password_reset_request';
    public const PASSWORD_RESET_CONFIRM = 'password_reset_confirm';
    public const ACCOUNT_DELETE = 'account_delete';
    public const TRAINER_APPLICATION = 'trainer_application';
    public const PROFILE_IMAGE = 'profile_image';
    public const PAYMENT_SLIP = 'payment_slip';
    public const CHAT_ATTACHMENT = 'chat_attachment';

    /** @var array<string, array{limit: int, window: int, message: string}> */
    private const RULES = [
        self::LOGIN => ['limit' => 10, 'window' => 900, 'message' => 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่'],
        self::REGISTER => ['limit' => 5, 'window' => 3600, 'message' => 'สร้างบัญชีจากเครือข่ายนี้หลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'],
        self::PASSWORD_RESET_REQUEST => ['limit' => 5, 'window' => 3600, 'message' => 'ขอรหัสตั้งรหัสผ่านใหม่หลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'],
        self::PASSWORD_RESET_CONFIRM => ['limit' => 10, 'window' => 900, 'message' => 'ยืนยันรหัสหลายครั้งเกินไป กรุณาขอรหัสใหม่'],
        self::ACCOUNT_DELETE => ['limit' => 5, 'window' => 900, 'message' => 'ยืนยันการลบบัญชีหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'],
        self::TRAINER_APPLICATION => ['limit' => 10, 'window' => 3600, 'message' => 'ส่งใบสมัครหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'],
        self::PROFILE_IMAGE => ['limit' => 20, 'window' => 3600, 'message' => 'อัปโหลดรูปหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'],
        self::PAYMENT_SLIP => ['limit' => 20, 'window' => 3600, 'message' => 'เริ่มชำระเงินหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'],
        self::CHAT_ATTACHMENT => ['limit' => 60, 'window' => 3600, 'message' => 'ส่งไฟล์ในแชตหลายครั้งเกินไป กรุณาลองใหม่ภายหลัง'],
    ];

    public function __construct(private readonly Database $database)
    {
    }

    /**
     * Counts the attempt and refuses it once the window is used up. Call this
     * before doing the expensive or guessable work, not after.
     */
    public function hit(string $scope, string $subject): void
    {
        $rule = self::RULES[$scope] ?? null;
        if ($rule === null) {
            throw new LogicException('Unknown rate limit scope: ' . $scope);
        }

        $subject = self::normalizeSubject($subject);
        $this->database->execute(
            'INSERT INTO rate_limits (scope, subject, window_started_at, attempts)
             VALUES (?, ?, UTC_TIMESTAMP(), 1)
             ON DUPLICATE KEY UPDATE
               attempts = IF(window_started_at <= UTC_TIMESTAMP() - INTERVAL ? SECOND, 1, attempts + 1),
               window_started_at = IF(window_started_at <= UTC_TIMESTAMP() - INTERVAL ? SECOND, UTC_TIMESTAMP(), window_started_at)',
            [$scope, $subject, $rule['window'], $rule['window']]
        );

        $row = $this->database->fetchOne(
            'SELECT attempts, window_started_at FROM rate_limits WHERE scope = ? AND subject = ?',
            [$scope, $subject]
        );
        $attempts = (int) ($row['attempts'] ?? 0);
        if ($attempts > $rule['limit']) {
            $retryAfter = $this->retryAfterSeconds($rule['window'], (string) ($row['window_started_at'] ?? ''));
            header('Retry-After: ' . $retryAfter);
            throw new HttpException(429, $rule['message'], 'RATE_LIMITED', [
                'retryAfterSeconds' => (string) $retryAfter,
            ]);
        }

        $this->pruneOccasionally();
    }

    /** Forgets a window, so a successful sign-in does not count against the next one. */
    public function clear(string $scope, string $subject): void
    {
        $this->database->execute(
            'DELETE FROM rate_limits WHERE scope = ? AND subject = ?',
            [$scope, self::normalizeSubject($subject)]
        );
    }

    /**
     * What a limit is counted against. The account is the useful subject for a
     * credential guess, and the caller's address covers the rest, so a request
     * carries both and the caller picks.
     */
    public static function accountKey(string $value): string
    {
        $normalized = mb_strtolower(trim($value));
        return $normalized === '' ? 'unknown' : 'account:' . $normalized;
    }

    /**
     * The address behind the request. X-Forwarded-For is caller-supplied, so
     * honouring it unconditionally (as this once did) let anyone rotate the
     * header and hand every request a fresh rate-limit bucket — which is a
     * free bypass of the register and login caps. The header is therefore only
     * read when the peer that sent it is one of the proxies named in
     * TRUSTED_PROXIES; with that unset the header is ignored entirely and the
     * socket address is the only truth.
     */
    public static function clientKey(string $fallback = 'unknown'): string
    {
        $address = self::forwardedAddress() ?? (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if (filter_var($address, FILTER_VALIDATE_IP) === false) {
            $address = $fallback;
        }
        return 'client:' . $address;
    }

    /**
     * The left-most hop of X-Forwarded-For, but only for a trusted peer. The
     * chain is written client-first, so the first entry is the original client
     * and the entries after it are proxies we already know.
     */
    private static function forwardedAddress(): ?string
    {
        $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '';
        if (!is_string($forwarded) || $forwarded === '' || !self::fromTrustedProxy()) {
            return null;
        }

        $address = trim(explode(',', $forwarded)[0]);
        return $address === '' ? null : $address;
    }

    /** Whether the direct peer is in the TRUSTED_PROXIES allowlist. */
    private static function fromTrustedProxy(): bool
    {
        $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
        if (filter_var($remote, FILTER_VALIDATE_IP) === false) {
            return false;
        }

        foreach (self::trustedProxies() as $proxy) {
            if (self::sameAddress($proxy, $remote)) {
                return true;
            }
        }
        return false;
    }

    /**
     * TRUSTED_PROXIES is a comma-separated list of proxy addresses. Unset or
     * empty means no proxy is trusted, which is the correct default: a
     * deployment that is not behind a reverse proxy must never believe the
     * header, and one that is must say so explicitly.
     *
     * @return list<string>
     */
    private static function trustedProxies(): array
    {
        $configured = function_exists('env') ? env('TRUSTED_PROXIES', '') : getenv('TRUSTED_PROXIES');
        if (!is_string($configured) || trim($configured) === '') {
            return [];
        }

        $proxies = [];
        foreach (explode(',', $configured) as $proxy) {
            $proxy = trim($proxy);
            if (filter_var($proxy, FILTER_VALIDATE_IP) !== false) {
                $proxies[] = $proxy;
            }
        }
        return $proxies;
    }

    /** Compares two validated addresses, folding IPv6 spellings together. */
    private static function sameAddress(string $left, string $right): bool
    {
        $leftBinary = inet_pton($left);
        $rightBinary = inet_pton($right);
        return $leftBinary !== false && $rightBinary !== false && $leftBinary === $rightBinary;
    }

    private static function normalizeSubject(string $subject): string
    {
        return mb_substr(trim($subject), 0, 190);
    }

    private function retryAfterSeconds(int $window, string $windowStartedAt): int
    {
        $started = strtotime($windowStartedAt . ' UTC');
        if ($started === false) {
            return $window;
        }
        return max(1, ($started + $window) - time());
    }

    /** Amortised cleanup; the table stays small without a scheduled task. */
    private function pruneOccasionally(): void
    {
        if (random_int(1, 50) !== 1) {
            return;
        }
        $this->database->execute(
            'DELETE FROM rate_limits WHERE window_started_at <= UTC_TIMESTAMP() - INTERVAL 1 DAY'
        );
    }
}
