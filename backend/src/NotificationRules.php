<?php
declare(strict_types=1);

final class NotificationRules
{
    public const BOOKING_CREATED = 'booking_created';
    public const PAYMENT_SUBMITTED = 'payment_submitted';
    public const PAYMENT_APPROVED = 'payment_approved';
    public const PAYMENT_REJECTED_RETRY = 'payment_rejected_retry';
    public const PAYMENT_REJECTED_FINAL = 'payment_rejected_final';
    public const BOOKING_EXPIRED = 'booking_expired';
    public const BOOKING_CANCELLED = 'booking_cancelled';
    public const APPOINTMENT_REMINDER = 'appointment_reminder';

    private const MEMBER_BOOKINGS = '/member';
    private const TRAINER_WORKSPACE = '/trainer';
    private const TRAINER_SEARCH = '/trainers';

    public static function forEvent(string $event, array $context): array
    {
        self::requireContext($context);
        $booking = (string) $context['bookingPublicId'];
        $memberId = (int) $context['memberUserId'];
        $trainerId = (int) $context['trainerUserId'];

        return match ($event) {
            self::BOOKING_CREATED => [self::definition(
                $memberId,
                'booking_created',
                'booking',
                'เริ่มเวลาชำระเงินแล้ว',
                "การจอง {$booking} ถูกเก็บไว้ 10 นาที กรุณาส่งหลักฐานการชำระภายในเวลาที่กำหนด",
                self::MEMBER_BOOKINGS,
                true
            )],
            self::PAYMENT_SUBMITTED => [self::definition(
                $memberId,
                'payment_submitted',
                'payment',
                'ส่งหลักฐานแล้ว',
                "ส่งหลักฐานของการจอง {$booking} ให้ผู้รับผิดชอบตรวจแล้ว",
                self::MEMBER_BOOKINGS,
                false
            )],
            self::PAYMENT_APPROVED => [
                self::definition(
                    $memberId,
                    'payment_approved_member',
                    'payment',
                    'ยืนยันการจองแล้ว',
                    "หลักฐานการชำระของการจอง {$booking} ผ่านแล้ว และนัดหมายได้รับการยืนยัน",
                    self::MEMBER_BOOKINGS,
                    true
                ),
                self::definition(
                    $trainerId,
                    'payment_approved_trainer',
                    'booking',
                    'มีนัดหมายที่ยืนยันแล้ว',
                    "การจอง {$booking} ชำระเงินผ่านแล้วและเพิ่มในตารางนัดหมายของคุณ",
                    self::TRAINER_WORKSPACE,
                    true
                ),
            ],
            self::PAYMENT_REJECTED_RETRY => [self::definition(
                $memberId,
                'payment_rejected_retry',
                'payment',
                'กรุณาส่งหลักฐานใหม่',
                "หลักฐานของการจอง {$booking} ยังไม่ผ่าน คุณมีเวลาใหม่ 10 นาทีเพื่อส่งหลักฐานอีกครั้ง",
                self::MEMBER_BOOKINGS,
                true
            )],
            self::PAYMENT_REJECTED_FINAL => [self::definition(
                $memberId,
                'payment_rejected_final',
                'payment',
                'การจองสิ้นสุดแล้ว',
                "หลักฐานรอบที่สองของการจอง {$booking} ไม่ผ่าน ช่วงเวลาถูกคืนให้สมาชิกคนอื่นจองได้",
                self::TRAINER_SEARCH,
                true
            )],
            self::BOOKING_EXPIRED => [self::definition(
                $memberId,
                'booking_expired',
                'booking',
                'หมดเวลาชำระเงิน',
                "การจอง {$booking} ถูกยกเลิกเพราะไม่ได้ส่งหลักฐานภายใน 10 นาที",
                self::TRAINER_SEARCH,
                true
            )],
            self::BOOKING_CANCELLED => self::cancelledDefinitions($context, $booking, $memberId, $trainerId),
            self::APPOINTMENT_REMINDER => [
                self::definition(
                    $memberId,
                    'appointment_reminder_member',
                    'appointment',
                    'นัดหมายจะเริ่มภายใน 24 ชั่วโมง',
                    "การจอง {$booking} ใกล้ถึงเวลานัดหมายแล้ว กรุณาตรวจวันและเวลาใน FitConnect",
                    self::MEMBER_BOOKINGS,
                    true
                ),
                self::definition(
                    $trainerId,
                    'appointment_reminder_trainer',
                    'appointment',
                    'มีนัดหมายภายใน 24 ชั่วโมง',
                    "การจอง {$booking} ใกล้ถึงเวลานัดหมายแล้ว กรุณาตรวจตารางของคุณ",
                    self::TRAINER_WORKSPACE,
                    true
                ),
            ],
            default => throw new InvalidArgumentException('Unknown notification event.'),
        };
    }

    private static function cancelledDefinitions(array $context, string $booking, int $memberId, int $trainerId): array
    {
        $definitions = [self::definition(
            $memberId,
            'booking_cancelled_member',
            'booking',
            'การจองถูกยกเลิกแล้ว',
            "การจอง {$booking} ถูกยกเลิกแล้ว กรุณาตรวจสถานะล่าสุดใน FitConnect",
            self::MEMBER_BOOKINGS,
            true
        )];
        if ((string) ($context['previousStatus'] ?? '') === 'confirmed') {
            $definitions[] = self::definition(
                $trainerId,
                'booking_cancelled_trainer',
                'booking',
                'นัดหมายถูกยกเลิกแล้ว',
                "การจองที่ยืนยันแล้ว {$booking} ถูกยกเลิกและนำออกจากตารางนัดหมาย",
                self::TRAINER_WORKSPACE,
                true
            );
        }
        return $definitions;
    }

    private static function definition(
        int $recipientUserId,
        string $type,
        string $category,
        string $title,
        string $message,
        string $actionPath,
        bool $emailRequired
    ): array {
        return compact('recipientUserId', 'type', 'category', 'title', 'message', 'actionPath', 'emailRequired');
    }

    private static function requireContext(array $context): void
    {
        foreach (['bookingId', 'bookingPublicId', 'memberUserId', 'trainerUserId'] as $key) {
            if (!array_key_exists($key, $context)) {
                throw new InvalidArgumentException("Missing notification context: {$key}");
            }
        }
    }
}
