<?php
declare(strict_types=1);

/**
 * A thin Stripe REST client over cURL. The API has no Composer, so this keeps
 * the backend deployable on plain PHP hosting. Only the calls FitConnect uses
 * live here; everything else about payments is in StripePayments.
 */
final class StripeClient
{
    private const API = 'https://api.stripe.com';
    /** Accounts v2 (connected accounts) is only served under a preview version. */
    public const V2_VERSION = '2026-05-27.preview';

    public function __construct(
        private readonly string $secretKey,
        private readonly string $webhookSecret = '',
    ) {
    }

    public function enabled(): bool
    {
        return $this->secretKey !== '';
    }

    public function testMode(): bool
    {
        return str_starts_with($this->secretKey, 'sk_test_') || str_starts_with($this->secretKey, 'rk_test_');
    }

    /**
     * `$account` makes the call on a connected account (Stripe-Account header),
     * which is how direct charges and their refunds are made.
     *
     * @param array<string, mixed> $params
     */
    public function post(string $path, array $params = [], ?string $idempotencyKey = null, ?string $account = null): array
    {
        return $this->request('POST', $path, self::encode($params), $idempotencyKey, $account);
    }

    /** @param array<string, mixed> $query */
    public function get(string $path, array $query = [], ?string $account = null): array
    {
        return $this->request('GET', $path, self::encode($query), null, $account);
    }

    /** Accounts v2 endpoints take JSON and the preview version. */
    public function postV2(string $path, array $body, ?string $idempotencyKey = null): array
    {
        return $this->request('POST', $path, (string) json_encode($body, JSON_UNESCAPED_UNICODE), $idempotencyKey, null, true);
    }

    public function getV2(string $path, array $query = []): array
    {
        return $this->request('GET', $path, http_build_query($query), null, null, true);
    }

    private function request(string $method, string $path, string $body, ?string $idempotencyKey, ?string $account, bool $v2 = false): array
    {
        if (!$this->enabled()) {
            throw new HttpException(503, 'ระบบชำระเงินออนไลน์ยังไม่ได้ตั้งค่า', 'PAYMENTS_UNAVAILABLE');
        }
        $url = self::API . $path . ($method === 'GET' && $body !== '' ? '?' . $body : '');
        $headers = ['Authorization: Bearer ' . $this->secretKey];
        if ($idempotencyKey !== null) {
            $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
        }
        if ($account !== null) {
            $headers[] = 'Stripe-Account: ' . $account;
        }
        if ($v2) {
            $headers[] = 'Stripe-Version: ' . self::V2_VERSION;
            $headers[] = 'Content-Type: application/json';
        }
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => 30,
        ]);
        if ($method !== 'GET') {
            curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
        }
        $raw = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $transportError = curl_error($curl);
        curl_close($curl);

        if ($raw === false) {
            error_log('[fitconnect:stripe] ' . $method . ' ' . $path . ' transport error: ' . $transportError);
            throw new HttpException(502, 'เชื่อมต่อระบบชำระเงินไม่สำเร็จ กรุณาลองใหม่', 'PAYMENT_PROVIDER_UNAVAILABLE');
        }
        $data = json_decode((string) $raw, true);
        if (!is_array($data)) {
            throw new HttpException(502, 'ระบบชำระเงินตอบกลับไม่ถูกต้อง', 'PAYMENT_PROVIDER_UNAVAILABLE');
        }
        if ($status >= 400) {
            $error = is_array($data['error'] ?? null) ? $data['error'] : [];
            // The provider message is for the log only; it is English and may
            // name internal settings.
            error_log(sprintf(
                '[fitconnect:stripe] %s %s -> %d %s: %s',
                $method,
                $path,
                $status,
                (string) ($error['code'] ?? $error['type'] ?? 'error'),
                (string) ($error['message'] ?? '')
            ));
            throw new HttpException(
                $status >= 500 ? 502 : 422,
                'ระบบชำระเงินปฏิเสธคำขอ กรุณาลองใหม่หรือติดต่อผู้ดูแลระบบ',
                'PAYMENT_PROVIDER_ERROR'
            );
        }
        return $data;
    }

    /**
     * Stripe's form encoding: nested keys in brackets, booleans as words.
     *
     * @param array<string, mixed> $params
     */
    public static function encode(array $params): string
    {
        $pairs = [];
        $walk = function (mixed $value, string $key) use (&$walk, &$pairs): void {
            if (is_array($value)) {
                foreach ($value as $childKey => $childValue) {
                    $walk($childValue, $key . '[' . $childKey . ']');
                }
                return;
            }
            if ($value === null) {
                return;
            }
            if (is_bool($value)) {
                $value = $value ? 'true' : 'false';
            }
            $pairs[] = rawurlencode($key) . '=' . rawurlencode((string) $value);
        };
        foreach ($params as $key => $value) {
            $walk($value, (string) $key);
        }
        return implode('&', $pairs);
    }

    /**
     * Checks the Stripe-Signature header and returns the decoded event.
     * https://docs.stripe.com/webhooks#verify-manually
     */
    public function verifyWebhook(string $payload, string $signatureHeader, ?int $now = null, int $tolerance = 300): array
    {
        if ($this->webhookSecret === '') {
            throw new HttpException(503, 'ยังไม่ได้ตั้งค่า webhook ของระบบชำระเงิน', 'WEBHOOK_UNAVAILABLE');
        }
        $timestamp = null;
        $signatures = [];
        foreach (explode(',', $signatureHeader) as $part) {
            [$name, $value] = array_pad(explode('=', trim($part), 2), 2, '');
            if ($name === 't' && ctype_digit($value)) {
                $timestamp = (int) $value;
            } elseif ($name === 'v1') {
                $signatures[] = $value;
            }
        }
        if ($timestamp === null || $signatures === []) {
            throw new HttpException(400, 'ลายเซ็น webhook ไม่ถูกต้อง', 'INVALID_SIGNATURE');
        }
        if (abs(($now ?? time()) - $timestamp) > $tolerance) {
            throw new HttpException(400, 'webhook หมดอายุ', 'INVALID_SIGNATURE');
        }
        $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $this->webhookSecret);
        $valid = false;
        foreach ($signatures as $signature) {
            if (hash_equals($expected, $signature)) {
                $valid = true;
            }
        }
        if (!$valid) {
            throw new HttpException(400, 'ลายเซ็น webhook ไม่ถูกต้อง', 'INVALID_SIGNATURE');
        }
        $event = json_decode($payload, true);
        if (!is_array($event) || !isset($event['type'])) {
            throw new HttpException(400, 'ข้อมูล webhook ไม่ถูกต้อง', 'INVALID_PAYLOAD');
        }
        return $event;
    }
}
