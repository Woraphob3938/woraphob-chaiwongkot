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

    /**
     * Accepting and rejecting a booking request are only decisions while the
     * request is still waiting for the trainer.
     */
    public static function assertTrainerDecision(string $current, string $decision): void
    {
        if (!in_array($decision, ['accept', 'reject'], true)) {
            throw new HttpException(422, 'การตอบรับคำขอไม่ถูกต้อง', 'VALIDATION_FAILED', ['status' => 'เลือกตอบรับหรือปฏิเสธ']);
        }
        if ($current !== 'pending_trainer') {
            throw new HttpException(409, 'คำขอนี้ได้รับการตอบรับหรือปิดไปแล้ว', 'INVALID_BOOKING_TRANSITION');
        }
    }

    /** Minutes the member has to pay once the trainer accepts. */
    public const PAYMENT_WINDOW_MINUTES = 10;

    /**
     * The trainer accepts a request and the member is told at once; the ten
     * minute payment window starts now. The training time stays exactly as
     * the member requested it. A request whose session starts before the
     * window would close cannot be accepted: the member could not pay in time.
     */
    public static function acceptancePaymentDeadline(
        DateTimeImmutable $now,
        DateTimeImmutable $sessionStart
    ): DateTimeImmutable {
        $deadline = $now->modify('+' . self::PAYMENT_WINDOW_MINUTES . ' minutes');
        if ($deadline > $sessionStart) {
            throw new HttpException(
                422,
                'ใกล้เวลาฝึกเกินไป สมาชิกจะชำระเงินไม่ทัน',
                'ACCEPTANCE_TOO_LATE'
            );
        }
        return $deadline;
    }

    /**
     * A trainer may cancel any booking that is not closed yet, from the moment
     * the request arrives until the session is completed. The reason itself is
     * required by the handler, which owns the request body.
     */
    public static function assertTrainerCancellation(string $current): void
    {
        if (!in_array($current, ['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed'], true)) {
            throw new HttpException(409, 'การจองนี้ปิดงานแล้ว จึงยกเลิกไม่ได้', 'BOOKING_CANCELLATION_NOT_ALLOWED');
        }
    }

    public static function isPaymentDeadlineExpired(
        DateTimeImmutable $deadline,
        DateTimeImmutable $now
    ): bool {
        return $now >= $deadline;
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

    public static function availabilityEnd(DateTimeImmutable $startsAt): DateTimeImmutable
    {
        return $startsAt->modify('+1 hour');
    }

    public static function assertMonthlyBookingStart(array $slots, int $packageSessionCount): void
    {
        if ($packageSessionCount < 2 || $packageSessionCount > 30 || count($slots) !== 1) {
            throw new HttpException(
                422,
                'กรุณาเลือกเวลานัดแรกหนึ่งช่วง',
                'VALIDATION_FAILED',
                ['slotIds' => 'เลือกเวลานัดแรกเพียงหนึ่งช่วง นัดที่เหลือจัดภายหลัง']
            );
        }
    }

    public static function assertMonthlySessionScheduling(
        string $bookingStatus,
        string $paymentStatus,
        int $scheduledCount,
        int $packageSessionCount,
        DateTimeImmutable $periodStart,
        DateTimeImmutable $periodEnd,
        DateTimeImmutable $startsAt,
        DateTimeImmutable $endsAt
    ): void {
        if ($bookingStatus !== 'confirmed' || $paymentStatus !== 'approved') {
            throw new HttpException(409, 'จัดเวลาที่เหลือได้หลังการชำระเงินผ่าน', 'MONTHLY_SCHEDULING_NOT_READY');
        }
        if ($scheduledCount >= $packageSessionCount) {
            throw new HttpException(409, 'จัดเวลาครบตามแพ็กเกจแล้ว', 'MONTHLY_PACKAGE_FULL');
        }
        if ($startsAt < $periodStart || $endsAt > $periodEnd) {
            throw new HttpException(422, 'เวลาฝึกต้องอยู่ภายใน 30 วัน', 'VALIDATION_FAILED', ['slotId' => 'เลือกช่วงเวลาภายใน 30 วันนับจากนัดแรก']);
        }
    }

    public static function assertChatWritable(string $bookingStatus): void
    {
        if (!in_array($bookingStatus, ['awaiting_payment', 'payment_review', 'confirmed'], true)) {
            throw new HttpException(409, 'ห้องสนทนานี้ส่งข้อความเพิ่มไม่ได้', 'CHAT_READ_ONLY');
        }
    }

    public static function assertMemberCancellation(string $bookingStatus, string $paymentStatus): void
    {
        // A request may be withdrawn while it still waits for the trainer, and
        // an accepted request only until payment evidence is submitted.
        $cancelable = $bookingStatus === 'pending_trainer'
            || ($bookingStatus === 'awaiting_payment' && in_array($paymentStatus, ['not_submitted', 'rejected'], true));
        if (!$cancelable) {
            throw new HttpException(
                409,
                'ยกเลิกได้ก่อนส่งหลักฐานการชำระเงินเท่านั้น',
                'MEMBER_CANCELLATION_NOT_ALLOWED'
            );
        }
    }

    /**
     * An availability slot may be moved only while it is free and its window
     * has not started.
     */
    public static function assertSlotEditable(string $state, DateTimeImmutable $startsAt, DateTimeImmutable $now): void
    {
        if ($state !== 'available' || $startsAt <= $now) {
            throw new HttpException(409, 'แก้ไขได้เฉพาะช่วงเวลาว่างในอนาคต', 'SLOT_NOT_EDITABLE');
        }
    }


    /**
     * Completion compares against the trainer-confirmed end when the booking
     * has one (`confirmed_ends_at`); callers pass `confirmed_ends_at ?? ends_at`.
     */
    public static function assertTrainerCompletion(
        string $bookingStatus,
        string $paymentStatus,
        DateTimeImmutable $endsAt,
        DateTimeImmutable $now,
        int $scheduledCount = 1,
        int $requiredCount = 1,
        ?DateTimeImmutable $periodEnd = null
    ): void {
        if ($bookingStatus !== 'confirmed' || $paymentStatus !== 'approved') {
            throw new HttpException(409, 'การจองนี้ยังปิดงานไม่ได้', 'BOOKING_NOT_COMPLETABLE');
        }
        if ($now <= $endsAt) {
            throw new HttpException(409, 'ปิดงานได้หลังเวลานัดสิ้นสุด', 'BOOKING_END_NOT_REACHED');
        }
        $isPeriodExpired = $periodEnd !== null && $now > $periodEnd;
        if ($scheduledCount < $requiredCount && !$isPeriodExpired) {
            throw new HttpException(409, 'ยังจัดเวลาไม่ครบตามแพ็กเกจ', 'MONTHLY_SESSIONS_INCOMPLETE');
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
