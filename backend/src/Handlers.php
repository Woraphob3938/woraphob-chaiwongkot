<?php
declare(strict_types=1);

final class Handlers
{
    private Auth $auth;

    public function __construct(
        private readonly Database $database,
        private readonly array $config
    ) {
        $this->auth = new Auth($database);
    }

    public function health(): never
    {
        $this->database->fetchOne('SELECT 1 AS ok');
        Http::json([
            'status' => 'ok',
            'service' => 'fitconnect-api',
            'database' => 'connected',
            'time' => gmdate('c'),
        ]);
    }

    public function trainingTypes(): never
    {
        $rows = $this->database->fetchAll('SELECT id, slug, name_th FROM training_types WHERE active = 1 ORDER BY sort_order, name_th');
        Http::json(array_map(fn(array $row): array => [
            'id' => (int) $row['id'],
            'slug' => $row['slug'],
            'nameTh' => $row['name_th'],
        ], $rows));
    }

    public function trainers(): never
    {
        $this->expireAwaitingPayments();
        $rows = $this->database->fetchAll(
            'SELECT tp.id, tp.slug, tp.headline, tp.bio, tp.years_experience, tp.service_mode,
                    tp.gym_name, tp.price_from, tp.approval_status, tp.image_path, tp.is_demo,
                    u.display_name,
                    AVG(r.rating) AS rating, COUNT(r.id) AS review_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN reviews r ON r.trainer_profile_id = tp.id AND r.status = "published"
             WHERE tp.approval_status = "approved" AND u.status = "active"
             GROUP BY tp.id
             ORDER BY tp.is_demo ASC, tp.updated_at DESC'
        );
        Http::json(array_map(fn(array $row): array => $this->trainerPayload($row), $rows), 200, ['count' => count($rows)]);
    }

    public function trainer(string $slug): never
    {
        $this->expireAwaitingPayments();
        $row = $this->trainerRow('tp.slug = ? AND u.status = "active"', [$slug]);
        if (!$row || $row['approval_status'] !== 'approved') {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        Http::json($this->trainerPayload($row));
    }

    public function updateTrainerMe(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $input = Http::body();
        Http::requireFields($input, ['priceFrom']);
        $price = WorkflowRules::normalizeMoney($input['priceFrom'] ?? null, 'priceFrom');
        $this->database->prepare('UPDATE trainer_profiles SET price_from = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?')
            ->execute([$price, $user['id']]);
        $this->trainerMe();
    }

    public function trainerMe(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $this->expireAwaitingPayments();
        $profile = $this->database->fetchOne(
            'SELECT id, slug, approval_status, approval_note FROM trainer_profiles WHERE user_id = ?',
            [$user['id']]
        );
        if (!$profile) {
            Http::json(['profile' => null, 'certificates' => [], 'slots' => []]);
        }

        $profileId = (int) $profile['id'];
        $certificates = $this->database->fetchAll(
            'SELECT id, name, issuer, issued_year, status
             FROM trainer_certificates WHERE trainer_profile_id = ? ORDER BY id DESC',
            [$profileId]
        );
        $slots = $this->database->fetchAll(
            'SELECT id, starts_at, ends_at, state
             FROM availability_slots
             WHERE trainer_profile_id = ? AND starts_at >= UTC_TIMESTAMP()
             ORDER BY starts_at LIMIT 100',
            [$profileId]
        );

        Http::json([
            'profile' => [
                'id' => $profileId,
                'slug' => $profile['slug'],
                'displayName' => $user['displayName'],
                'approvalStatus' => $profile['approval_status'],
                'approvalNote' => $profile['approval_note'],
            ],
            'certificates' => array_map(fn(array $item): array => [
                'id' => (int) $item['id'],
                'name' => $item['name'],
                'issuer' => $item['issuer'],
                'issuedYear' => $item['issued_year'] === null ? null : (int) $item['issued_year'],
                'status' => $item['status'],
            ], $certificates),
            'slots' => array_map(fn(array $slot): array => [
                'id' => (int) $slot['id'],
                'startsAt' => $this->iso($slot['starts_at']),
                'endsAt' => $this->iso($slot['ends_at']),
                'state' => $slot['state'],
            ], $slots),
        ]);
    }

    public function createAvailabilitySlot(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $input = Http::body();
        Http::requireFields($input, ['startsAt', 'endsAt']);
        $startsAt = WorkflowRules::parseUtc((string) $input['startsAt'], 'startsAt');
        $endsAt = WorkflowRules::parseUtc((string) $input['endsAt'], 'endsAt');
        WorkflowRules::assertAvailabilityWindow(
            new DateTimeImmutable('now', new DateTimeZone('UTC')),
            $startsAt,
            $endsAt
        );

        $slot = $this->database->transaction(function (PDO $pdo) use ($user, $startsAt, $endsAt): array {
            $profileStatement = $pdo->prepare(
                'SELECT id, approval_status FROM trainer_profiles WHERE user_id = ? FOR UPDATE'
            );
            $profileStatement->execute([$user['id']]);
            $profile = $profileStatement->fetch();
            if (!$profile || $profile['approval_status'] !== 'approved') {
                throw new HttpException(
                    403,
                    'เทรนเนอร์ต้องได้รับการอนุมัติก่อนสร้างตาราง',
                    'TRAINER_NOT_APPROVED'
                );
            }

            $overlap = $pdo->prepare(
                'SELECT id FROM availability_slots
                 WHERE trainer_profile_id = ? AND starts_at < ? AND ends_at > ?
                 LIMIT 1'
            );
            $overlap->execute([
                (int) $profile['id'],
                $endsAt->format('Y-m-d H:i:s'),
                $startsAt->format('Y-m-d H:i:s'),
            ]);
            if ($overlap->fetch()) {
                throw new HttpException(409, 'ช่วงเวลานี้ทับกับตารางที่มีอยู่', 'SLOT_OVERLAP');
            }

            $insert = $pdo->prepare(
                'INSERT INTO availability_slots (trainer_profile_id, starts_at, ends_at, state)
                 VALUES (?, ?, ?, "available")'
            );
            $insert->execute([
                (int) $profile['id'],
                $startsAt->format('Y-m-d H:i:s'),
                $endsAt->format('Y-m-d H:i:s'),
            ]);
            return [
                'id' => (int) $pdo->lastInsertId(),
                'startsAt' => $startsAt->format('Y-m-d\TH:i:s.000\Z'),
                'endsAt' => $endsAt->format('Y-m-d\TH:i:s.000\Z'),
                'state' => 'available',
            ];
        });

        Http::json($slot, 201);
    }

    public function deleteAvailabilitySlot(string $slotId): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $this->database->transaction(function (PDO $pdo) use ($slotId, $user): void {
            $statement = $pdo->prepare(
                'SELECT s.id, s.starts_at, s.state, tp.approval_status
                 FROM availability_slots s
                 JOIN trainer_profiles tp ON tp.id = s.trainer_profile_id
                 WHERE s.id = ? AND tp.user_id = ? FOR UPDATE'
            );
            $statement->execute([(int) $slotId, $user['id']]);
            $slot = $statement->fetch();
            if (!$slot) {
                throw new HttpException(404, 'ไม่พบช่วงเวลาว่าง', 'SLOT_NOT_FOUND');
            }
            if ($slot['approval_status'] !== 'approved') {
                throw new HttpException(403, 'เทรนเนอร์ยังไม่ได้รับการอนุมัติ', 'TRAINER_NOT_APPROVED');
            }
            if ($slot['state'] !== 'available' || strtotime($slot['starts_at'] . ' UTC') <= time()) {
                throw new HttpException(
                    409,
                    'ลบได้เฉพาะช่วงเวลาในอนาคตที่ยังว่าง',
                    'SLOT_NOT_DELETABLE'
                );
            }
            $pdo->prepare('DELETE FROM availability_slots WHERE id = ?')->execute([(int) $slot['id']]);
        });

        Http::json(['id' => (int) $slotId, 'deleted' => true]);
    }

