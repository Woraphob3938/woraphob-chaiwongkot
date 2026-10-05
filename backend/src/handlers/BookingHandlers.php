<?php
declare(strict_types=1);

/** Bookings from request to completion, their expiry, history and reviews. Part of Handlers. */
trait BookingHandlers
{
    public function listBookings(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        if ($user['role'] === 'admin') {
            $user = $this->requireAdminPermission('manage_bookings');
        }
        $this->expireAwaitingPayments();
        $where = '';
        $params = [];
        if ($user['role'] === 'member') {
            $where = 'WHERE b.member_user_id = ?';
            $params[] = $user['id'];
        } elseif ($user['role'] === 'trainer') {
            $where = 'WHERE tp.user_id = ?';
            $params[] = $user['id'];
        }
        $rows = $this->database->fetchAll(
            'SELECT b.id AS booking_db_id, b.public_id, b.starts_at, b.ends_at, b.member_note,
                    b.confirmed_starts_at, b.confirmed_ends_at, b.cancellation_reason,
                    b.booking_type, b.session_count, b.period_start, b.period_end, b.payment_service_mode,
                    b.status, b.payment_status, b.payment_deadline_at, b.quoted_price, b.transfer_amount, b.created_at, b.is_demo,
                    tp.id AS trainer_id, tp.slug, tp.user_id AS trainer_user_id, tp.image_path AS trainer_image_path,
                    trainer_user.display_name AS trainer_name,
                    b.member_user_id, member_user.display_name AS member_name,
                    mp.image_path AS member_image_path,
                    mp.goals AS member_goals, mp.experience_level AS member_experience_level,
                    mp.weight AS member_weight, mp.height AS member_height, mp.medical_note AS member_medical_note,
                    cr.id AS chat_room_id,
                    pay.id AS payment_id, pay.amount AS payment_amount,
                    pay.status AS payment_record_status, pay.review_note AS payment_review_note,
                    pay.submitted_at AS payment_submitted_at,
                    r.id AS review_id, r.rating AS review_rating, r.comment AS review_comment,
                    r.status AS review_status, r.created_at AS review_created_at
             FROM bookings b
             JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
             JOIN users trainer_user ON trainer_user.id = tp.user_id
             JOIN users member_user ON member_user.id = b.member_user_id
             LEFT JOIN member_profiles mp ON mp.user_id = b.member_user_id
             LEFT JOIN chat_rooms cr ON cr.booking_id = b.id
             LEFT JOIN payments pay ON pay.id = (
                 SELECT latest_payment.id FROM payments latest_payment
                 WHERE latest_payment.booking_id = b.id
                 ORDER BY latest_payment.submitted_at DESC, latest_payment.id DESC LIMIT 1
             )
             LEFT JOIN reviews r ON r.booking_id = b.id ' .
             $where . ' ORDER BY b.created_at DESC LIMIT 100',
            $params
        );
        $sessionsByBooking = [];
        if ($rows !== []) {
            $bookingIds = array_map(fn(array $row): int => (int) $row['booking_db_id'], $rows);
            $placeholders = self::marks($bookingIds);
            $sessions = $this->database->fetchAll(
                'SELECT booking_id, availability_slot_id, starts_at, ends_at
                 FROM booking_sessions
                 WHERE booking_id IN (' . $placeholders . ')
                 ORDER BY booking_id, starts_at, id',
                $bookingIds
            );
            foreach ($sessions as $session) {
                $sessionsByBooking[(int) $session['booking_id']][] = [
                    'id' => $session['availability_slot_id'] === null ? 0 : (int) $session['availability_slot_id'],
                    'startsAt' => $this->iso($session['starts_at']),
                    'endsAt' => $this->iso($session['ends_at']),
                ];
            }
        }
        Http::json(array_map(
            fn(array $row): array => $this->bookingPayload(
                $row,
                (string) $user['role'],
                $sessionsByBooking[(int) $row['booking_db_id']] ?? []
            ),
            $rows
        ));
    }

    public function createBooking(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['trainerId']);
        $bookingType = Http::stringField($input, 'bookingType', 'single');
        if (!in_array($bookingType, ['single', 'monthly'], true)) {
            throw new HttpException(422, 'รูปแบบการจองไม่ถูกต้อง', 'VALIDATION_FAILED', ['bookingType' => 'เลือกการจองรายครั้งหรือแพ็กเกจ 30 วัน']);
        }
        if ($bookingType === 'monthly') {
            if (!is_array($input['slotIds'] ?? null)) {
                throw new HttpException(422, 'กรุณาเลือกเวลาในแพ็กเกจ', 'VALIDATION_FAILED', ['slotIds' => 'เลือกเวลาตามจำนวนครั้งในแพ็กเกจ']);
            }
            $slotIds = array_values(array_unique(array_map('intval', $input['slotIds'])));
            if ($slotIds === [] || in_array(0, $slotIds, true)) {
                throw new HttpException(422, 'ช่วงเวลาที่เลือกไม่ถูกต้อง', 'VALIDATION_FAILED', ['slotIds' => 'เลือกช่วงเวลาที่เปิดให้จอง']);
            }
        } else {
            Http::requireFields($input, ['slotId']);
            $slotIds = [(int) $input['slotId']];
        }
        $publicId = 'BK-' . strtoupper(bin2hex(random_bytes(4)));
        $notificationIds = [];

