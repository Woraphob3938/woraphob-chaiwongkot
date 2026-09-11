<?php
declare(strict_types=1);

final class PaymentRouting
{
    public static function serviceMode(string $trainerMode, mixed $requested): string
    {
        $mode = $requested ?? ($trainerMode === 'both' ? null : $trainerMode);
        if (!is_string($mode) || !in_array($mode, ['freelance', 'gym'], true)
            || ($trainerMode !== 'both' && $trainerMode !== $mode)) {
            throw new HttpException(422, 'เลือกรูปแบบบริการสำหรับการจองนี้', 'VALIDATION_FAILED', ['paymentServiceMode' => 'เลือกฟรีแลนซ์หรือประจำยิม']);
        }
        return $mode;
    }

    // Queues, files and decisions share the booking-time ownership rule.
    public static function scope(array $user): array
    {
        if ($user['role'] === 'trainer') {
            return ['b.payment_service_mode = "freelance" AND tp.user_id = ?', [(int) $user['id']]];
        }
        if ($user['role'] === 'admin') {
            return ['b.payment_service_mode = "gym" AND EXISTS (
                SELECT 1 FROM admin_permissions ap
                WHERE ap.user_id = ? AND ap.review_payments = 1
            )', [(int) $user['id']]];
        }
        return ['1 = 0', []];
    }
}