    public function register(): never
    {
        Http::json($this->auth->register(Http::body()), 201);
    }

    public function login(): never
    {
        Http::json($this->auth->login(Http::body()));
    }

    public function me(): never
    {
        Http::json($this->auth->requireUser());
    }

    public function trainerApplication(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $input = Http::body();
        Http::requireFields($input, ['legalName', 'phone', 'serviceMode', 'trainingTypeId', 'experience']);
        if (!in_array($input['serviceMode'], ['freelance', 'gym', 'both'], true)) {
            throw new HttpException(422, 'รูปแบบการทำงานไม่ถูกต้อง', 'VALIDATION_FAILED', ['serviceMode' => 'เลือกค่าที่กำหนด']);
        }
        $type = $this->database->fetchOne('SELECT id FROM training_types WHERE id = ? AND active = 1', [(int) $input['trainingTypeId']]);
        if (!$type) {
            throw new HttpException(422, 'ประเภทการฝึกไม่ถูกต้อง', 'VALIDATION_FAILED');
        }
        $certificate = $this->saveUpload('certificate', ['application/pdf'], 8 * 1024 * 1024, 'certificates');

        try {
            $profileId = $this->database->transaction(function (PDO $pdo) use ($user, $input, $certificate): int {
                $existing = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ?', [$user['id']]);
                if ($existing) {
                    $profileId = (int) $existing['id'];
                    $pdo->prepare(
                        'UPDATE trainer_profiles SET legal_name = ?, phone = ?, service_mode = ?, bio = ?, approval_status = "pending", updated_at = UTC_TIMESTAMP() WHERE id = ?'
                    )->execute([
                        trim((string) $input['legalName']), trim((string) $input['phone']),
                        $input['serviceMode'], trim((string) $input['experience']), $profileId,
                    ]);
                } else {
                    $pdo->prepare(
                        'INSERT INTO trainer_profiles (user_id, slug, legal_name, phone, service_mode, bio, approval_status)
                         VALUES (?, ?, ?, ?, ?, ?, "pending")'
                    )->execute([
                        $user['id'], 'trainer-' . $user['id'], trim((string) $input['legalName']),
                        trim((string) $input['phone']), $input['serviceMode'], trim((string) $input['experience']),
                    ]);
                    $profileId = (int) $pdo->lastInsertId();
                }

                $pdo->prepare('DELETE FROM trainer_training_types WHERE trainer_profile_id = ?')->execute([$profileId]);
                $pdo->prepare('INSERT INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES (?, ?)')
                    ->execute([$profileId, (int) $input['trainingTypeId']]);
                $pdo->prepare(
                    'INSERT INTO trainer_certificates (trainer_profile_id, name, issuer, file_path, mime_type, status)
                     VALUES (?, "เอกสารใบรับรองจากผู้สมัคร", "รอระบุ", ?, ?, "pending")'
                )->execute([$profileId, $certificate['path'], $certificate['mime']]);
                return $profileId;
            });
        } catch (Throwable $error) {
            $this->removeUpload($certificate['path']);
            throw $error;
        }

        Http::json(['trainerProfileId' => $profileId, 'status' => 'pending', 'message' => 'ส่งใบสมัครให้แอดมินตรวจแล้ว'], 201);
    }

    public function listBookings(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
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
            'SELECT b.public_id, b.starts_at, b.ends_at, b.member_note,
                    b.status, b.payment_status, b.payment_deadline_at, b.quoted_price, b.created_at, b.is_demo,
                    tp.id AS trainer_id, tp.slug,
                    trainer_user.display_name AS trainer_name,
                    member_user.display_name AS member_name,
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
        Http::json(array_map(
            fn(array $row): array => $this->bookingPayload($row, (string) $user['role']),
            $rows
        ));
    }

    public function createBooking(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['trainerId', 'slotId']);
        $publicId = 'BK-' . strtoupper(bin2hex(random_bytes(4)));

