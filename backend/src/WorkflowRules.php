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
}
