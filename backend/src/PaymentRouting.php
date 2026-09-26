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

    /**
     * Which payments a user may see. A trainer sees every slip for their own
     * bookings, freelance and gym alike, because the trainer confirms both
     * (บทที่ 1 ขั้นตอนที่ 4). The gym's administrators keep a read-only view of
     * gym slips so the gym's income can be checked and summed into salaries.
     */
    public static function scope(array $user): array
    {
        if ($user['role'] === 'trainer') {
            return ['tp.user_id = ?', [(int) $user['id']]];
        }
        if ($user['role'] === 'admin') {
            return ['b.payment_service_mode = "gym" AND EXISTS (
                SELECT 1 FROM admin_permissions ap
                WHERE ap.user_id = ? AND ap.review_payments = 1
            )', [(int) $user['id']]];
        }
        return ['1 = 0', []];
    }

    /** Only the booked trainer approves or rejects a slip. */
    public static function decisionScope(array $user): array
    {
        if ($user['role'] === 'trainer') {
            return ['tp.user_id = ?', [(int) $user['id']]];
        }
        return ['1 = 0', []];
    }
}
