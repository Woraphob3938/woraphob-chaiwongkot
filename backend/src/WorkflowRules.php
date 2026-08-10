<?php
declare(strict_types=1);

final class WorkflowRules
{
    public static function parseUtc(string $value, string $field): DateTimeImmutable
    {
        $date = DateTimeImmutable::createFromFormat(
            '!Y-m-d\TH:i:s.v\Z',
            $value,
            new DateTimeZone('UTC')
        );
        if ($date === false || $date->format('Y-m-d\TH:i:s.v\Z') !== $value) {
            throw new HttpException(
                422,
                'รูปแบบวันและเวลาไม่ถูกต้อง',
                'VALIDATION_FAILED',
                [$field => 'ใช้วันและเวลาแบบ UTC']
            );
        }
        return $date;
    }

    public static function assertAvailabilityWindow(
        DateTimeImmutable $now,
        DateTimeImmutable $startsAt,
        DateTimeImmutable $endsAt
    ): void {
        if ($startsAt <= $now) {
            throw new HttpException(
                422,
                'เวลาเริ่มต้องอยู่ในอนาคต',
                'VALIDATION_FAILED',
                ['startsAt' => 'เลือกเวลาในอนาคต']
            );
        }
        if ($endsAt <= $startsAt) {
            throw new HttpException(
                422,
                'เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่ม',
                'VALIDATION_FAILED',
                ['endsAt' => 'เลือกเวลาที่อยู่หลังเวลาเริ่ม']
            );
        }
        if ($startsAt > $now->modify('+2 months')) {
            throw new HttpException(
                422,
                'สร้างตารางล่วงหน้าได้ไม่เกินสองเดือน',
                'VALIDATION_FAILED',
                ['startsAt' => 'เลือกวันภายในสองเดือน']
            );
        }
    }

    public static function assertTrainerApplicationDecision(string $current, string $decision, string $note): void
    {
        if ($current !== 'pending') {
            throw new HttpException(409, 'ใบสมัครนี้ได้รับการตัดสินแล้ว', 'TRAINER_ALREADY_REVIEWED');
        }
        if ($decision === 'reject' && trim($note) === '') {
            throw new HttpException(
                422,
                'กรุณาระบุเหตุผลที่ไม่อนุมัติ',
                'VALIDATION_FAILED',
                ['note' => 'จำเป็นต้องระบุเหตุผล']
            );
        }
    }

    public static function trainerBookingSlotState(string $current, string $target): string
    {
        if (!in_array($target, ['awaiting_payment', 'cancelled'], true)) {
            throw new HttpException(
                422,
                'เทรนเนอร์เลือกสถานะนี้ไม่ได้',
                'INVALID_TRAINER_TRANSITION',
                ['status' => 'เลือกตอบรับหรือปฏิเสธ']
            );
        }
        if ($current !== 'pending_trainer') {
            throw new HttpException(409, 'คำขอนี้ได้รับการตอบแล้ว', 'BOOKING_ALREADY_DECIDED');
        }
        return $target === 'cancelled' ? 'available' : 'held';
    }

    public static function isPaymentDeadlineExpired(
        DateTimeImmutable $deadline,
        DateTimeImmutable $now
    ): bool {
        return $now >= $deadline;
    }

    public static function paymentRejectionTransition(
        int $priorRejectedCount,
        DateTimeImmutable $now
    ): array {
        if ($priorRejectedCount === 0) {
            return [
                'bookingStatus' => 'awaiting_payment',
                'slotState' => 'held',
                'paymentDeadlineAt' => $now->modify('+10 minutes'),
            ];
        }

        return [
            'bookingStatus' => 'expired',
            'slotState' => 'available',
            'paymentDeadlineAt' => null,
        ];
    }

    public static function normalizeMoney(mixed $value, string $field): string
    {
        $raw = trim((string) $value);
        if (preg_match('/^\d{1,8}(?:\.\d{1,2})?$/', $raw) !== 1 || (float) $raw <= 0) {
            throw new HttpException(
                422,
                'จำนวนเงินไม่ถูกต้อง',
                'VALIDATION_FAILED',
                [$field => 'กรอกจำนวนเงินที่มากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง']
            );
        }
        return number_format((float) $raw, 2, '.', '');
    }

    public static function assertPaymentDecision(
        string $paymentStatus,
        string $bookingStatus,
        string $decision,
        string $note
    ): void {
        if ($paymentStatus !== 'reviewing' || $bookingStatus !== 'payment_review') {
            throw new HttpException(409, 'หลักฐานนี้ได้รับการตัดสินแล้ว', 'PAYMENT_ALREADY_REVIEWED');
        }
        if ($decision === 'reject' && trim($note) === '') {
            throw new HttpException(422, 'กรุณาระบุเหตุผลที่สลิปไม่ผ่าน', 'VALIDATION_FAILED', ['note' => 'จำเป็นต้องระบุเหตุผล']);
        }
    }

    public static function assertChatWritable(string $bookingStatus): void
    {
        if (!in_array($bookingStatus, ['awaiting_payment', 'payment_review', 'confirmed', 'completed'], true)) {
            throw new HttpException(409, 'ห้องสนทนานี้ส่งข้อความเพิ่มไม่ได้', 'CHAT_READ_ONLY');
        }
    }

    public static function assertTrainerCompletion(
        string $bookingStatus,
        string $paymentStatus,
        DateTimeImmutable $endsAt,
        DateTimeImmutable $now
    ): void {
        if ($bookingStatus !== 'confirmed' || $paymentStatus !== 'approved') {
            throw new HttpException(409, 'การจองนี้ยังปิดงานไม่ได้', 'BOOKING_NOT_COMPLETABLE');
        }
        if ($now <= $endsAt) {
            throw new HttpException(409, 'ปิดงานได้หลังเวลานัดสิ้นสุด', 'BOOKING_END_NOT_REACHED');
        }
    }

    public static function assertReviewSubmission(string $bookingStatus, int $rating, string $comment): void
    {
        if ($bookingStatus !== 'completed') {
            throw new HttpException(409, 'รีวิวได้หลังการฝึกเสร็จเท่านั้น', 'REVIEW_NOT_READY');
        }
        if ($rating < 1 || $rating > 5) {
            throw new HttpException(422, 'คะแนนต้องอยู่ระหว่าง 1 ถึง 5', 'VALIDATION_FAILED', ['rating' => 'เลือกคะแนน 1 ถึง 5']);
        }
        $length = mb_strlen(trim($comment));
        if ($length < 1 || $length > 2000) {
            throw new HttpException(422, 'ความคิดเห็นต้องมี 1 ถึง 2,000 ตัวอักษร', 'VALIDATION_FAILED', ['comment' => 'เขียนความคิดเห็นไม่เกิน 2,000 ตัวอักษร']);
        }
    }
}
