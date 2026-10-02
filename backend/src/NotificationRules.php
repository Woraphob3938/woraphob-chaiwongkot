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
    public const BOOKING_ACCEPTED = 'booking_accepted';
    public const BOOKING_REJECTED = 'booking_rejected';
    public const MESSAGE_RECEIVED = 'message_received';
    /** A message in a room a member opened from a trainer profile, before any booking. */
    public const INQUIRY_MESSAGE_RECEIVED = 'inquiry_message_received';
    public const TRAINER_APPLICATION_APPROVED = 'trainer_application_approved';
    public const TRAINER_APPLICATION_REJECTED = 'trainer_application_rejected';

    private const MEMBER_BOOKINGS = '/member';
    private const TRAINER_WORKSPACE = '/trainer';
    private const TRAINER_SEARCH = '/trainers';
    private const CHAT = '/chat';
    private const TRAINER_APPLY = '/trainer/apply';

    public static function forEvent(string $event, array $context): array
    {
        self::requireContext($event, $context);
        $booking = (string) ($context['bookingPublicId'] ?? '');
        $memberId = (int) ($context['memberUserId'] ?? 0);
        $trainerId = (int) ($context['trainerUserId'] ?? 0);

        return match ($event) {
            self::BOOKING_CREATED => [self::definition(
                $memberId,
                'booking_created',
                'booking',
                'ส่งคำขอจองแล้ว',
                "การจอง {$booking} ส่งถึงเทรนเนอร์แล้ว รอการตอบรับและยืนยันช่วงเวลา",
                self::MEMBER_BOOKINGS,
                true
            )],
            self::BOOKING_ACCEPTED => [self::definition(
                $memberId,
                'booking_accepted',
                'booking',
                'เทรนเนอร์ตอบรับการจองแล้ว',
                "เทรนเนอร์ตอบรับการจอง {$booking} เวลาฝึก " . self::confirmedRangeLabel($context) . " กรุณาชำระเงินออนไลน์ภายใน 10 นาที",
                self::MEMBER_BOOKINGS,
                true
            )],
            self::BOOKING_REJECTED => [self::definition(
                $memberId,
                'booking_rejected',
                'booking',
                'เทรนเนอร์ไม่ตอบรับการจอง',
                "เทรนเนอร์ไม่ตอบรับการจอง {$booking} เหตุผล: " . trim((string) ($context['reviewNote'] ?? '')),
                self::TRAINER_SEARCH,
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
                    "ชำระเงินการจอง {$booking} สำเร็จ นัดหมายได้รับการยืนยันแล้ว",
                    self::MEMBER_BOOKINGS,
                    true
                ),
                self::definition(
                    $trainerId,
                    'payment_approved_trainer',
                    'booking',
                    'มีนัดหมายที่ยืนยันแล้ว',
                    "สมาชิกชำระเงินการจอง {$booking} แล้ว นัดหมายถูกเพิ่มในตารางของคุณ",
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
                "การจอง {$booking} ถูกยกเลิกเพราะไม่ได้ชำระเงินภายใน 10 นาที",
                self::TRAINER_SEARCH,
                true
            )],
            self::BOOKING_CANCELLED => self::cancelledDefinitions($context, $booking, $memberId, $trainerId),
            self::MESSAGE_RECEIVED => [self::definition(
                (int) $context['recipientUserId'],
                'message_received' . (isset($context['messageId']) ? '_' . (int) $context['messageId'] : ''),
                'booking',
                'มีข้อความใหม่',
                'มีข้อความใหม่จาก ' . (string) $context['senderName'] . " ในการจอง {$booking}",
                self::CHAT,
                false
            )],
            self::INQUIRY_MESSAGE_RECEIVED => [self::definition(
                (int) $context['recipientUserId'],
                'message_received_' . (int) $context['messageId'],
                'booking',
                'มีข้อความใหม่',
                'มีข้อความใหม่จาก ' . (string) $context['senderName'] . ' ในห้องสอบถามก่อนจอง',
                self::CHAT . '?booking=CHAT-' . (int) $context['roomId'],
                false
            )],
            self::TRAINER_APPLICATION_APPROVED => [self::definition(
                $trainerId,
                'trainer_application_approved',
                'booking',
                'ใบสมัครเทรนเนอร์ได้รับการอนุมัติ',
                'ใบสมัครเทรนเนอร์ได้รับการอนุมัติแล้ว พร้อมรับการจองจากสมาชิก',
                self::TRAINER_WORKSPACE,
                true
            )],
            self::TRAINER_APPLICATION_REJECTED => [self::definition(
                $trainerId,
                'trainer_application_rejected',
                'booking',
                'ใบสมัครเทรนเนอร์ไม่ผ่าน',
                'ใบสมัครเทรนเนอร์ไม่ผ่านการอนุมัติ เหตุผล: ' . trim((string) ($context['reviewNote'] ?? '')),
                self::TRAINER_APPLY,
                true
            )],
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

    /** "31/12/2026 12:00–13:00 น." from the confirmed window in the context. */
    private static function confirmedRangeLabel(array $context): string
    {
        // Stored in UTC; members read Bangkok time in the Buddhist-era year.
        $bangkok = new DateTimeZone('Asia/Bangkok');
        $starts = (new DateTimeImmutable((string) $context['confirmedStartsAt'], new DateTimeZone('UTC')))->setTimezone($bangkok);
        $ends = (new DateTimeImmutable((string) $context['confirmedEndsAt'], new DateTimeZone('UTC')))->setTimezone($bangkok);
        $year = (int) $starts->format('Y') + 543;
        return $starts->format('d/m/') . $year . ' ' . $starts->format('H:i') . '–' . $ends->format('H:i') . ' น.';
    }

    /**
     * Booking events need the whole booking; a chat message needs its recipient
     * and sender; an application decision only the trainer it belongs to.
     */
    private static function requireContext(string $event, array $context): void
    {
        $required = match ($event) {
            self::MESSAGE_RECEIVED => ['recipientUserId', 'senderName', 'bookingId', 'bookingPublicId'],
            self::INQUIRY_MESSAGE_RECEIVED => ['recipientUserId', 'senderName', 'roomId', 'messageId'],
            self::TRAINER_APPLICATION_APPROVED, self::TRAINER_APPLICATION_REJECTED => ['trainerUserId'],
            self::BOOKING_ACCEPTED => ['bookingId', 'bookingPublicId', 'memberUserId', 'trainerUserId', 'confirmedStartsAt', 'confirmedEndsAt'],
            default => ['bookingId', 'bookingPublicId', 'memberUserId', 'trainerUserId'],
        };
        foreach ($required as $key) {
            if (!array_key_exists($key, $context)) {
                throw new InvalidArgumentException("Missing notification context: {$key}");
            }
        }
    }
}