        $booking = $this->database->transaction(function (PDO $pdo) use ($user, $input, $publicId, $bookingType, $slotIds, &$notificationIds): array {
            $this->expireAwaitingPaymentsInTransaction($pdo, null, $notificationIds);
            $placeholders = self::marks($slotIds);
            $slots = $this->database->fetchAll(
                'SELECT s.id, s.trainer_profile_id, s.starts_at, s.ends_at, s.state,
                        tp.approval_status, tp.price_from, tp.monthly_price, tp.monthly_session_count, tp.service_mode,
                        trainer_user.status AS trainer_user_status
                 FROM availability_slots s
                 JOIN trainer_profiles tp ON tp.id = s.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 WHERE s.id IN (' . $placeholders . ') AND s.trainer_profile_id = ?
                 ORDER BY s.starts_at, s.id FOR UPDATE',
                [...$slotIds, (int) $input['trainerId']]
            );
            // A slot that is not in this trainer's list does not exist as far as
            // this request is concerned: that is a 404, not the 409 a slot that
            // is merely taken deserves. Conflating them told a member a time was
            // taken when it had never been offered at all.
            if (count($slots) !== count($slotIds)) {
                throw new HttpException(404, 'ไม่พบช่วงเวลาที่เลือก', 'SLOT_NOT_FOUND');
            }
            foreach ($slots as $slot) {
                if (
                    $slot['state'] !== 'available'
                    || $slot['approval_status'] !== 'approved'
                    || $slot['trainer_user_status'] !== 'active'
                    || strtotime($slot['starts_at'] . ' UTC') <= time()
                ) {
                    throw new HttpException(409, 'มีช่วงเวลาที่ไม่พร้อมจองแล้ว', 'SLOT_UNAVAILABLE');
                }
            }
            $firstSlot = $slots[0];
            $paymentMode = PaymentRouting::serviceMode((string) $firstSlot['service_mode'], $input['paymentServiceMode'] ?? null);
            $lastSlot = $slots[count($slots) - 1];
            if ($bookingType === 'monthly') {
                $sessionCount = (int) ($firstSlot['monthly_session_count'] ?? 0);
                WorkflowRules::assertMonthlyBookingStart($slots, $sessionCount);
                if ($firstSlot['monthly_price'] === null || (float) $firstSlot['monthly_price'] <= 0) {
                    throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้กำหนดราคาแพ็กเกจ', 'TRAINER_PRICE_UNAVAILABLE');
                }
                $quotedPrice = $firstSlot['monthly_price'];
                $periodStart = $firstSlot['starts_at'];
                $periodEnd = (self::utc((string) $periodStart))
                    ->modify('+30 days')->format('Y-m-d H:i:s');
            } else {
                $sessionCount = 1;
                if ($firstSlot['price_from'] === null || (float) $firstSlot['price_from'] <= 0) {
                    throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก', 'TRAINER_PRICE_UNAVAILABLE');
                }
                $quotedPrice = $firstSlot['price_from'];
                $periodStart = null;
                $periodEnd = null;
            }
            $insert = $pdo->prepare(
                'INSERT INTO bookings
                 (public_id, member_user_id, trainer_profile_id, availability_slot_id,
                  starts_at, ends_at, member_note, booking_type, session_count, period_start,
                  period_end, quoted_price, payment_service_mode, status, payment_status, payment_deadline_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "pending_trainer", "not_submitted", NULL)'
            );
            $insert->execute([
                $publicId, $user['id'], (int) $input['trainerId'], (int) $firstSlot['id'],
                $firstSlot['starts_at'], $lastSlot['ends_at'], trim(Http::stringField($input, 'note')),
                $bookingType, $sessionCount, $periodStart, $periodEnd, $quotedPrice, $paymentMode,
            ]);
            $bookingId = (int) $pdo->lastInsertId();
            $insertSession = $pdo->prepare(
                'INSERT INTO booking_sessions (booking_id, availability_slot_id, starts_at, ends_at) VALUES (?, ?, ?, ?)'
            );
            $holdSlot = $pdo->prepare('UPDATE availability_slots SET state = "held" WHERE id = ?');
            foreach ($slots as $slot) {
                $insertSession->execute([$bookingId, $slot['id'], $slot['starts_at'], $slot['ends_at']]);
                $holdSlot->execute([$slot['id']]);
            }
            $historyNote = $bookingType === 'monthly'
                ? "สมาชิกจองแพ็กเกจ {$sessionCount} ครั้ง รอเทรนเนอร์ตอบรับ"
                : 'สมาชิกส่งคำขอจอง รอเทรนเนอร์ตอบรับ';
            $this->history($pdo, $bookingId, null, 'pending_trainer', $user['id'], $historyNote);
            $pdo->prepare('INSERT INTO chat_rooms (booking_id) VALUES (?)')->execute([$bookingId]);
            $this->notify($pdo, $notificationIds, NotificationRules::BOOKING_CREATED, $this->bookingNotificationContext($pdo, $bookingId, 'created', 'pending_trainer'));
            return [
                'id' => $publicId,
                'status' => 'pending_trainer',
                'bookingType' => $bookingType,
                'sessionCount' => $sessionCount,
                'quotedPrice' => (float) $quotedPrice,
                // The ten minute payment clock starts when the trainer accepts.
                'paymentDeadlineAt' => null,
            ];
        });
        $this->notifications->deliverByIds($notificationIds);

