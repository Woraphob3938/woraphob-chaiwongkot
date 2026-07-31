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

    public function provinces(): never
    {
        $rows = $this->database->fetchAll('SELECT id, name_th, region FROM provinces WHERE active = 1 ORDER BY name_th');
        Http::json(array_map(fn(array $row): array => [
            'id' => (int) $row['id'],
            'nameTh' => $row['name_th'],
            'region' => $row['region'],
        ], $rows));
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
        $rows = $this->database->fetchAll(
            'SELECT tp.id, tp.slug, tp.headline, tp.bio, tp.years_experience, tp.service_mode,
                    tp.gym_name, tp.price_from, tp.approval_status, tp.image_path, tp.is_demo,
                    u.display_name, p.id AS province_id, p.name_th AS province_name, p.region,
                    AVG(r.rating) AS rating, COUNT(r.id) AS review_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             JOIN provinces p ON p.id = tp.primary_province_id
             LEFT JOIN reviews r ON r.trainer_profile_id = tp.id AND r.status = "published"
             WHERE tp.approval_status = "approved" AND u.status = "active"
             GROUP BY tp.id
             ORDER BY tp.is_demo ASC, tp.updated_at DESC'
        );
        Http::json(array_map(fn(array $row): array => $this->trainerPayload($row), $rows), 200, ['count' => count($rows)]);
    }

    public function trainer(string $slug): never
    {
        $row = $this->trainerRow('tp.slug = ?', [$slug]);
        if (!$row || $row['approval_status'] !== 'approved') {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        Http::json($this->trainerPayload($row));
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
        Http::requireFields($input, ['legalName', 'phone', 'provinceId', 'serviceMode', 'trainingTypeId', 'experience']);
        if (!in_array($input['serviceMode'], ['freelance', 'gym', 'both'], true)) {
            throw new HttpException(422, 'รูปแบบการทำงานไม่ถูกต้อง', 'VALIDATION_FAILED', ['serviceMode' => 'เลือกค่าที่กำหนด']);
        }
        $certificate = $this->saveUpload('certificate', ['application/pdf'], 8 * 1024 * 1024, 'certificates');
        $province = $this->database->fetchOne('SELECT id FROM provinces WHERE id = ? AND active = 1', [(int) $input['provinceId']]);
        $type = $this->database->fetchOne('SELECT id FROM training_types WHERE id = ? AND active = 1', [(int) $input['trainingTypeId']]);
        if (!$province || !$type) {
            throw new HttpException(422, 'จังหวัดหรือประเภทการฝึกไม่ถูกต้อง', 'VALIDATION_FAILED');
        }

        $profileId = $this->database->transaction(function (PDO $pdo) use ($user, $input, $certificate): int {
            $existing = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ?', [$user['id']]);
            if ($existing) {
                $profileId = (int) $existing['id'];
                $statement = $pdo->prepare(
                    'UPDATE trainer_profiles SET legal_name = ?, phone = ?, primary_province_id = ?, service_mode = ?, bio = ?, approval_status = "pending", updated_at = UTC_TIMESTAMP() WHERE id = ?'
                );
                $statement->execute([
                    trim((string) $input['legalName']), trim((string) $input['phone']), (int) $input['provinceId'],
                    $input['serviceMode'], trim((string) $input['experience']), $profileId,
                ]);
            } else {
                $statement = $pdo->prepare(
                    'INSERT INTO trainer_profiles (user_id, slug, legal_name, phone, primary_province_id, service_mode, bio, approval_status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, "pending")'
                );
                $statement->execute([
                    $user['id'], 'trainer-' . $user['id'], trim((string) $input['legalName']), trim((string) $input['phone']),
                    (int) $input['provinceId'], $input['serviceMode'], trim((string) $input['experience']),
                ]);
                $profileId = (int) $pdo->lastInsertId();
            }

            $pdo->prepare('INSERT IGNORE INTO trainer_service_areas (trainer_profile_id, province_id, area_label) VALUES (?, ?, NULL)')
                ->execute([$profileId, (int) $input['provinceId']]);
            $pdo->prepare('INSERT IGNORE INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES (?, ?)')
                ->execute([$profileId, (int) $input['trainingTypeId']]);
            $pdo->prepare(
                'INSERT INTO trainer_certificates (trainer_profile_id, name, issuer, file_path, mime_type, status)
                 VALUES (?, "เอกสารใบรับรองจากผู้สมัคร", "รอระบุ", ?, ?, "pending")'
            )->execute([$profileId, $certificate['path'], $certificate['mime']]);
            return $profileId;
        });

        Http::json(['trainerProfileId' => $profileId, 'status' => 'pending', 'message' => 'ส่งใบสมัครให้แอดมินตรวจแล้ว'], 201);
    }

    public function listBookings(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
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
            'SELECT b.public_id, b.starts_at, b.ends_at, b.location_text, b.status, b.payment_status, b.created_at,
                    b.is_demo, tp.id AS trainer_id, tp.slug, u.display_name
             FROM bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id JOIN users u ON u.id = tp.user_id ' .
             $where . ' ORDER BY b.created_at DESC LIMIT 100',
            $params
        );
        Http::json(array_map(fn(array $row): array => $this->bookingPayload($row), $rows));
    }

    public function createBooking(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['trainerId', 'slotId', 'location']);
        $publicId = 'BK-' . strtoupper(bin2hex(random_bytes(4)));

        $booking = $this->database->transaction(function (PDO $pdo) use ($user, $input, $publicId): array {
            $statement = $pdo->prepare(
                'SELECT s.id, s.trainer_profile_id, s.starts_at, s.ends_at, s.state, tp.approval_status
                 FROM availability_slots s JOIN trainer_profiles tp ON tp.id = s.trainer_profile_id
                 WHERE s.id = ? AND s.trainer_profile_id = ? FOR UPDATE'
            );
            $statement->execute([(int) $input['slotId'], (int) $input['trainerId']]);
            $slot = $statement->fetch();
            if (!$slot || $slot['state'] !== 'available' || $slot['approval_status'] !== 'approved') {
                throw new HttpException(409, 'ช่วงเวลานี้ไม่พร้อมจองแล้ว', 'SLOT_UNAVAILABLE');
            }
            $insert = $pdo->prepare(
                'INSERT INTO bookings (public_id, member_user_id, trainer_profile_id, availability_slot_id, starts_at, ends_at, location_text, member_note, status, payment_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, "pending_trainer", "not_submitted")'
            );
            $insert->execute([
                $publicId, $user['id'], (int) $input['trainerId'], (int) $input['slotId'], $slot['starts_at'], $slot['ends_at'],
                trim((string) $input['location']), trim((string) ($input['note'] ?? '')),
            ]);
            $bookingId = (int) $pdo->lastInsertId();
            $pdo->prepare('UPDATE availability_slots SET state = "held" WHERE id = ?')->execute([(int) $input['slotId']]);
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, NULL, "pending_trainer", ?, "สมาชิกส่งคำขอ")')
                ->execute([$bookingId, $user['id']]);
            $pdo->prepare('INSERT INTO chat_rooms (booking_id) VALUES (?)')->execute([$bookingId]);
            return ['id' => $publicId, 'status' => 'pending_trainer'];
        });

        Http::json($booking, 201);
    }

    public function updateBookingStatus(string $publicId): never
    {
        $user = $this->auth->requireUser(['trainer', 'admin']);
        $input = Http::body();
        Http::requireFields($input, ['status']);
        $allowed = ['awaiting_payment', 'confirmed', 'completed', 'cancelled'];
        if (!in_array($input['status'], $allowed, true)) {
            throw new HttpException(422, 'สถานะการจองไม่ถูกต้อง', 'VALIDATION_FAILED');
        }

        $this->database->transaction(function (PDO $pdo) use ($publicId, $input, $user): void {
            $statement = $pdo->prepare(
                'SELECT b.id, b.status, b.availability_slot_id, tp.user_id AS trainer_user_id
                 FROM bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id WHERE b.public_id = ? FOR UPDATE'
            );
            $statement->execute([$publicId]);
            $booking = $statement->fetch();
            if (!$booking) {
                throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
            }
            if ($user['role'] === 'trainer' && (int) $booking['trainer_user_id'] !== (int) $user['id']) {
                throw new HttpException(403, 'ไม่มีสิทธิ์แก้ไขคำขอนี้', 'FORBIDDEN');
            }
            $newStatus = (string) $input['status'];
            $pdo->prepare('UPDATE bookings SET status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')->execute([$newStatus, $booking['id']]);
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, ?, ?, ?, ?)')
                ->execute([$booking['id'], $booking['status'], $newStatus, $user['id'], trim((string) ($input['note'] ?? ''))]);
            if ($newStatus === 'cancelled') {
                $pdo->prepare('UPDATE availability_slots SET state = "available" WHERE id = ?')->execute([$booking['availability_slot_id']]);
            } elseif ($newStatus === 'confirmed') {
                $pdo->prepare('UPDATE availability_slots SET state = "booked" WHERE id = ?')->execute([$booking['availability_slot_id']]);
            }
        });
        Http::json(['id' => $publicId, 'status' => $input['status']]);
    }

    public function payment(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId']);
        $booking = $this->database->fetchOne(
            'SELECT id, status FROM bookings WHERE public_id = ? AND member_user_id = ?',
            [(string) $input['bookingId'], $user['id']]
        );
        if (!$booking) {
            throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
        }
        if ($booking['status'] !== 'awaiting_payment') {
            throw new HttpException(409, 'คำขอนี้ยังไม่อยู่ในขั้นส่งหลักฐานการชำระ', 'PAYMENT_NOT_READY');
        }
        $file = $this->saveUpload('slip', ['image/jpeg', 'image/png', 'image/webp'], (int) $this->config['upload_max_bytes'], 'payments');
        $this->database->transaction(function (PDO $pdo) use ($booking, $user, $file): void {
            $pdo->prepare(
                'INSERT INTO payments (booking_id, submitted_by_user_id, slip_path, mime_type, status, submitted_at)
                 VALUES (?, ?, ?, ?, "reviewing", UTC_TIMESTAMP())'
            )->execute([$booking['id'], $user['id'], $file['path'], $file['mime']]);
            $pdo->prepare('UPDATE bookings SET status = "payment_review", payment_status = "reviewing", updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$booking['id']]);
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, "awaiting_payment", "payment_review", ?, "สมาชิกอัปโหลดสลิป")')
                ->execute([$booking['id'], $user['id']]);
        });
        Http::json(['bookingId' => $input['bookingId'], 'status' => 'reviewing', 'message' => 'ส่งสลิปให้แอดมินตรวจแล้ว'], 201);
    }

    public function messages(string $roomId): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $rows = $this->database->fetchAll(
            'SELECT m.id, m.message_text, m.attachment_path, m.created_at, u.id AS sender_id, u.display_name
             FROM messages m JOIN users u ON u.id = m.sender_user_id WHERE m.chat_room_id = ? ORDER BY m.id ASC LIMIT 500',
            [$room['id']]
        );
        Http::json(array_map(fn(array $row): array => [
            'id' => (int) $row['id'],
            'message' => $row['message_text'],
            'attachment' => $row['attachment_path'],
            'createdAt' => $this->iso($row['created_at']),
            'sender' => ['id' => (int) $row['sender_id'], 'displayName' => $row['display_name']],
        ], $rows));
    }

    public function sendMessage(string $roomId): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $input = Http::body();
        Http::requireFields($input, ['message']);
        $message = trim((string) $input['message']);
        if (mb_strlen($message) > 4000) {
            throw new HttpException(422, 'ข้อความยาวเกิน 4,000 ตัวอักษร', 'VALIDATION_FAILED');
        }
        $this->database->execute('INSERT INTO messages (chat_room_id, sender_user_id, message_text) VALUES (?, ?, ?)', [$room['id'], $user['id'], $message]);
        Http::json(['id' => (int) $this->database->pdo()->lastInsertId(), 'message' => $message, 'createdAt' => gmdate('c')], 201);
    }

    public function review(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId', 'rating', 'comment']);
        $rating = (int) $input['rating'];
        if ($rating < 1 || $rating > 5) {
            throw new HttpException(422, 'คะแนนต้องอยู่ระหว่าง 1–5', 'VALIDATION_FAILED', ['rating' => 'เลือกคะแนน 1–5']);
        }
        $booking = $this->database->fetchOne(
            'SELECT id, trainer_profile_id FROM bookings WHERE public_id = ? AND member_user_id = ? AND status = "completed"',
            [(string) $input['bookingId'], $user['id']]
        );
        if (!$booking) {
            throw new HttpException(409, 'รีวิวได้หลังการฝึกเสร็จเท่านั้น', 'REVIEW_NOT_READY');
        }
        try {
            $this->database->execute(
                'INSERT INTO reviews (booking_id, member_user_id, trainer_profile_id, rating, comment, status) VALUES (?, ?, ?, ?, ?, "published")',
                [$booking['id'], $user['id'], $booking['trainer_profile_id'], $rating, trim((string) $input['comment'])]
            );
        } catch (PDOException $error) {
            if ((string) $error->getCode() === '23000') {
                throw new HttpException(409, 'คำขอนี้ได้รับการรีวิวแล้ว', 'REVIEW_EXISTS');
            }
            throw $error;
        }
        Http::json(['bookingId' => $input['bookingId'], 'status' => 'published'], 201);
    }

    public function decideTrainer(string $trainerId, string $decision): never
    {
        $admin = $this->auth->requireUser(['admin']);
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new HttpException(404, 'ไม่พบการทำงานนี้', 'NOT_FOUND');
        }
        $status = $decision === 'approve' ? 'approved' : 'rejected';
        $input = Http::body();
        $changed = $this->database->transaction(function (PDO $pdo) use ($trainerId, $status, $input, $admin): int {
            $statement = $pdo->prepare('UPDATE trainer_profiles SET approval_status = ?, approval_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP() WHERE id = ?');
            $statement->execute([$status, trim((string) ($input['note'] ?? '')), $admin['id'], (int) $trainerId]);
            if ($statement->rowCount() > 0) {
                $certificateStatus = $status === 'approved' ? 'verified' : 'rejected';
                $pdo->prepare('UPDATE trainer_certificates SET status = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP() WHERE trainer_profile_id = ? AND status = "pending"')
                    ->execute([$certificateStatus, $admin['id'], (int) $trainerId]);
            }
            return $statement->rowCount();
        });
        if ($changed === 0) {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        Http::json(['trainerId' => (int) $trainerId, 'status' => $status]);
    }

    public function adminReviewQueue(): never
    {
        $this->auth->requireUser(['admin']);
        $trainers = $this->database->fetchAll(
            'SELECT tp.id, tp.slug, tp.created_at, tp.is_demo, u.display_name, p.name_th AS province_name, COUNT(tc.id) AS certificate_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             JOIN provinces p ON p.id = tp.primary_province_id
             LEFT JOIN trainer_certificates tc ON tc.trainer_profile_id = tp.id
             WHERE tp.approval_status = "pending"
             GROUP BY tp.id ORDER BY tp.created_at ASC LIMIT 100'
        );
        $payments = $this->database->fetchAll(
            'SELECT pay.id, pay.submitted_at, pay.amount, b.public_id AS booking_public_id, b.is_demo, u.display_name AS member_name
             FROM payments pay
             JOIN bookings b ON b.id = pay.booking_id
             JOIN users u ON u.id = pay.submitted_by_user_id
             WHERE pay.status = "reviewing" ORDER BY pay.submitted_at ASC LIMIT 100'
        );

        Http::json([
            'trainers' => array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'slug' => $row['slug'],
                'displayName' => $row['display_name'],
                'province' => $row['province_name'],
                'certificateCount' => (int) $row['certificate_count'],
                'submittedAt' => $this->iso($row['created_at']),
                'demo' => (bool) $row['is_demo'],
            ], $trainers),
            'payments' => array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'bookingId' => $row['booking_public_id'],
                'memberName' => $row['member_name'],
                'amount' => $row['amount'] === null ? null : (float) $row['amount'],
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
                'SELECT pay.id, pay.status, pay.booking_id, b.public_id, b.status AS booking_status
                 FROM payments pay JOIN bookings b ON b.id = pay.booking_id WHERE pay.id = ? FOR UPDATE'
            );
            $statement->execute([(int) $paymentId]);
            $payment = $statement->fetch();
            if (!$payment) {
                throw new HttpException(404, 'ไม่พบหลักฐานการชำระ', 'PAYMENT_NOT_FOUND');
            }
            if ($payment['status'] !== 'reviewing') {
                throw new HttpException(409, 'หลักฐานนี้ได้รับการตัดสินแล้ว', 'PAYMENT_ALREADY_REVIEWED');
            }
            $paymentStatus = $decision === 'approve' ? 'approved' : 'rejected';
            $bookingStatus = $decision === 'approve' ? 'confirmed' : 'awaiting_payment';
            $pdo->prepare('UPDATE payments SET status = ?, review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$paymentStatus, trim((string) ($input['note'] ?? '')), $admin['id'], $payment['id']]);
            $pdo->prepare('UPDATE bookings SET status = ?, payment_status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$bookingStatus, $paymentStatus, $payment['booking_id']]);
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, ?, ?, ?, ?)')
                ->execute([$payment['booking_id'], $payment['booking_status'], $bookingStatus, $admin['id'], trim((string) ($input['note'] ?? ''))]);
            return ['paymentId' => (int) $payment['id'], 'bookingId' => $payment['public_id'], 'status' => $paymentStatus, 'bookingStatus' => $bookingStatus];
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

    private function trainerRow(string $where, array $params): ?array
    {
        return $this->database->fetchOne(
            'SELECT tp.id, tp.slug, tp.headline, tp.bio, tp.years_experience, tp.service_mode,
                    tp.gym_name, tp.price_from, tp.approval_status, tp.image_path, tp.is_demo,
                    u.display_name, p.id AS province_id, p.name_th AS province_name, p.region,
                    AVG(r.rating) AS rating, COUNT(r.id) AS review_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             JOIN provinces p ON p.id = tp.primary_province_id
             LEFT JOIN reviews r ON r.trainer_profile_id = tp.id AND r.status = "published"
             WHERE ' . $where . ' GROUP BY tp.id LIMIT 1',
            $params
        );
    }

    private function trainerPayload(array $row): array
    {
        $profileId = (int) $row['id'];
        $areas = $this->database->fetchAll(
            'SELECT COALESCE(tsa.area_label, p.name_th) AS area_name
             FROM trainer_service_areas tsa JOIN provinces p ON p.id = tsa.province_id WHERE tsa.trainer_profile_id = ? ORDER BY area_name',
            [$profileId]
        );
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
             WHERE trainer_profile_id = ? AND starts_at >= UTC_TIMESTAMP() AND starts_at < DATE_ADD(UTC_TIMESTAMP(), INTERVAL 2 MONTH)
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
            'province' => ['id' => (int) $row['province_id'], 'nameTh' => $row['province_name'], 'region' => $row['region']],
            'serviceAreas' => array_column($areas, 'area_name'),
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
                'available' => $slot['state'] === 'available',
            ], $slots),
            'image' => $row['image_path'],
            'demo' => (bool) $row['is_demo'],
        ];
    }

    private function bookingPayload(array $row): array
    {
        return [
            'id' => $row['public_id'],
            'trainer' => ['id' => (int) $row['trainer_id'], 'displayName' => $row['display_name'], 'slug' => $row['slug']],
            'startsAt' => $this->iso($row['starts_at']), 'endsAt' => $this->iso($row['ends_at']), 'location' => $row['location_text'],
            'status' => $row['status'], 'paymentStatus' => $row['payment_status'], 'createdAt' => $this->iso($row['created_at']),
            'demo' => (bool) $row['is_demo'],
        ];
    }

    private function requireChatParticipant(int $roomId, array $user): array
    {
        $room = $this->database->fetchOne(
            'SELECT cr.id, b.member_user_id, tp.user_id AS trainer_user_id
             FROM chat_rooms cr JOIN bookings b ON b.id = cr.booking_id JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id WHERE cr.id = ?',
            [$roomId]
        );
        if (!$room) {
            throw new HttpException(404, 'ไม่พบห้องสนทนา', 'CHAT_NOT_FOUND');
        }
        if ($user['role'] !== 'admin' && (int) $user['id'] !== (int) $room['member_user_id'] && (int) $user['id'] !== (int) $room['trainer_user_id']) {
            throw new HttpException(403, 'ไม่มีสิทธิ์เปิดห้องสนทนานี้', 'FORBIDDEN');
        }
        return $room;
    }

    private function saveUpload(string $field, array $allowedMimeTypes, int $maxBytes, string $directory): array
    {
        if (!isset($_FILES[$field]) || !is_array($_FILES[$field])) {
            throw new HttpException(422, 'กรุณาเลือกไฟล์', 'FILE_REQUIRED', [$field => 'จำเป็นต้องแนบไฟล์']);
        }
        $file = $_FILES[$field];
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new HttpException(422, 'อัปโหลดไฟล์ไม่สำเร็จ', 'UPLOAD_FAILED');
        }
        if ((int) $file['size'] <= 0 || (int) $file['size'] > $maxBytes) {
            throw new HttpException(422, 'ขนาดไฟล์เกินที่กำหนด', 'FILE_TOO_LARGE');
        }
        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = $finfo->file((string) $file['tmp_name']);
        if ($mime === false || !in_array($mime, $allowedMimeTypes, true)) {
            throw new HttpException(422, 'ประเภทไฟล์ไม่รองรับ', 'INVALID_FILE_TYPE');
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
        return ['path' => 'uploads/' . $directory . '/' . $filename, 'mime' => $mime];
    }

    private function iso(string $value): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', strtotime($value . ' UTC'));
    }
}