        $booking = $this->database->transaction(function (PDO $pdo) use ($user, $input, $publicId): array {
            $this->expireAwaitingPaymentsInTransaction($pdo, (int) $input['slotId']);
            $statement = $pdo->prepare(
                'SELECT s.id, s.trainer_profile_id, s.starts_at, s.ends_at, s.state,
                        tp.approval_status, tp.price_from, trainer_user.status AS trainer_user_status
                 FROM availability_slots s
                 JOIN trainer_profiles tp ON tp.id = s.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 WHERE s.id = ? AND s.trainer_profile_id = ? FOR UPDATE'
            );
            $statement->execute([(int) $input['slotId'], (int) $input['trainerId']]);
            $slot = $statement->fetch();
            if (
                !$slot
                || $slot['state'] !== 'available'
                || $slot['approval_status'] !== 'approved'
                || $slot['trainer_user_status'] !== 'active'
                || strtotime($slot['starts_at'] . ' UTC') <= time()
            ) {
                throw new HttpException(409, 'ช่วงเวลานี้ไม่พร้อมจองแล้ว', 'SLOT_UNAVAILABLE');
            }
            if ($slot['price_from'] === null || (float) $slot['price_from'] <= 0) {
                throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้กำหนดค่าฝึก', 'TRAINER_PRICE_UNAVAILABLE');
            }
            $insert = $pdo->prepare(
                'INSERT INTO bookings
                 (public_id, member_user_id, trainer_profile_id, availability_slot_id,
                  starts_at, ends_at, member_note, quoted_price, status, payment_status,
                  payment_deadline_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, "awaiting_payment", "not_submitted",
                         DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))'
            );
            $insert->execute([
                $publicId, $user['id'], (int) $input['trainerId'], (int) $input['slotId'], $slot['starts_at'], $slot['ends_at'],
                trim((string) ($input['note'] ?? '')), $slot['price_from'],
            ]);
            $bookingId = (int) $pdo->lastInsertId();
            $pdo->prepare('UPDATE availability_slots SET state = "held" WHERE id = ?')->execute([(int) $input['slotId']]);
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, NULL, "awaiting_payment", ?, "สมาชิกจองและเริ่มช่วงชำระเงิน 10 นาที")')
                ->execute([$bookingId, $user['id']]);
            $pdo->prepare('INSERT INTO chat_rooms (booking_id) VALUES (?)')->execute([$bookingId]);
            $created = $pdo->prepare('SELECT payment_deadline_at FROM bookings WHERE id = ?');
            $created->execute([$bookingId]);
            $createdBooking = $created->fetch();
            return [
                'id' => $publicId,
                'status' => 'awaiting_payment',
                'quotedPrice' => (float) $slot['price_from'],
                'paymentDeadlineAt' => $this->iso($createdBooking['payment_deadline_at']),
            ];
        });

        Http::json($booking, 201);
    }

    public function updateBookingStatus(string $publicId): never
    {
        $user = $this->auth->requireUser(['trainer', 'admin']);
        $input = Http::body();
        Http::requireFields($input, ['status']);

        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $input, $user): array {
            $statement = $pdo->prepare(
                'SELECT b.id, b.status, b.payment_status, b.quoted_price, b.ends_at,
                        b.availability_slot_id, tp.user_id AS trainer_user_id
                 FROM bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id WHERE b.public_id = ? FOR UPDATE'
            );
            $statement->execute([$publicId]);
            $booking = $statement->fetch();
            if (!$booking) {
                throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
            }
            $newStatus = (string) $input['status'];
            if ($user['role'] === 'trainer') {
                if ((int) $booking['trainer_user_id'] !== (int) $user['id']) {
                    throw new HttpException(403, 'ไม่มีสิทธิ์แก้ไขคำขอนี้', 'FORBIDDEN');
                }
                if ($newStatus !== 'completed') {
                    throw new HttpException(409, 'เทรนเนอร์เปลี่ยนได้เฉพาะงานที่ฝึกเสร็จแล้ว', 'INVALID_BOOKING_TRANSITION');
                }
                WorkflowRules::assertTrainerCompletion(
                    (string) $booking['status'],
                    (string) $booking['payment_status'],
                    new DateTimeImmutable((string) $booking['ends_at'], new DateTimeZone('UTC')),
                    new DateTimeImmutable('now', new DateTimeZone('UTC'))
                );
                $slotState = 'booked';
            } else {
                $adminTransitions = [
                    'awaiting_payment' => ['cancelled'],
                    'payment_review' => ['confirmed', 'cancelled'],
                    'confirmed' => ['cancelled'],
                ];
                if (!in_array($newStatus, $adminTransitions[$booking['status']] ?? [], true)) {
                    throw new HttpException(
                        409,
                        'ไม่สามารถเปลี่ยนจากสถานะปัจจุบันไปสถานะนี้',
                        'INVALID_BOOKING_TRANSITION'
                    );
                }
                $slotState = $newStatus === 'confirmed'
                    ? 'booked'
                    : ($newStatus === 'cancelled' ? 'available' : null);
            }

            $pdo->prepare('UPDATE bookings SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$newStatus, $booking['id']]);
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, ?, ?, ?, ?)')
                ->execute([$booking['id'], $booking['status'], $newStatus, $user['id'], trim((string) ($input['note'] ?? ''))]);
            if ($slotState !== null && $booking['availability_slot_id'] !== null) {
                $pdo->prepare('UPDATE availability_slots SET state = ? WHERE id = ?')
                    ->execute([$slotState, $booking['availability_slot_id']]);
            }
            return [
                'id' => $publicId,
                'status' => $newStatus,
                'quotedPrice' => $booking['quoted_price'] === null ? null : (float) $booking['quoted_price'],
            ];
        });
        Http::json($result);
    }

    public function payment(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId', 'amount']);
        $amount = WorkflowRules::normalizeMoney($input['amount'], 'amount');
        $file = $this->saveUpload(
            'slip',
            ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
            5 * 1024 * 1024,
            'payments'
        );

        try {
            $result = $this->database->transaction(function (PDO $pdo) use ($input, $user, $amount, $file): array {
                $statement = $pdo->prepare(
                    'SELECT id, status, availability_slot_id, payment_deadline_at,
                            UTC_TIMESTAMP() AS database_now
                     FROM bookings
                     WHERE public_id = ? AND member_user_id = ? FOR UPDATE'
                );
                $statement->execute([(string) $input['bookingId'], $user['id']]);
                $booking = $statement->fetch();
                if (!$booking) {
                    throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
                }
                if ($booking['status'] !== 'awaiting_payment') {
                    throw new HttpException(409, 'คำขอนี้ยังไม่อยู่ในขั้นส่งหลักฐานการชำระ', 'PAYMENT_NOT_READY');
                }
                if ($booking['payment_deadline_at'] === null) {
                    throw new HttpException(409, 'คำขอนี้ไม่มีช่วงเวลาส่งหลักฐาน', 'PAYMENT_NOT_READY');
                }
                $deadline = new DateTimeImmutable((string) $booking['payment_deadline_at'], new DateTimeZone('UTC'));
                $databaseNow = new DateTimeImmutable((string) $booking['database_now'], new DateTimeZone('UTC'));
                if (WorkflowRules::isPaymentDeadlineExpired($deadline, $databaseNow)) {
                    $slotId = $booking['availability_slot_id'] === null ? null : (int) $booking['availability_slot_id'];
                    $this->expireAwaitingPaymentsInTransaction($pdo, $slotId);
                    return ['expired' => true, 'paymentId' => null];
                }

                $pdo->prepare(
                    'INSERT INTO payments (booking_id, submitted_by_user_id, amount, slip_path, mime_type, status, submitted_at)
                     VALUES (?, ?, ?, ?, ?, "reviewing", UTC_TIMESTAMP())'
                )->execute([$booking['id'], $user['id'], $amount, $file['path'], $file['mime']]);
                $paymentId = (int) $pdo->lastInsertId();
                $pdo->prepare('UPDATE bookings SET status = "payment_review", payment_status = "reviewing", payment_deadline_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$booking['id']]);
                $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, "awaiting_payment", "payment_review", ?, "สมาชิกอัปโหลดสลิป")')
                    ->execute([$booking['id'], $user['id']]);
                return ['expired' => false, 'paymentId' => $paymentId];
            });
        } catch (Throwable $error) {
            $this->removeUpload($file['path']);
            throw $error;
        }
        if ($result['expired']) {
            $this->removeUpload($file['path']);
            throw new HttpException(409, 'หมดเวลาส่งหลักฐาน กรุณาเลือกเวลาใหม่', 'PAYMENT_DEADLINE_EXPIRED');
        }
        Http::json(['paymentId' => $result['paymentId'], 'bookingId' => $input['bookingId'], 'status' => 'reviewing', 'message' => 'ส่งสลิปให้แอดมินตรวจแล้ว'], 201);
    }

    public function messages(string $roomId): never
    {
        $user = $this->auth->requireUser();
        $this->expireAwaitingPayments();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $rawAfterId = $_GET['afterId'] ?? '0';
        if (is_array($rawAfterId) || preg_match('/^\d+$/', (string) $rawAfterId) !== 1) {
            throw new HttpException(422, 'ตัวชี้ข้อความไม่ถูกต้อง', 'VALIDATION_FAILED', ['afterId' => 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป']);
        }
        $afterId = filter_var((string) $rawAfterId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($afterId === false) {
            throw new HttpException(422, 'ตัวชี้ข้อความไม่ถูกต้อง', 'VALIDATION_FAILED', ['afterId' => 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป']);
        }

        $rows = $this->database->transaction(function (PDO $pdo) use ($room, $afterId, $user): array {
            $page = $pdo->prepare(
                'SELECT m.id, m.message_text, m.attachment_path, m.attachment_mime, m.attachment_name,
                        m.attachment_size, m.read_at, m.created_at, u.id AS sender_id, u.display_name
                 FROM messages m JOIN users u ON u.id = m.sender_user_id
                 WHERE m.chat_room_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 500 FOR UPDATE'
            );
            $page->execute([$room['id'], $afterId]);
            $selectedRows = $page->fetchAll();
            if ($selectedRows === []) {
                return [];
            }

            $maxId = (int) $selectedRows[count($selectedRows) - 1]['id'];
            $markRead = $pdo->prepare(
                'UPDATE messages SET read_at = UTC_TIMESTAMP()
                 WHERE chat_room_id = ? AND id > ? AND id <= ? AND sender_user_id <> ? AND read_at IS NULL'
            );
            $markRead->execute([$room['id'], $afterId, $maxId, $user['id']]);

            $refreshedPage = $pdo->prepare(
                'SELECT m.id, m.message_text, m.attachment_path, m.attachment_mime, m.attachment_name,
                        m.attachment_size, m.read_at, m.created_at, u.id AS sender_id, u.display_name
                 FROM messages m JOIN users u ON u.id = m.sender_user_id
                 WHERE m.chat_room_id = ? AND m.id > ? AND m.id <= ? ORDER BY m.id ASC'
            );
            $refreshedPage->execute([$room['id'], $afterId, $maxId]);
            return $refreshedPage->fetchAll();
        });
        Http::json(array_map(fn(array $row): array => [
            'id' => (int) $row['id'],
            'message' => $row['message_text'],
            'attachment' => $row['attachment_path'] === null ? null : [
                'name' => $row['attachment_name'],
                'mime' => $row['attachment_mime'],
                'size' => (int) $row['attachment_size'],
                'url' => '/v1/chat-rooms/' . $room['id'] . '/messages/' . $row['id'] . '/attachment',
            ],
            'readAt' => $row['read_at'] === null ? null : $this->iso($row['read_at']),
            'createdAt' => $this->iso($row['created_at']),
            'sender' => ['id' => (int) $row['sender_id'], 'displayName' => $row['display_name']],
        ], $rows));
    }

    public function sendMessage(string $roomId): never
    {
        $user = $this->auth->requireUser();
        $this->expireAwaitingPayments();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        WorkflowRules::assertChatWritable((string) $room['booking_status']);
        $input = Http::body();
        if (array_key_exists('message', $input) && !is_string($input['message'])) {
            throw new HttpException(422, 'รูปแบบข้อความไม่ถูกต้อง', 'VALIDATION_FAILED', ['message' => 'ต้องเป็นข้อความ']);
        }
        $message = trim((string) ($input['message'] ?? ''));
        if (mb_strlen($message) > 4000) {
            throw new HttpException(422, 'ข้อความยาวเกิน 4,000 ตัวอักษร', 'VALIDATION_FAILED');
        }
        $file = $this->saveUpload(
            'attachment',
            ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
            5 * 1024 * 1024,
            'messages',
            false
        );
        if ($message === '' && $file === null) {
            throw new HttpException(422, 'กรุณาพิมพ์ข้อความหรือแนบไฟล์', 'VALIDATION_FAILED');
        }

        try {
            $this->database->execute(
                'INSERT INTO messages
                    (chat_room_id, sender_user_id, message_text, attachment_path, attachment_mime, attachment_name, attachment_size)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    $room['id'],
                    $user['id'],
                    $message,
                    $file['path'] ?? null,
                    $file['mime'] ?? null,
                    $file['name'] ?? null,
                    $file['size'] ?? null,
                ]
            );
        } catch (Throwable $error) {
            if ($file !== null) {
                $this->removeUpload($file['path']);
            }
            throw $error;
        }

        $messageId = (int) $this->database->pdo()->lastInsertId();
        Http::json([
            'id' => $messageId,
            'message' => $message,
            'attachment' => $file === null ? null : [
                'name' => $file['name'],
                'mime' => $file['mime'],
                'size' => $file['size'],
                'url' => '/v1/chat-rooms/' . $room['id'] . '/messages/' . $messageId . '/attachment',
            ],
            'readAt' => null,
            'createdAt' => gmdate('c'),
            'sender' => ['id' => (int) $user['id'], 'displayName' => $user['displayName']],
        ], 201);
    }

    public function chatAttachment(string $roomId, string $messageId): never
    {
        $user = $this->auth->requireUser();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $attachment = $this->database->fetchOne(
            'SELECT attachment_path, attachment_name
             FROM messages WHERE id = ? AND chat_room_id = ? AND attachment_path IS NOT NULL',
            [(int) $messageId, $room['id']]
        );
        if (!$attachment) {
            throw new HttpException(404, 'ไม่พบไฟล์แนบ', 'FILE_NOT_FOUND');
        }

        $uploadRoot = realpath(dirname(__DIR__) . '/uploads');
        $target = realpath(dirname(__DIR__) . '/' . ltrim((string) $attachment['attachment_path'], '/\\'));
        if ($uploadRoot === false || $target === false || !str_starts_with($target, $uploadRoot . DIRECTORY_SEPARATOR) || !is_file($target)) {
            throw new HttpException(404, 'ไม่พบไฟล์แนบ', 'FILE_NOT_FOUND');
        }

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file($target);
        if ($mime === false) {
            throw new HttpException(404, 'ไม่พบไฟล์แนบ', 'FILE_NOT_FOUND');
        }
        $rawName = trim((string) basename((string) $attachment['attachment_name']));
        $safeName = preg_replace('/[^\pL\pN._ -]+/u', '_', $rawName) ?? '';
        $displayName = mb_substr($safeName, 0, 255);
        if ($displayName === '') {
            $displayName = 'attachment';
        }
        $asciiName = preg_replace('/[^A-Za-z0-9._ -]+/', '_', $displayName) ?? '';
        if ($asciiName === '') {
            $asciiName = 'attachment';
        }

        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($target));
        header('Content-Disposition: attachment; filename="' . $asciiName . '"; filename*=UTF-8\'\'' . rawurlencode($displayName));
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: private, no-store');
        readfile($target);
        exit;
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

    public function decideTrainer(string $trainerId, string $decision): never
    {
        $admin = $this->auth->requireUser(['admin']);
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new HttpException(404, 'ไม่พบการทำงานนี้', 'NOT_FOUND');
        }
        $input = Http::body();
        $result = $this->database->transaction(function (PDO $pdo) use ($trainerId, $decision, $input, $admin): array {
            $statement = $pdo->prepare(
                'SELECT id, approval_status FROM trainer_profiles WHERE id = ? FOR UPDATE'
            );
            $statement->execute([(int) $trainerId]);
            $trainer = $statement->fetch();
            if (!$trainer) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
            }

            $note = trim((string) ($input['note'] ?? ''));
            WorkflowRules::assertTrainerApplicationDecision(
                (string) $trainer['approval_status'],
                $decision,
                $note
            );
            $status = $decision === 'approve' ? 'approved' : 'rejected';
            $certificateStatus = $status === 'approved' ? 'verified' : 'rejected';

            $pdo->prepare(
                'UPDATE trainer_profiles
                 SET approval_status = ?, approval_note = ?, reviewed_by_user_id = ?,
                     reviewed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                 WHERE id = ?'
            )->execute([$status, $note, $admin['id'], (int) $trainer['id']]);
            $pdo->prepare(
                'UPDATE trainer_certificates
                 SET status = ?, review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP()
                 WHERE trainer_profile_id = ? AND status = "pending"'
            )->execute([$certificateStatus, $note, $admin['id'], (int) $trainer['id']]);

            return ['trainerId' => (int) $trainer['id'], 'status' => $status];
        });

        Http::json($result);
    }

    public function adminReviewQueue(): never
    {
        $this->auth->requireUser(['admin']);
        $this->expireAwaitingPayments();
        $trainers = $this->database->fetchAll(
            'SELECT tp.id, tp.slug, tp.created_at, tp.is_demo, u.display_name, COUNT(tc.id) AS certificate_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN trainer_certificates tc ON tc.trainer_profile_id = tp.id
             WHERE tp.approval_status = "pending"
             GROUP BY tp.id ORDER BY tp.created_at ASC LIMIT 100'
        );
        $payments = $this->database->fetchAll(
            'SELECT pay.id, pay.submitted_at, pay.amount,
                    b.public_id AS booking_public_id, b.starts_at, b.ends_at, b.quoted_price, b.is_demo,
                    member_user.display_name AS member_name, trainer_user.display_name AS trainer_name
             FROM payments pay
             JOIN bookings b ON b.id = pay.booking_id
             JOIN users member_user ON member_user.id = pay.submitted_by_user_id
             JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
             JOIN users trainer_user ON trainer_user.id = tp.user_id
             WHERE pay.status = "reviewing" ORDER BY pay.submitted_at ASC LIMIT 100'
        );

        $certificatesByTrainer = [];
        if ($trainers !== []) {
            $trainerIds = array_map(fn(array $row): int => (int) $row['id'], $trainers);
            $placeholders = implode(',', array_fill(0, count($trainerIds), '?'));
            $certificates = $this->database->fetchAll(
                'SELECT id, trainer_profile_id, name, issuer, created_at
                 FROM trainer_certificates
                 WHERE trainer_profile_id IN (' . $placeholders . ')
                 ORDER BY created_at ASC, id ASC',
                $trainerIds
            );
            foreach ($certificates as $certificate) {
                $profileId = (int) $certificate['trainer_profile_id'];
                $certificatesByTrainer[$profileId][] = [
                    'id' => (int) $certificate['id'],
                    'name' => $certificate['name'],
                    'issuer' => $certificate['issuer'],
                    'submittedAt' => $this->iso($certificate['created_at']),
                    'fileUrl' => '/v1/admin/files/certificate/' . $certificate['id'],
                ];
            }
        }

        Http::json([
            'trainers' => array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'slug' => $row['slug'],
                'displayName' => $row['display_name'],
                'certificateCount' => (int) $row['certificate_count'],
                'certificates' => $certificatesByTrainer[(int) $row['id']] ?? [],
                'submittedAt' => $this->iso($row['created_at']),
                'demo' => (bool) $row['is_demo'],
            ], $trainers),
            'payments' => array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'bookingId' => $row['booking_public_id'],
                'memberName' => $row['member_name'],
                'trainerName' => $row['trainer_name'],
                'startsAt' => $this->iso($row['starts_at']),
                'endsAt' => $this->iso($row['ends_at']),
                'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                'amount' => $row['amount'] === null ? null : (float) $row['amount'],
                'difference' => $row['amount'] === null || $row['quoted_price'] === null
                    ? null
                    : (float) $row['amount'] - (float) $row['quoted_price'],
                'submittedAt' => $this->iso($row['submitted_at']),
                'fileUrl' => '/v1/admin/files/payment/' . $row['id'],
                'demo' => (bool) $row['is_demo'],
            ], $payments),
        ]);
    }

    public function decidePayment(string $paymentId, string $decision): never
    {
        $admin = $this->auth->requireUser(['admin']);
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new HttpException(404, 'ไม่พบการทำงานนี้', 'NOT_FOUND');
        }
        $input = Http::body();
        $result = $this->database->transaction(function (PDO $pdo) use ($paymentId, $decision, $input, $admin): array {
            $statement = $pdo->prepare(
                'SELECT pay.id, pay.status, pay.booking_id, b.public_id, b.status AS booking_status,
                        b.availability_slot_id, UTC_TIMESTAMP() AS database_now
                 FROM payments pay JOIN bookings b ON b.id = pay.booking_id WHERE pay.id = ? FOR UPDATE'
            );
            $statement->execute([(int) $paymentId]);
            $payment = $statement->fetch();
            if (!$payment) {
                throw new HttpException(404, 'ไม่พบหลักฐานการชำระ', 'PAYMENT_NOT_FOUND');
            }
            $note = trim((string) ($input['note'] ?? ''));
            WorkflowRules::assertPaymentDecision(
                (string) $payment['status'],
                (string) $payment['booking_status'],
                $decision,
                $note
            );
            $paymentStatus = $decision === 'approve' ? 'approved' : 'rejected';
            $paymentDeadline = null;
            if ($decision === 'approve') {
                $bookingStatus = 'confirmed';
                $slotState = 'booked';
            } else {
                $rejectedCount = $pdo->prepare(
                    'SELECT COUNT(*) FROM payments WHERE booking_id = ? AND status = "rejected" AND id <> ?'
                );
                $rejectedCount->execute([$payment['booking_id'], $payment['id']]);
                $transition = WorkflowRules::paymentRejectionTransition(
                    (int) $rejectedCount->fetchColumn(),
                    new DateTimeImmutable((string) $payment['database_now'], new DateTimeZone('UTC'))
                );
                $bookingStatus = $transition['bookingStatus'];
                $slotState = $transition['slotState'];
                $paymentDeadline = $transition['paymentDeadlineAt'];
            }
            $pdo->prepare('UPDATE payments SET status = ?, review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$paymentStatus, $note, $admin['id'], $payment['id']]);
            $pdo->prepare('UPDATE bookings SET status = ?, payment_status = ?, payment_deadline_at = ?, cancellation_reason = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([
                    $bookingStatus,
                    $paymentStatus,
                    $paymentDeadline?->format('Y-m-d H:i:s'),
                    $bookingStatus === 'expired' ? $note : null,
                    $payment['booking_id'],
                ]);
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, ?, ?, ?, ?)')
                ->execute([$payment['booking_id'], $payment['booking_status'], $bookingStatus, $admin['id'], $note]);
            if ($payment['availability_slot_id'] !== null) {
                $pdo->prepare('UPDATE availability_slots SET state = ? WHERE id = ?')
                    ->execute([$slotState, $payment['availability_slot_id']]);
            }
            return [
                'paymentId' => (int) $payment['id'],
                'bookingId' => $payment['public_id'],
                'status' => $paymentStatus,
                'bookingStatus' => $bookingStatus,
                'paymentDeadlineAt' => $paymentDeadline === null ? null : $this->iso($paymentDeadline->format('Y-m-d H:i:s')),
            ];
        });
        Http::json($result);
    }

    public function adminFile(string $kind, string $recordId): never
    {
        $this->auth->requireUser(['admin']);
        if ($kind === 'payment') {
            $record = $this->database->fetchOne('SELECT slip_path AS file_path, mime_type FROM payments WHERE id = ?', [(int) $recordId]);
        } elseif ($kind === 'certificate') {
            $record = $this->database->fetchOne('SELECT file_path, mime_type FROM trainer_certificates WHERE id = ?', [(int) $recordId]);
        } else {
            throw new HttpException(404, 'ไม่พบไฟล์', 'FILE_NOT_FOUND');
        }
        if (!$record) {
            throw new HttpException(404, 'ไม่พบไฟล์', 'FILE_NOT_FOUND');
        }
        $uploadRoot = realpath(dirname(__DIR__) . '/uploads');
        $target = realpath(dirname(__DIR__) . '/' . ltrim((string) $record['file_path'], '/\\'));
        if ($uploadRoot === false || $target === false || !str_starts_with($target, $uploadRoot . DIRECTORY_SEPARATOR) || !is_file($target)) {
            throw new HttpException(404, 'ไม่พบไฟล์', 'FILE_NOT_FOUND');
        }
        header('Content-Type: ' . $record['mime_type']);
        header('Content-Length: ' . filesize($target));
        header('Content-Disposition: inline; filename="fitconnect-' . $kind . '-' . (int) $recordId . '"');
        header('Cache-Control: private, no-store');
        readfile($target);
        exit;
    }

    public function expireAwaitingPaymentsForScheduler(): int
    {
        return count($this->expireAwaitingPayments());
    }

    private function expireAwaitingPayments(?int $slotId = null): array
    {
        return $this->database->transaction(
            fn(PDO $pdo): array => $this->expireAwaitingPaymentsInTransaction($pdo, $slotId)
        );
    }

    private function expireAwaitingPaymentsInTransaction(PDO $pdo, ?int $slotId = null): array
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

        $statement = $pdo->prepare($sql);
        $statement->execute($params);
        $expired = $statement->fetchAll();

        foreach ($expired as $booking) {
            $pdo->prepare('UPDATE bookings SET status = "expired", updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$booking['id']]);
            if ($booking['availability_slot_id'] !== null) {
                $pdo->prepare('UPDATE availability_slots SET state = "available" WHERE id = ? AND state = "held"')
                    ->execute([$booking['availability_slot_id']]);
            }
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, "awaiting_payment", "expired", NULL, "หมดเวลาส่งหลักฐานการชำระ")')
                ->execute([$booking['id']]);
        }

        return $expired;
    }

    private function trainerRow(string $where, array $params): ?array
    {
        return $this->database->fetchOne(
            'SELECT tp.id, tp.slug, tp.headline, tp.bio, tp.years_experience, tp.service_mode,
                    tp.gym_name, tp.price_from, tp.approval_status, tp.image_path, tp.is_demo,
                    u.display_name,
                    AVG(r.rating) AS rating, COUNT(r.id) AS review_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN reviews r ON r.trainer_profile_id = tp.id AND r.status = "published"
             WHERE ' . $where . ' GROUP BY tp.id LIMIT 1',
            $params
        );
    }

    private function trainerPayload(array $row): array
    {
        $profileId = (int) $row['id'];
        $types = $this->database->fetchAll(
            'SELECT tt.id, tt.slug, tt.name_th FROM trainer_training_types ttt JOIN training_types tt ON tt.id = ttt.training_type_id
             WHERE ttt.trainer_profile_id = ? ORDER BY tt.sort_order, tt.name_th',
            [$profileId]
        );
        $certificates = $this->database->fetchAll(
            'SELECT id, name, issuer, issued_year, status FROM trainer_certificates WHERE trainer_profile_id = ? ORDER BY issued_year DESC, id DESC',
            [$profileId]
        );
        $slots = $this->database->fetchAll(
            'SELECT id, starts_at, ends_at, state FROM availability_slots
             WHERE trainer_profile_id = ? AND starts_at >= UTC_TIMESTAMP()
               AND starts_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MONTH)
               AND state = "available"
             ORDER BY starts_at LIMIT 60',
            [$profileId]
        );

        return [
            'id' => $profileId,
            'slug' => $row['slug'],
            'displayName' => $row['display_name'],
            'headline' => $row['headline'] ?? 'เทรนเนอร์ FitConnect',
            'bio' => $row['bio'] ?? '',
            'yearsExperience' => (int) $row['years_experience'],
            'trainingTypes' => array_map(fn(array $type): array => ['id' => (int) $type['id'], 'slug' => $type['slug'], 'nameTh' => $type['name_th']], $types),
            'serviceMode' => $row['service_mode'],
            'gymName' => $row['gym_name'],
            'priceFrom' => $row['price_from'] === null ? null : (float) $row['price_from'],
            'rating' => $row['rating'] === null ? null : round((float) $row['rating'], 1),
            'reviewCount' => (int) $row['review_count'],
            'verification' => $row['approval_status'] === 'approved' ? 'verified' : $row['approval_status'],
            'certificates' => array_map(fn(array $certificate): array => [
                'id' => (int) $certificate['id'], 'name' => $certificate['name'], 'issuer' => $certificate['issuer'],
                'issuedYear' => $certificate['issued_year'] === null ? null : (int) $certificate['issued_year'], 'status' => $certificate['status'],
            ], $certificates),
            'slots' => array_map(fn(array $slot): array => [
                'id' => (int) $slot['id'], 'startsAt' => $this->iso($slot['starts_at']), 'endsAt' => $this->iso($slot['ends_at']),
                'available' => true,
            ], $slots),
            'image' => $row['image_path'],
            'demo' => (bool) $row['is_demo'],
        ];
    }

    private function bookingPayload(array $row, string $role): array
    {
        $acceptedStatuses = ['awaiting_payment', 'payment_review', 'confirmed', 'completed'];
        $isMember = $role === 'member';
        $isTrainer = $role === 'trainer';
        $hasReview = $row['review_id'] !== null;
        $appointmentEnded = strtotime($row['ends_at'] . ' UTC') <= time();

        return [
            'id' => $row['public_id'],
            'trainer' => ['id' => (int) $row['trainer_id'], 'displayName' => $row['trainer_name'], 'slug' => $row['slug']],
            'member' => ['displayName' => $row['member_name']],
            'startsAt' => $this->iso($row['starts_at']), 'endsAt' => $this->iso($row['ends_at']),
            'note' => $row['member_note'] ?? '',
            'status' => $row['status'], 'paymentStatus' => $row['payment_status'], 'createdAt' => $this->iso($row['created_at']),
            'paymentDeadlineAt' => $row['payment_deadline_at'] === null ? null : $this->iso($row['payment_deadline_at']),
            'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
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
                    && $row['status'] === 'awaiting_payment'
                    && $row['payment_deadline_at'] !== null
                    && strtotime($row['payment_deadline_at'] . ' UTC') > time(),
                'canReadChat' => $role !== 'admin',
                'canSendChat' => $role !== 'admin' && in_array($row['status'], $acceptedStatuses, true),
                'canComplete' => $isTrainer && $row['status'] === 'confirmed' && $row['payment_status'] === 'approved' && $appointmentEnded,
                'canReview' => $isMember && $row['status'] === 'completed' && !$hasReview,
            ],
            'demo' => (bool) $row['is_demo'],
        ];
    }

    private function requireChatParticipant(int $roomId, array $user): array
    {
        $room = $this->database->fetchOne(
            'SELECT cr.id, b.status AS booking_status, b.member_user_id, tp.user_id AS trainer_user_id
             FROM chat_rooms cr JOIN bookings b ON b.id = cr.booking_id JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id WHERE cr.id = ?',
            [$roomId]
        );
        if (!$room) {
            throw new HttpException(404, 'ไม่พบห้องสนทนา', 'CHAT_NOT_FOUND');
        }
        $isMember = $user['role'] === 'member' && (int) $user['id'] === (int) $room['member_user_id'];
        $isTrainer = $user['role'] === 'trainer' && (int) $user['id'] === (int) $room['trainer_user_id'];
        if (!$isMember && !$isTrainer) {
            throw new HttpException(403, 'ไม่มีสิทธิ์เปิดห้องสนทนานี้', 'FORBIDDEN');
        }
        return $room;
    }

    private function saveUpload(string $field, array $allowedMimeTypes, int $maxBytes, string $directory, bool $required = true): ?array
    {
        if (!isset($_FILES[$field]) || !is_array($_FILES[$field])) {
            if (!$required) {
                return null;
            }
            throw new HttpException(422, 'กรุณาเลือกไฟล์', 'FILE_REQUIRED', [$field => 'จำเป็นต้องแนบไฟล์']);
        }
        $file = $_FILES[$field];
        $uploadError = (int) ($file['error'] ?? UPLOAD_ERR_NO_FILE);
        if ($uploadError === UPLOAD_ERR_NO_FILE && !$required) {
            return null;
        }
        if (in_array($uploadError, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) {
            throw new HttpException(413, 'ขนาดไฟล์เกินที่กำหนด', 'FILE_TOO_LARGE');
        }
        if ($uploadError !== UPLOAD_ERR_OK) {
            throw new HttpException(422, 'อัปโหลดไฟล์ไม่สำเร็จ', 'UPLOAD_FAILED');
        }
        if ((int) $file['size'] <= 0) {
            throw new HttpException(422, 'อัปโหลดไฟล์ไม่สำเร็จ', 'UPLOAD_FAILED');
        }
        if ((int) $file['size'] > $maxBytes) {
            throw new HttpException(413, 'ขนาดไฟล์เกินที่กำหนด', 'FILE_TOO_LARGE');
        }
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file((string) $file['tmp_name']);
        if ($mime === false || !in_array($mime, $allowedMimeTypes, true)) {
            throw new HttpException(415, 'ประเภทไฟล์ไม่รองรับ', 'INVALID_FILE_TYPE');
        }
        $extensions = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
        $uploadRoot = dirname(__DIR__) . '/uploads/' . $directory;
        if (!is_dir($uploadRoot) && !mkdir($uploadRoot, 0750, true) && !is_dir($uploadRoot)) {
            throw new RuntimeException('สร้างโฟลเดอร์อัปโหลดไม่สำเร็จ');
        }
        $filename = bin2hex(random_bytes(16)) . '.' . $extensions[$mime];
        $target = $uploadRoot . '/' . $filename;
        if (!move_uploaded_file((string) $file['tmp_name'], $target)) {
            throw new RuntimeException('บันทึกไฟล์ไม่สำเร็จ');
        }
        $rawName = trim((string) basename((string) $file['name']));
        $safeName = preg_replace('/[^\pL\pN._ -]+/u', '_', $rawName) ?? '';
        $displayName = mb_substr($safeName, 0, 255);
        return [
            'path' => 'uploads/' . $directory . '/' . $filename,
            'mime' => $mime,
            'name' => $displayName === '' ? 'ไฟล์แนบ' : $displayName,
            'size' => (int) $file['size'],
        ];
    }

    private function removeUpload(string $relativePath): void
    {
        $uploadRoot = realpath(dirname(__DIR__) . '/uploads');
        $target = realpath(dirname(__DIR__) . '/' . ltrim($relativePath, '/\\'));
        if (
            $uploadRoot !== false
            && $target !== false
            && str_starts_with($target, $uploadRoot . DIRECTORY_SEPARATOR)
            && is_file($target)
        ) {
            unlink($target);
        }
    }

    private function iso(string $value): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', strtotime($value . ' UTC'));
    }
}