        Http::json($booking, 201);
    }

    public function addMonthlyBookingSession(string $publicId): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['slotId']);
        $slotId = (int) $input['slotId'];
        if ($slotId <= 0) {
            throw new HttpException(422, 'ช่วงเวลาที่เลือกไม่ถูกต้อง', 'VALIDATION_FAILED', ['slotId' => 'เลือกช่วงเวลาที่เปิดให้จอง']);
        }

        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $slotId, $user): array {
            $booking = $this->database->fetchOne(
                'SELECT b.id, b.member_user_id, b.trainer_profile_id, b.booking_type, b.status,
                        b.payment_status, b.session_count, b.period_start, b.period_end,
                        (SELECT COUNT(*) FROM booking_sessions bs WHERE bs.booking_id = b.id) AS scheduled_count
                 FROM bookings b WHERE b.public_id = ? FOR UPDATE',
                [$publicId]
            );
            if (!$booking || (int) $booking['member_user_id'] !== (int) $user['id']) {
                throw new HttpException(404, 'ไม่พบการจองนี้', 'BOOKING_NOT_FOUND');
            }
            if ($booking['booking_type'] !== 'monthly' || $booking['period_start'] === null || $booking['period_end'] === null) {
                throw new HttpException(409, 'การจองนี้ไม่ใช่แพ็กเกจรายเดือน', 'NOT_MONTHLY_BOOKING');
            }

            $slot = $this->database->fetchOne(
                'SELECT id, trainer_profile_id, starts_at, ends_at, state
                 FROM availability_slots WHERE id = ? FOR UPDATE',
                [$slotId]
            );
            if (!$slot || (int) $slot['trainer_profile_id'] !== (int) $booking['trainer_profile_id']
                || $slot['state'] !== 'available' || strtotime($slot['starts_at'] . ' UTC') <= time()) {
                throw new HttpException(409, 'ช่วงเวลานี้ไม่พร้อมจองแล้ว', 'SLOT_UNAVAILABLE');
            }

            WorkflowRules::assertMonthlySessionScheduling(
                (string) $booking['status'],
                (string) $booking['payment_status'],
                (int) $booking['scheduled_count'],
                (int) $booking['session_count'],
                self::utc((string) $booking['period_start']),
                self::utc((string) $booking['period_end']),
                self::utc((string) $slot['starts_at']),
                self::utc((string) $slot['ends_at']),
            );

            $pdo->prepare('INSERT INTO booking_sessions (booking_id, availability_slot_id, starts_at, ends_at) VALUES (?, ?, ?, ?)')
                ->execute([$booking['id'], $slot['id'], $slot['starts_at'], $slot['ends_at']]);
            $pdo->prepare('UPDATE availability_slots SET state = "booked" WHERE id = ?')->execute([$slot['id']]);
            $pdo->prepare('UPDATE bookings SET ends_at = GREATEST(ends_at, ?), updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$slot['ends_at'], $booking['id']]);

            return [
                'bookingId' => $publicId,
                'session' => ['id' => (int) $slot['id'], 'startsAt' => $this->iso($slot['starts_at']), 'endsAt' => $this->iso($slot['ends_at'])],
                'scheduledCount' => (int) $booking['scheduled_count'] + 1,
                'sessionCount' => (int) $booking['session_count'],
            ];
        });

        Http::json($result, 201);
    }

    public function cancelMemberBooking(string $publicId): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        // The member may explain why they cancel (บทที่ 3.1.2 ข้อ 5).
        $memberReason = trim(Http::stringField($input, 'reason'));
        if (mb_strlen($memberReason) > 500) {
            throw new HttpException(422, 'เหตุผลการยกเลิกยาวเกินไป', 'VALIDATION_FAILED', ['reason' => 'กรอกไม่เกิน 500 ตัวอักษร']);
        }
        $notificationIds = [];

        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $user, $memberReason, &$notificationIds): array {
            $this->expireAwaitingPaymentsInTransaction($pdo, null, $notificationIds);
            $booking = $this->database->fetchOne(
                'SELECT id, status, payment_status, availability_slot_id
                 FROM bookings
                 WHERE public_id = ? AND member_user_id = ? FOR UPDATE',
                [$publicId, $user['id']]
            );
            if (!$booking) {
                throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
            }

            WorkflowRules::assertMemberCancellation(
                (string) $booking['status'],
                (string) $booking['payment_status']
            );
            $reason = $memberReason !== '' ? $memberReason : ($booking['status'] === 'pending_trainer'
                ? 'สมาชิกยกเลิกคำขอก่อนเทรนเนอร์ตอบรับ'
                : 'สมาชิกยกเลิกก่อนชำระเงิน');
            $this->checkoutsToExpire = [...$this->checkoutsToExpire, ...$this->closePendingCheckoutsInTransaction($pdo, (int) $booking['id'])];

            $pdo->prepare(
                'UPDATE bookings
                 SET status = "cancelled", payment_deadline_at = NULL,
                     cancellation_reason = ?, updated_at = UTC_TIMESTAMP()
                 WHERE id = ?'
            )->execute([$reason, $booking['id']]);
            $this->setBookingSlotsState($pdo, (int) $booking['id'], $booking['availability_slot_id'], 'available');
            $this->history($pdo, $booking['id'], $booking['status'], 'cancelled', $user['id'], $reason);

            $this->notify($pdo, $notificationIds, NotificationRules::BOOKING_CANCELLED, $this->bookingNotificationContext($pdo, (int) $booking['id'], (string) $booking['status'], 'cancelled', $reason));

            return ['id' => $publicId, 'status' => 'cancelled', 'reason' => $reason];
        });
        $this->notifications->deliverByIds($notificationIds);

        Http::json($result);
    }

    public function updateBookingStatus(string $publicId): never
    {
        $user = $this->auth->requireUser(['trainer', 'admin']);
        if ($user['role'] === 'admin') {
            $user = $this->requireAdminPermission('manage_bookings');
        }
        $input = Http::body();
        Http::requireFields($input, ['status']);
        $notificationIds = [];

        $chatFilesToRemove = [];
        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $input, $user, &$notificationIds, &$chatFilesToRemove): array {
            $booking = $this->database->fetchOne(
                'SELECT b.id, b.status, b.payment_status, b.quoted_price, b.starts_at, b.ends_at,
                        b.confirmed_starts_at, b.confirmed_ends_at,
                        b.booking_type, b.session_count, b.period_end,
                        (SELECT COUNT(*) FROM booking_sessions bs WHERE bs.booking_id = b.id) AS scheduled_count,
                        b.availability_slot_id, tp.user_id AS trainer_user_id
                 FROM bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id WHERE b.public_id = ? FOR UPDATE',
                [$publicId]
            );
            if (!$booking) {
                throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
            }
            $newStatus = Http::stringField($input, 'status');
            $currentStatus = (string) $booking['status'];
            $note = trim(Http::stringField($input, 'note'));
            $event = null;
            $slotState = null;
            $result = [
                'id' => $publicId,
                'status' => $newStatus,
                'quotedPrice' => $booking['quoted_price'] === null ? null : (float) $booking['quoted_price'],
            ];
            $periodEnd = ($booking['period_end'] ?? null) !== null
                ? self::utc((string) $booking['period_end'])
                : null;

            if ($user['role'] === 'trainer') {
                if ((int) $booking['trainer_user_id'] !== (int) $user['id']) {
                    throw new HttpException(403, 'ไม่มีสิทธิ์แก้ไขคำขอนี้', 'FORBIDDEN');
                }
                if ($newStatus === 'awaiting_payment') {
                    // Accept the requested period before starting the ten minute payment clock.
                    WorkflowRules::assertTrainerDecision($currentStatus, 'accept');
$deadline = WorkflowRules::acceptancePaymentDeadline(
                        self::utc(),
                        self::utc((string) $booking['starts_at'])
                    );
                    // The training time stays as requested; the member hears
                    // about the acceptance now and has ten minutes to pay.
                    $pdo->prepare(
                        'UPDATE bookings
                         SET status = "awaiting_payment", confirmed_starts_at = starts_at, confirmed_ends_at = ends_at,
                             payment_deadline_at = ?, updated_at = UTC_TIMESTAMP()
                         WHERE id = ?'
                    )->execute([$deadline->format('Y-m-d H:i:s'), $booking['id']]);
                    $this->history($pdo, $booking['id'], 'pending_trainer', 'awaiting_payment', $user['id'], 'เทรนเนอร์ตอบรับ สมาชิกชำระเงินได้ภายใน 10 นาที');
                    $this->notify($pdo, $notificationIds, NotificationRules::BOOKING_ACCEPTED, $this->bookingNotificationContext($pdo, (int) $booking['id'], 'pending_trainer', 'awaiting_payment'));
                    $result['paymentDeadlineAt'] = $this->iso($deadline->format('Y-m-d H:i:s'));
                    return $result;
                } elseif ($newStatus === 'cancelled') {
                    // From pending_trainer this is a rejection, otherwise an
                    // open booking the trainer walks away from. Both need a
                    // reason the member can read.
                    if ($note === '') {
                        throw new HttpException(422, 'กรุณาระบุเหตุผล', 'VALIDATION_FAILED', ['note' => 'จำเป็นต้องระบุเหตุผล']);
                    }
                    if ($currentStatus === 'pending_trainer') {
                        WorkflowRules::assertTrainerDecision($currentStatus, 'reject');
                        $event = NotificationRules::BOOKING_REJECTED;
                    } else {
                        WorkflowRules::assertTrainerCancellation($currentStatus);
                        $event = NotificationRules::BOOKING_CANCELLED;
                    }
                    $slotState = 'available';
                    $result['reason'] = $note;
                } elseif ($newStatus === 'completed') {
                    WorkflowRules::assertTrainerCompletion(
                        $currentStatus,
                        (string) $booking['payment_status'],
                        // The trainer-confirmed end rules once one exists.
                        self::utc((string) ($booking['confirmed_ends_at'] ?? $booking['ends_at'])),
                        self::utc(),
                        (int) $booking['scheduled_count'],
                        (int) $booking['session_count'],
                        $periodEnd
                    );
                    $slotState = 'booked';
                } else {
                    throw new HttpException(409, 'ไม่สามารถเปลี่ยนจากสถานะปัจจุบันไปสถานะนี้', 'INVALID_BOOKING_TRANSITION');
                }
            } else {
                $adminTransitions = [
                    'pending_trainer' => ['cancelled'],
                    'awaiting_payment' => ['cancelled'],
                    'payment_review' => ['cancelled'],
                    'confirmed' => ['cancelled'],
                ];
                if (!in_array($newStatus, $adminTransitions[$currentStatus] ?? [], true)) {
                    throw new HttpException(
                        409,
                        'ไม่สามารถเปลี่ยนจากสถานะปัจจุบันไปสถานะนี้',
                        'INVALID_BOOKING_TRANSITION'
                    );
                }
                $slotState = 'available';
            }

            if ($newStatus !== 'awaiting_payment' || $user['role'] !== 'trainer') {
                // The acceptance branch already wrote its own transition; every
                // other path stores the closing reason and drops any payment clock.
                $pdo->prepare('UPDATE bookings SET status = ?, cancellation_reason = ?, payment_deadline_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([
                        $newStatus,
                        $newStatus === 'cancelled' ? $note : null,
                        $booking['id'],
                    ]);
            }
            $this->history($pdo, $booking['id'], $currentStatus, $newStatus, $user['id'], $note);
            if ($slotState !== null) {
                $this->setBookingSlotsState($pdo, (int) $booking['id'], $booking['availability_slot_id'], $slotState);
            }
            if ($newStatus === 'completed') {
                // The training is over, so the booking's chat has served its
                // purpose: remove the room, its messages (ON DELETE CASCADE)
                // and every file sent in it.
                $files = $pdo->prepare(
                    'SELECT m.attachment_path, m.image_path FROM messages m
                     JOIN chat_rooms cr ON cr.id = m.chat_room_id WHERE cr.booking_id = ?'
                );
                $files->execute([$booking['id']]);
                foreach ($files->fetchAll(PDO::FETCH_ASSOC) as $row) {
                    foreach (['attachment_path', 'image_path'] as $column) {
                        if (!empty($row[$column])) {
                            $chatFilesToRemove[] = (string) $row[$column];
                        }
                    }
                }
                $pdo->prepare('DELETE FROM chat_rooms WHERE booking_id = ?')->execute([$booking['id']]);
            }
            if ($newStatus === 'cancelled') {
                // A paid booking is refunded in full (the trainer's transfer is
                // reversed); an unpaid one has its open payment page closed.
                if ($this->refundBookingPaymentInTransaction($pdo, (int) $booking['id'], $note === '' ? 'ยกเลิกการจอง' : $note)) {
                    $this->history($pdo, $booking['id'], 'cancelled', 'cancelled', $user['id'], 'คืนเงินให้สมาชิกผ่านระบบชำระเงินแล้ว');
                }
                $this->checkoutsToExpire = [...$this->checkoutsToExpire, ...$this->closePendingCheckoutsInTransaction($pdo, (int) $booking['id'])];
                // An administrator can cancel while a slip is still queued. Close
                // that payment out too, otherwise it stays "reviewing" forever and
                // decidePayment answers PAYMENT_ALREADY_REVIEWED with no way back.
                $pdo->prepare(
                    'UPDATE payments
                     SET status = "rejected", review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP()
                     WHERE booking_id = ? AND status = "reviewing"'
                )->execute([$note === '' ? 'คำขอจองถูกยกเลิกโดยผู้ดูแลระบบ' : $note, $user['id'], $booking['id']]);
            }
            if ($event !== null) {
                $this->notify($pdo, $notificationIds, $event, $this->bookingNotificationContext($pdo, (int) $booking['id'], $currentStatus, $newStatus, $note));
            }
            return $result;
        });
        // Files leave the disk only after the delete has committed.
        foreach ($chatFilesToRemove as $path) {
            $this->removeUpload($path);
        }
        $this->notifications->deliverByIds($notificationIds);
        Http::json($result);
    }

    public function review(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();

        $missingFields = [];
        foreach (['bookingId', 'rating', 'comment'] as $field) {
            if (!array_key_exists($field, $input)) {
                $missingFields[$field] = 'จำเป็นต้องระบุข้อมูล';
            }
        }
        if ($missingFields !== []) {
            throw new HttpException(422, 'กรอกข้อมูลที่จำเป็นให้ครบ', 'VALIDATION_FAILED', $missingFields);
        }

        if (!is_string($input['bookingId'])) {
            throw new HttpException(422, 'รหัสการจองไม่ถูกต้อง', 'VALIDATION_FAILED', ['bookingId' => 'ต้องเป็นรหัสการจอง']);
        }
        $bookingId = trim($input['bookingId']);
        if ($bookingId === '') {
            throw new HttpException(422, 'รหัสการจองไม่ถูกต้อง', 'VALIDATION_FAILED', ['bookingId' => 'ต้องเป็นรหัสการจอง']);
        }

        $rawRating = $input['rating'];
        if (is_int($rawRating)) {
            $rating = $rawRating;
        } elseif (is_string($rawRating) && preg_match('/^[1-5]$/', $rawRating) === 1) {
            $rating = (int) $rawRating;
        } else {
            throw new HttpException(422, 'คะแนนต้องอยู่ระหว่าง 1 ถึง 5', 'VALIDATION_FAILED', ['rating' => 'เลือกคะแนน 1 ถึง 5']);
        }

        if (!is_string($input['comment'])) {
            throw new HttpException(422, 'รูปแบบความคิดเห็นไม่ถูกต้อง', 'VALIDATION_FAILED', ['comment' => 'ต้องเป็นข้อความ']);
        }
        $comment = trim($input['comment']);

        $booking = $this->database->fetchOne(
            'SELECT id, trainer_profile_id, status FROM bookings WHERE public_id = ? AND member_user_id = ?',
            [$bookingId, $user['id']]
        );
        if (!$booking) {
            throw new HttpException(404, 'ไม่พบการจองนี้', 'BOOKING_NOT_FOUND');
        }

        WorkflowRules::assertReviewSubmission((string) $booking['status'], $rating, $comment);

        try {
            $this->database->execute(
                'INSERT INTO reviews (booking_id, member_user_id, trainer_profile_id, rating, comment, status) VALUES (?, ?, ?, ?, ?, "published")',
                [$booking['id'], $user['id'], $booking['trainer_profile_id'], $rating, $comment]
            );
        } catch (PDOException $error) {
            $driverCode = (int) ($error->errorInfo[1] ?? 0);
            $driverMessage = (string) ($error->errorInfo[2] ?? '');
            if (
                (string) $error->getCode() === '23000'
                && $driverCode === 1062
                && str_contains($driverMessage, 'uq_review_booking')
            ) {
                throw new HttpException(409, 'คำขอนี้ได้รับการรีวิวแล้ว', 'REVIEW_EXISTS');
            }
            throw $error;
        }
        Http::json([
            'bookingId' => $bookingId,
            'rating' => $rating,
            'comment' => $comment,
            'status' => 'published',
        ], 201);
    }

    public function expireAwaitingPaymentsForScheduler(): int
    {
        return count($this->expireAwaitingPayments());
    }

    private function expireAwaitingPayments(?int $slotId = null): array
    {
        $notificationIds = [];
        $expired = $this->database->transaction(
            function (PDO $pdo) use ($slotId, &$notificationIds): array {
                return $this->expireAwaitingPaymentsInTransaction($pdo, $slotId, $notificationIds);
            }
        );
        $this->notifications->deliverByIds($notificationIds);
        return $expired;
    }

    private function expireAwaitingPaymentsInTransaction(
        PDO $pdo,
        ?int $slotId = null,
        ?array &$notificationIds = null
    ): array
    {
        $sql = 'SELECT id, public_id, availability_slot_id
                FROM bookings
                WHERE status = "awaiting_payment"
                  AND payment_deadline_at <= UTC_TIMESTAMP()';
        $params = [];
        if ($slotId !== null) {
            $sql .= ' AND availability_slot_id = ?';
            $params[] = $slotId;
        }
        $sql .= ' ORDER BY id FOR UPDATE';

        $expired = $this->database->fetchAll($sql, $params);

        foreach ($expired as $booking) {
            $pdo->prepare('UPDATE bookings SET status = "expired", updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$booking['id']]);
            $this->checkoutsToExpire = [...$this->checkoutsToExpire, ...$this->closePendingCheckoutsInTransaction($pdo, (int) $booking['id'])];
            $this->setBookingSlotsState($pdo, (int) $booking['id'], $booking['availability_slot_id'], 'available');
            $this->history($pdo, $booking['id'], 'awaiting_payment', 'expired', null, 'หมดเวลาชำระเงิน');
            $createdIds = $this->notifications->recordEvent(
                $pdo,
                NotificationRules::BOOKING_EXPIRED,
                $this->bookingNotificationContext($pdo, (int) $booking['id'], 'awaiting_payment', 'expired')
            );
            if ($notificationIds !== null) {
                $notificationIds = array_merge($notificationIds, $createdIds);
            }
        }

        return $expired;
    }

    private function setBookingSlotsState(PDO $pdo, int $bookingId, mixed $fallbackSlotId, string $state): void
    {
        $pdo->prepare(
            'UPDATE availability_slots s
             JOIN booking_sessions bs ON bs.availability_slot_id = s.id
             SET s.state = ?
             WHERE bs.booking_id = ?'
        )->execute([$state, $bookingId]);
        if ($fallbackSlotId !== null) {
            $pdo->prepare('UPDATE availability_slots SET state = ? WHERE id = ?')
                ->execute([$state, $fallbackSlotId]);
        }
    }

    private function bookingNotificationContext(
        PDO $pdo,
        int $bookingId,
        string $previousStatus,
        string $nextStatus,
        string $reviewNote = ''
    ): array {
        $booking = $this->database->fetchOne(
            'SELECT b.id, b.public_id, b.member_user_id, tp.user_id AS trainer_user_id,
                    member.display_name AS member_name, trainer.display_name AS trainer_name,
                    b.starts_at, b.ends_at, b.confirmed_starts_at, b.confirmed_ends_at, b.quoted_price
             FROM bookings b
             JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
             JOIN users member ON member.id = b.member_user_id
             JOIN users trainer ON trainer.id = tp.user_id
             WHERE b.id = ?',
            [$bookingId]
        );
        if (!$booking) {
            throw new LogicException('Notification booking context is missing.');
        }
        return [
            'bookingId' => (int) $booking['id'],
            'bookingPublicId' => (string) $booking['public_id'],
            'memberUserId' => (int) $booking['member_user_id'],
            'trainerUserId' => (int) $booking['trainer_user_id'],
            'memberName' => (string) $booking['member_name'],
            'trainerName' => (string) $booking['trainer_name'],
            'startsAt' => (string) $booking['starts_at'],
            'endsAt' => (string) $booking['ends_at'],
            'confirmedStartsAt' => $booking['confirmed_starts_at'] === null ? '' : (string) $booking['confirmed_starts_at'],
            'confirmedEndsAt' => $booking['confirmed_ends_at'] === null ? '' : (string) $booking['confirmed_ends_at'],
            'quotedPrice' => $booking['quoted_price'] === null ? null : (float) $booking['quoted_price'],
            'previousStatus' => $previousStatus,
            'nextStatus' => $nextStatus,
            'reviewNote' => $reviewNote,
        ];
    }

    private function history(PDO $pdo, mixed $bookingId, ?string $from, string $to, mixed $byUserId, string $note): void
    {
        $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, ?, ?, ?, ?)')
            ->execute([$bookingId, $from, $to, $byUserId, $note]);
    }

    private function bookingPayload(array $row, string $role, array $sessions = []): array
    {
        $acceptedStatuses = ['awaiting_payment', 'payment_review', 'confirmed'];
        $cancellableByTrainer = ['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed'];
        $isMember = $role === 'member';
        $isTrainer = $role === 'trainer';
        $hasReview = $row['review_id'] !== null;
        // Completion runs on the trainer-confirmed end once one exists.
        $appointmentEndsAt = $row['confirmed_ends_at'] ?? $row['ends_at'];
        $appointmentEnded = strtotime($appointmentEndsAt . ' UTC') <= time();
        $periodExpired = ($row['period_end'] ?? null) !== null && strtotime($row['period_end'] . ' UTC') < time();
        // Reads never expire rows: the scheduler and the write paths own that.
        // A hold whose deadline has passed is reported as expired here so the
        // member, trainer and administrator surfaces stay truthful in between.
        $deadlinePassed = $row['payment_deadline_at'] !== null
            && strtotime($row['payment_deadline_at'] . ' UTC') <= time();
        $status = $row['status'] === 'awaiting_payment' && $deadlinePassed ? 'expired' : $row['status'];

        return [
            'id' => $row['public_id'],
            'trainer' => [
                'id' => (int) $row['trainer_id'],
                'displayName' => $row['trainer_name'],
                'slug' => $row['slug'],
                'imageUrl' => self::accountImageUrl('trainer', (int) $row['trainer_user_id'], $row['trainer_image_path'] ?? null),
            ],
            'member' => [
                'displayName' => $row['member_name'],
                'imageUrl' => self::accountImageUrl('member', (int) $row['member_user_id'], $row['member_image_path'] ?? null),
                'goals' => $row['member_goals'] ?? '',
                'experienceLevel' => $row['member_experience_level'] ?? '',
                'weight' => isset($row['member_weight']) && $row['member_weight'] !== null ? (float) $row['member_weight'] : null,
                'height' => isset($row['member_height']) && $row['member_height'] !== null ? (float) $row['member_height'] : null,
                'medicalNote' => $row['member_medical_note'] ?? '',
            ],
            'startsAt' => $this->iso($row['starts_at']), 'endsAt' => $this->iso($row['ends_at']),
            'confirmedStartsAt' => ($row['confirmed_starts_at'] ?? null) === null ? null : $this->iso($row['confirmed_starts_at']),
            'confirmedEndsAt' => ($row['confirmed_ends_at'] ?? null) === null ? null : $this->iso($row['confirmed_ends_at']),
            'requestedStartsAt' => $this->iso($row['starts_at']),
            'cancellationReason' => $row['cancellation_reason'] ?? null,
            'bookingType' => $row['booking_type'] ?? 'single',
            'sessionCount' => (int) ($row['session_count'] ?? 1),
            'periodStart' => ($row['period_start'] ?? null) === null ? null : $this->iso($row['period_start']),
            'periodEnd' => ($row['period_end'] ?? null) === null ? null : $this->iso($row['period_end']),
            'sessions' => $sessions !== [] ? $sessions : [[
                'id' => 0,
                'startsAt' => $this->iso($row['starts_at']),
                'endsAt' => $this->iso($row['ends_at']),
            ]],
            'note' => $row['member_note'] ?? '',
            'status' => $status, 'paymentStatus' => $row['payment_status'], 'createdAt' => $this->iso($row['created_at']),
            'paymentDeadlineAt' => $row['payment_deadline_at'] === null ? null : $this->iso($row['payment_deadline_at']),
            'paymentServiceMode' => $row['payment_service_mode'] ?? null,
            'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
            // The exact amount to transfer, satang included.
            'transferAmount' => ($row['transfer_amount'] ?? null) === null ? null : (float) $row['transfer_amount'],
            'chatRoomId' => $role === 'admin' || $row['chat_room_id'] === null ? null : (int) $row['chat_room_id'],
            'payment' => $row['payment_id'] === null ? null : [
                'id' => (int) $row['payment_id'],
                'amount' => $row['payment_amount'] === null ? null : (float) $row['payment_amount'],
                'status' => $row['payment_record_status'],
                'reviewNote' => $row['payment_review_note'],
                'submittedAt' => $this->iso($row['payment_submitted_at']),
            ],
            'review' => !$hasReview ? null : [
                'rating' => (int) $row['review_rating'],
                'comment' => $row['review_comment'],
                'status' => $row['review_status'],
                'createdAt' => $this->iso($row['review_created_at']),
            ],
            'actions' => [
                'canPay' => $isMember
                    && $status === 'awaiting_payment'
                    && $row['payment_deadline_at'] !== null
                    && strtotime($row['payment_deadline_at'] . ' UTC') > time(),
                'canReadChat' => $role !== 'admin' && $status !== 'completed',
                'canSendChat' => $role !== 'admin' && in_array($status, $acceptedStatuses, true),
                'canComplete' => $isTrainer && $status === 'confirmed' && $row['payment_status'] === 'approved'
                    && $appointmentEnded
                    && (($row['booking_type'] ?? 'single') !== 'monthly'
                        || count($sessions) >= (int) ($row['session_count'] ?? 1)
                        || $periodExpired),
                'canReview' => $isMember && $status === 'completed' && !$hasReview,
                'canScheduleSession' => $isMember && ($row['booking_type'] ?? 'single') === 'monthly'
                    && $status === 'confirmed' && $row['payment_status'] === 'approved'
                    && count($sessions) < (int) ($row['session_count'] ?? 1)
                    && ($row['period_end'] ?? null) !== null && strtotime($row['period_end'] . ' UTC') > time(),
                // Mirrors WorkflowRules::assertMemberCancellation: a request may
                // be withdrawn while it waits for the trainer, and an accepted
                // one until a slip is submitted and while its window is open.
                'canCancel' => $isMember && (
                    $status === 'pending_trainer'
                    || ($status === 'awaiting_payment'
                        && in_array($row['payment_status'], ['not_submitted', 'rejected'], true)
                        && $row['payment_deadline_at'] !== null
                        && strtotime($row['payment_deadline_at'] . ' UTC') > time())
                ),
                'canAccept' => $isTrainer && $status === 'pending_trainer',
                'canReject' => $isTrainer && $status === 'pending_trainer',
                'canCancelBooking' => $isTrainer && in_array($status, $cancellableByTrainer, true),
            ],
            'demo' => (bool) $row['is_demo'],
        ];
    }
}
