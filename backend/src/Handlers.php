<?php
declare(strict_types=1);
require_once __DIR__ . '/PaymentRouting.php';

final class Handlers
{
    private Auth $auth;
    private NotificationService $notifications;
    private RateLimiter $rateLimiter;

    public function __construct(
        private readonly Database $database,
        private readonly array $config
    ) {
        $this->auth = new Auth($database);
        $this->notifications = new NotificationService($database, $config);
        $this->rateLimiter = new RateLimiter($database);
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
        $rows = $this->database->fetchAll(
            'SELECT tp.id, tp.user_id, tp.slug, tp.headline, tp.bio, tp.years_experience, tp.service_mode,
                    tp.gym_name, tp.price_from, tp.monthly_price, tp.monthly_session_count, tp.approval_status, tp.image_path, tp.is_demo,
                    u.display_name,
                    AVG(CASE WHEN review_booking.id IS NOT NULL THEN r.rating END) AS rating,
                    COUNT(review_booking.id) AS review_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN reviews r ON r.trainer_profile_id = tp.id AND r.status = "published"
             LEFT JOIN bookings review_booking ON review_booking.id = r.booking_id AND review_booking.status = "completed"
             WHERE tp.approval_status = "approved" AND u.status = "active" AND tp.price_from > 0
             GROUP BY tp.id
             ORDER BY tp.is_demo ASC, tp.updated_at DESC'
        );
        Http::json(array_map(fn(array $row): array => $this->trainerPayload($row), $rows), 200, ['count' => count($rows)]);
    }

    public function trainer(string $slug): never
    {
        $row = $this->trainerRow('tp.slug = ? AND u.status = "active"', [$slug]);
        $currentUser = $this->auth->currentUser();
        $isOwner = $currentUser !== null && $row && (int) $currentUser['id'] === (int) ($row['user_id'] ?? 0);
        if (!$row || ($row['approval_status'] !== 'approved' && !$isOwner)) {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        $payload = $this->trainerPayload($row);
        $reviews = $this->database->fetchAll(
            'SELECT r.rating, r.comment, r.created_at
             FROM reviews r
             JOIN bookings b ON b.id = r.booking_id AND b.status = "completed"
             WHERE r.trainer_profile_id = ? AND r.status = "published"
             ORDER BY r.created_at DESC, r.id DESC',
            [(int) $row['id']]
        );
        $payload['reviews'] = array_map(fn(array $review): array => [
            'rating' => (int) $review['rating'],
            'comment' => $review['comment'],
            'createdAt' => $this->iso($review['created_at']),
        ], $reviews);
        Http::json($payload);
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
        Http::requireFields($input, ['startsAt']);
        $startsAt = WorkflowRules::parseUtc((string) $input['startsAt'], 'startsAt');
        $endsAt = WorkflowRules::availabilityEnd($startsAt);
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
        $input = Http::body();
        $this->rateLimiter->hit(RateLimiter::REGISTER, RateLimiter::clientKey());
        Http::json($this->auth->register($input), 201);
    }

    public function login(): never
    {
        $input = Http::body();
        // Counted per account and per address: the first stops a password guess
        // against one mailbox, the second stops a sweep across many.
        $this->rateLimiter->hit(RateLimiter::LOGIN, RateLimiter::accountKey((string) ($input['email'] ?? '')));
        $this->rateLimiter->hit(RateLimiter::LOGIN, RateLimiter::clientKey());
        $result = $this->auth->login($input);
        $this->rateLimiter->clear(RateLimiter::LOGIN, RateLimiter::accountKey((string) ($input['email'] ?? '')));
        Http::json($result);
    }

    public function forgotPassword(): never
    {
        $input = Http::body();
        $this->rateLimiter->hit(
            RateLimiter::PASSWORD_RESET_REQUEST,
            RateLimiter::accountKey((string) ($input['email'] ?? ''))
        );
        $this->rateLimiter->hit(RateLimiter::PASSWORD_RESET_REQUEST, RateLimiter::clientKey());

        $reset = $this->auth->requestPasswordReset($input);
        if ($reset !== null) {
            $this->mailPasswordResetCode($reset['email'], $reset['displayName'], $reset['code']);
        }

        // The same answer whether or not the address has an account.
        Http::json(['message' => PasswordResetRules::genericRequestMessage()]);
    }

    public function resetPassword(): never
    {
        $input = Http::body();
        $this->rateLimiter->hit(
            RateLimiter::PASSWORD_RESET_CONFIRM,
            RateLimiter::accountKey((string) ($input['email'] ?? ''))
        );
        $result = $this->auth->resetPassword($input);
        $this->rateLimiter->clear(RateLimiter::PASSWORD_RESET_CONFIRM, RateLimiter::accountKey((string) ($input['email'] ?? '')));
        $this->rateLimiter->clear(RateLimiter::LOGIN, RateLimiter::accountKey((string) ($input['email'] ?? '')));
        Http::json($result);
    }

    public function logout(): never
    {
        $this->auth->logout();
        Http::json(['loggedOut' => true]);
    }

    public function me(): never
    {
        Http::json($this->auth->requireUser());
    }

    public function profile(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        Http::json($this->accountProfilePayload($user));
    }

    public function updateProfile(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $input = Http::body();

        if ($user['role'] === 'member') {
            $profile = ProfileRules::member($input);
            $displayName = trim($profile['firstName'] . ' ' . $profile['lastName']);
            $this->database->transaction(function (PDO $pdo) use ($user, $profile, $displayName): void {
                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$displayName, $user['id']]);
                $pdo->prepare(
                    'UPDATE member_profiles
                     SET first_name = ?, last_name = ?, phone = ?, goals = ?, experience_level = ?,
                         weight = ?, height = ?, updated_at = UTC_TIMESTAMP()
                     WHERE user_id = ?'
                )->execute([
                    $profile['firstName'], $profile['lastName'], self::blankToNull($profile['phone']),
                    self::blankToNull($profile['fitnessGoal']), self::blankToNull($profile['experienceLevel']),
                    $profile['weight'], $profile['height'], $user['id'],
                ]);
            });
        } else {
            $profile = ProfileRules::trainer($input);
            $this->database->transaction(function (PDO $pdo) use ($user, $profile): void {
                $profileStatement = $pdo->prepare('SELECT id FROM trainer_profiles WHERE user_id = ? FOR UPDATE');
                $profileStatement->execute([$user['id']]);
                $trainerProfile = $profileStatement->fetch();
                if (!$trainerProfile) {
                    throw new HttpException(409, 'กรอกข้อมูลสมัครเทรนเนอร์ก่อนแก้โปรไฟล์', 'TRAINER_PROFILE_REQUIRED');
                }

                $typeIds = $profile['trainingTypeIds'];
                $placeholders = implode(',', array_fill(0, count($typeIds), '?'));
                $typeStatement = $pdo->prepare(
                    "SELECT id FROM training_types WHERE active = 1 AND id IN ($placeholders)"
                );
                $typeStatement->execute($typeIds);
                if (count($typeStatement->fetchAll()) !== count($typeIds)) {
                    throw new HttpException(422, 'ประเภทการฝึกไม่ถูกต้อง', 'VALIDATION_FAILED', [
                        'trainingTypeIds' => 'เลือกประเภทการฝึกที่เปิดใช้งาน',
                    ]);
                }

                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$profile['displayName'], $user['id']]);
                $pdo->prepare(
                    'UPDATE trainer_profiles
                     SET legal_name = ?, phone = ?, headline = ?, bio = ?, years_experience = ?,
                         service_mode = ?, gym_name = ?, price_from = ?, monthly_price = ?, monthly_session_count = ?,
                         payment_account_name = ?, promptpay_id = ?, updated_at = UTC_TIMESTAMP()
                     WHERE id = ?'
                )->execute([
                    $profile['legalName'], self::blankToNull($profile['phone']), self::blankToNull($profile['headline']),
                    self::blankToNull($profile['bio']), $profile['yearsExperience'], $profile['serviceMode'],
                    $profile['serviceMode'] === 'freelance' ? null : $profile['gymName'], $profile['priceFrom'],
                    $profile['monthlyPrice'], $profile['monthlySessionCount'],
                    $profile['paymentAccountName'], $profile['promptPayId'],
                    (int) $trainerProfile['id'],
                ]);
                $pdo->prepare('DELETE FROM trainer_training_types WHERE trainer_profile_id = ?')
                    ->execute([(int) $trainerProfile['id']]);
                $insertType = $pdo->prepare(
                    'INSERT INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES (?, ?)'
                );
                foreach ($typeIds as $typeId) {
                    $insertType->execute([(int) $trainerProfile['id'], $typeId]);
                }
            });
        }

        Http::json($this->accountProfilePayload(['id' => $user['id'], 'role' => $user['role']]));
    }

    public function uploadProfileImage(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $this->rateLimiter->hit(RateLimiter::PROFILE_IMAGE, 'user:' . $user['id']);
        try {
            $upload = $this->saveUpload(
                'image',
                ['image/jpeg', 'image/png', 'image/webp'],
                5 * 1024 * 1024,
                'profile-images'
            );
        } catch (HttpException $error) {
            if (in_array($error->status, [413, 415], true)) {
                throw new HttpException(422, $error->getMessage(), 'VALIDATION_FAILED', [
                    'image' => $error->getMessage(),
                ]);
            }
            throw $error;
        }
        if ($upload === null) {
            throw new HttpException(422, 'กรุณาเลือกรูปโปรไฟล์', 'FILE_REQUIRED', [
                'image' => 'จำเป็นต้องเลือกรูป',
            ]);
        }

        $table = $user['role'] === 'member' ? 'member_profiles' : 'trainer_profiles';
        try {
            $oldPath = $this->database->transaction(function (PDO $pdo) use ($user, $upload, $table): ?string {
                $statement = $pdo->prepare("SELECT image_path FROM {$table} WHERE user_id = ? FOR UPDATE");
                $statement->execute([$user['id']]);
                $row = $statement->fetch();
                if (!$row) {
                    throw new HttpException(404, 'ไม่พบโปรไฟล์สำหรับบันทึกรูป', 'PROFILE_NOT_FOUND');
                }
                $pdo->prepare("UPDATE {$table} SET image_path = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?")
                    ->execute([$upload['path'], $user['id']]);
                return $row['image_path'] === null ? null : (string) $row['image_path'];
            });
        } catch (Throwable $error) {
            $this->removeUpload($upload['path']);
            throw $error;
        }
        if ($oldPath !== null) {
            $this->removeUpload($oldPath);
        }

        Http::json([
            'imageUrl' => '/v1/profile-images/' . $user['role'] . '/' . $user['id'],
        ]);
    }

    public function uploadTrainerPaymentQr(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        try {
            $upload = $this->saveUpload('image', ['image/jpeg', 'image/png', 'image/webp'], 5 * 1024 * 1024, 'payment-qr');
        } catch (HttpException $error) {
            if (in_array($error->status, [413, 415], true)) {
                throw new HttpException(422, $error->getMessage(), 'VALIDATION_FAILED', ['image' => $error->getMessage()]);
            }
            throw $error;
        }

        try {
            [$profileId, $oldPath] = $this->database->transaction(function (PDO $pdo) use ($user, $upload): array {
                $statement = $pdo->prepare('SELECT id, payment_qr_path FROM trainer_profiles WHERE user_id = ? FOR UPDATE');
                $statement->execute([$user['id']]);
                $profile = $statement->fetch();
                if (!$profile) throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'PROFILE_NOT_FOUND');
                $pdo->prepare('UPDATE trainer_profiles SET payment_qr_path = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$upload['path'], $profile['id']]);
                return [(int) $profile['id'], $profile['payment_qr_path'] === null ? null : (string) $profile['payment_qr_path']];
            });
        } catch (Throwable $error) {
            $this->removeUpload($upload['path']);
            throw $error;
        }
        if ($oldPath !== null) $this->removeUpload($oldPath);

        Http::json(['paymentQrUrl' => "/v1/trainer-payment-qr/{$profileId}"]);
    }

    public function deleteTrainerPaymentQr(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $oldPath = $this->database->transaction(function (PDO $pdo) use ($user): ?string {
            $statement = $pdo->prepare('SELECT payment_qr_path FROM trainer_profiles WHERE user_id = ? FOR UPDATE');
            $statement->execute([$user['id']]);
            $profile = $statement->fetch();
            if (!$profile) throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'PROFILE_NOT_FOUND');
            $pdo->prepare('UPDATE trainer_profiles SET payment_qr_path = NULL, updated_at = UTC_TIMESTAMP() WHERE user_id = ?')
                ->execute([$user['id']]);
            return $profile['payment_qr_path'] === null ? null : (string) $profile['payment_qr_path'];
        });
        if ($oldPath !== null) $this->removeUpload($oldPath);
        Http::json(['paymentQrUrl' => null]);
    }

    public function notifications(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $page = NotificationService::parsePage($_GET['page'] ?? '0');
        $category = NotificationService::parseCategory($_GET['category'] ?? 'all');
        $unread = NotificationService::parseUnread($_GET['unread'] ?? 'false');
        Http::json($this->notifications->listForUser((int) $user['id'], $page, $category, $unread));
    }

    public function notification(string $notificationId): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $detail = $this->notifications->detailForUser((int) $user['id'], (int) $notificationId);
        if ($detail === null) {
            throw new HttpException(404, 'ไม่พบการแจ้งเตือน', 'NOTIFICATION_NOT_FOUND');
        }
        Http::json($detail);
    }

    public function readNotification(string $notificationId): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        if (!$this->notifications->markRead((int) $user['id'], (int) $notificationId)) {
            throw new HttpException(404, 'ไม่พบการแจ้งเตือน', 'NOTIFICATION_NOT_FOUND');
        }
        Http::json(['id' => (int) $notificationId, 'read' => true]);
    }

    public function readAllNotifications(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        Http::json(['updated' => $this->notifications->markAllRead((int) $user['id'])]);
    }

    public function deleteProfileImage(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $table = $user['role'] === 'member' ? 'member_profiles' : 'trainer_profiles';
        $oldPath = $this->database->transaction(function (PDO $pdo) use ($table, $user): ?string {
            $statement = $pdo->prepare("SELECT image_path FROM {$table} WHERE user_id = ? FOR UPDATE");
            $statement->execute([$user['id']]);
            $row = $statement->fetch();
            if (!$row) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์สำหรับลบรูป', 'PROFILE_NOT_FOUND');
            }
            $pdo->prepare("UPDATE {$table} SET image_path = NULL, updated_at = UTC_TIMESTAMP() WHERE user_id = ?")
                ->execute([$user['id']]);
            return $row['image_path'] === null ? null : (string) $row['image_path'];
        });
        if ($oldPath !== null) {
            $this->removeUpload($oldPath);
        }

        Http::json(['imageUrl' => null]);
    }

    public function changeProfilePassword(): never
    {
        $input = Http::body();
        $this->rateLimiter->hit(RateLimiter::LOGIN, RateLimiter::clientKey());
        Http::json($this->auth->changePassword($input));
    }

    /**
     * The reset code goes out through the same Gmail transport as notifications.
     * A mail failure must not change the answer to the caller, who has no way to
     * act on it and should not learn whether the address exists.
     */
    private function mailPasswordResetCode(string $email, string $displayName, string $code): void
    {
        $mailer = new GmailMailer($this->config['mail'] ?? []);
        if (!$mailer->isEnabled()) {
            return;
        }
        try {
            $mailer->send(
                $email,
                $displayName,
                'รหัสตั้งรหัสผ่านใหม่ FitConnect',
                'สวัสดี ' . $displayName . PHP_EOL . PHP_EOL
                    . 'รหัสสำหรับตั้งรหัสผ่านใหม่คือ ' . $code . PHP_EOL
                    . 'รหัสนี้ใช้ได้ ' . PasswordResetRules::CODE_TTL_MINUTES . ' นาที และใช้ได้ครั้งเดียว' . PHP_EOL . PHP_EOL
                    . 'ถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้งานได้ตามปกติ',
                '/reset-password'
            );
        } catch (Throwable $error) {
            error_log('[fitconnect] password reset mail failed: ' . $error->getMessage());
        }
    }

    public function profileImage(string $role, string $userId): never
    {
        if (!in_array($role, ['member', 'trainer'], true) || (int) $userId <= 0) {
            throw new HttpException(404, 'ไม่พบรูปโปรไฟล์', 'PROFILE_IMAGE_NOT_FOUND');
        }
        $table = $role === 'member' ? 'member_profiles' : 'trainer_profiles';
        $record = $this->database->fetchOne(
            "SELECT image_path FROM {$table} WHERE user_id = ?",
            [(int) $userId]
        );
        if (!$record || !str_starts_with((string) ($record['image_path'] ?? ''), 'uploads/profile-images/')) {
            throw new HttpException(404, 'ไม่พบรูปโปรไฟล์', 'PROFILE_IMAGE_NOT_FOUND');
        }

        $this->serveUploadedImage((string) $record['image_path'], 'profile-images', 'fitconnect-profile-' . $role . '-' . (int) $userId, true);
    }

    public function trainerPaymentQr(string $profileId): never
    {
        if ((int) $profileId <= 0) throw new HttpException(404, 'ไม่พบ QR รับเงิน', 'PAYMENT_QR_NOT_FOUND');
        $record = $this->database->fetchOne(
            'SELECT payment_qr_path FROM trainer_profiles WHERE id = ?',
            [(int) $profileId]
        );
        if (!$record || !str_starts_with((string) ($record['payment_qr_path'] ?? ''), 'uploads/payment-qr/')) {
            throw new HttpException(404, 'ไม่พบ QR รับเงิน', 'PAYMENT_QR_NOT_FOUND');
        }
        $this->serveUploadedImage((string) $record['payment_qr_path'], 'payment-qr', 'fitconnect-payment-qr-' . (int) $profileId, false);
    }

    public function trainerApplication(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        // One form owns the whole professional record. It previously accepted a
        // fraction of it and wrote the free-text "experience" into bio, which is
        // why a new trainer had to fill in a second surface before the storefront
        // made sense.
        $profile = ProfileRules::trainer(Http::body());
        $this->rateLimiter->hit(RateLimiter::TRAINER_APPLICATION, 'user:' . $user['id']);
        $certificate = $this->saveUpload('certificate', ['application/pdf'], 8 * 1024 * 1024, 'certificates', false);
        $replacedCertificatePaths = [];
        try {
            $profileId = $this->database->transaction(function (PDO $pdo) use ($user, $profile, $certificate, &$replacedCertificatePaths): int {
                $existing = $pdo->prepare('SELECT id FROM trainer_profiles WHERE user_id = ? FOR UPDATE');
                $existing->execute([$user['id']]);
                $stored = $existing->fetch();

                $certificateStatement = $pdo->prepare('SELECT COUNT(*) AS total FROM trainer_certificates WHERE trainer_profile_id = ?');
                $hasStoredCertificate = false;
                if ($stored) {
                    $certificateStatement->execute([(int) $stored['id']]);
                    $hasStoredCertificate = (int) ($certificateStatement->fetch()['total'] ?? 0) > 0;
                }
                if ($certificate === null && !$hasStoredCertificate) {
                    throw new HttpException(422, 'กรุณาแนบไฟล์ใบรับรอง', 'VALIDATION_FAILED', [
                        'certificate' => 'แนบไฟล์ PDF ใบรับรองเพื่อให้ผู้ดูแลระบบตรวจ',
                    ]);
                }

                $typeIds = $profile['trainingTypeIds'];
                $placeholders = implode(',', array_fill(0, count($typeIds), '?'));
                $typeStatement = $pdo->prepare("SELECT id FROM training_types WHERE active = 1 AND id IN ($placeholders)");
                $typeStatement->execute($typeIds);
                if (count($typeStatement->fetchAll()) !== count($typeIds)) {
                    throw new HttpException(422, 'ประเภทการฝึกไม่ถูกต้อง', 'VALIDATION_FAILED', [
                        'trainingTypeIds' => 'เลือกประเภทการฝึกที่เปิดใช้งาน',
                    ]);
                }

                if ($stored) {
                    $profileId = (int) $stored['id'];
                } else {
                    $pdo->prepare(
                        'INSERT INTO trainer_profiles (user_id, slug, approval_status) VALUES (?, ?, "pending")'
                    )->execute([$user['id'], 'trainer-' . $user['id']]);
                    $profileId = (int) $pdo->lastInsertId();
                }

                // Submitting the application is a re-reviewable act: the record
                // leaves the storefront until an administrator approves it again.
                $pdo->prepare(
                    'UPDATE trainer_profiles
                     SET legal_name = ?, phone = ?, headline = ?, bio = ?, years_experience = ?,
                         service_mode = ?, gym_name = ?, price_from = ?, monthly_price = ?, monthly_session_count = ?,
                         payment_account_name = ?, promptpay_id = ?,
                         approval_status = "pending", approval_note = NULL, reviewed_by_user_id = NULL, reviewed_at = NULL,
                         updated_at = UTC_TIMESTAMP()
                     WHERE id = ?'
                )->execute([
                    $profile['legalName'], self::blankToNull($profile['phone']), self::blankToNull($profile['headline']),
                    self::blankToNull($profile['bio']), $profile['yearsExperience'], $profile['serviceMode'],
                    $profile['serviceMode'] === 'freelance' ? null : self::blankToNull($profile['gymName']),
                    $profile['priceFrom'], $profile['monthlyPrice'], $profile['monthlySessionCount'],
                    $profile['paymentAccountName'], $profile['promptPayId'], $profileId,
                ]);
                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$profile['displayName'], $user['id']]);

                $pdo->prepare('DELETE FROM trainer_training_types WHERE trainer_profile_id = ?')->execute([$profileId]);
                $insertType = $pdo->prepare(
                    'INSERT INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES (?, ?)'
                );
                foreach ($typeIds as $typeId) {
                    $insertType->execute([$profileId, $typeId]);
                }

                if ($certificate !== null) {
                    // The application owns exactly one certificate. Replacing the set
                    // keeps a resubmission from stacking identical rows, and the files
                    // that leave the record are deleted once the transaction commits.
                    $previousFiles = $pdo->prepare('SELECT file_path FROM trainer_certificates WHERE trainer_profile_id = ?');
                    $previousFiles->execute([$profileId]);
                    $replacedCertificatePaths = array_column($previousFiles->fetchAll(), 'file_path');
                    $pdo->prepare('DELETE FROM trainer_certificates WHERE trainer_profile_id = ?')->execute([$profileId]);

                    $pdo->prepare(
                        'INSERT INTO trainer_certificates (trainer_profile_id, name, issuer, file_path, mime_type, status)
                         VALUES (?, "เอกสารใบรับรองจากผู้สมัคร", "รอระบุ", ?, ?, "pending")'
                    )->execute([$profileId, $certificate['path'], $certificate['mime']]);
                } else {
                    // Keeping the stored file means the previous decision no longer
                    // applies to it, so it returns to the review queue with the rest.
                    $pdo->prepare('UPDATE trainer_certificates SET status = "pending", review_note = NULL, reviewed_by_user_id = NULL, reviewed_at = NULL WHERE trainer_profile_id = ?')
                        ->execute([$profileId]);
                }

                return $profileId;
            });
        } catch (Throwable $error) {
            if ($certificate !== null) {
                $this->removeUpload($certificate['path']);
            }
            throw $error;
        }

        foreach ($replacedCertificatePaths as $previousPath) {
            $this->removeUpload((string) $previousPath);
        }

        Http::json(['trainerProfileId' => $profileId, 'status' => 'pending', 'message' => 'ส่งใบสมัครให้ผู้ดูแลระบบตรวจแล้ว'], 201);
    }

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
                    b.booking_type, b.session_count, b.period_start, b.period_end, b.payment_service_mode,
                    b.status, b.payment_status, b.payment_deadline_at, b.quoted_price, b.created_at, b.is_demo,
                    tp.id AS trainer_id, tp.slug, tp.user_id AS trainer_user_id, tp.image_path AS trainer_image_path,
                    tp.payment_account_name, tp.promptpay_id,
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
            $placeholders = implode(',', array_fill(0, count($bookingIds), '?'));
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
        $bookingType = (string) ($input['bookingType'] ?? 'single');
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
            $placeholders = implode(',', array_fill(0, count($slotIds), '?'));
            $statement = $pdo->prepare(
                'SELECT s.id, s.trainer_profile_id, s.starts_at, s.ends_at, s.state,
                        tp.approval_status, tp.price_from, tp.monthly_price, tp.monthly_session_count, tp.service_mode,
                        tp.payment_account_name, tp.promptpay_id,
                        trainer_user.status AS trainer_user_status
                 FROM availability_slots s
                 JOIN trainer_profiles tp ON tp.id = s.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 WHERE s.id IN (' . $placeholders . ') AND s.trainer_profile_id = ?
                 ORDER BY s.starts_at, s.id FOR UPDATE'
            );
            $statement->execute([...$slotIds, (int) $input['trainerId']]);
            $slots = $statement->fetchAll();
            if (count($slots) !== count($slotIds)) {
                throw new HttpException(409, 'มีช่วงเวลาที่ไม่พร้อมจองแล้ว', 'SLOT_UNAVAILABLE');
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
            if (empty($firstSlot['payment_account_name']) || preg_match('/^(?:0\d{9}|\d{13})$/', (string) ($firstSlot['promptpay_id'] ?? '')) !== 1) {
                throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้ตั้งค่าบัญชีรับเงิน', 'PAYMENT_RECIPIENT_NOT_READY');
            }
            if ($paymentMode === 'gym' && !$this->database->fetchOne(
                'SELECT u.id FROM users u JOIN admin_permissions ap ON ap.user_id = u.id
                 WHERE u.role = "admin" AND u.status = "active" AND ap.review_payments = 1 LIMIT 1'
            )) {
                throw new HttpException(409, 'ยังไม่มีผู้ดูแลระบบที่ตรวจการชำระเงินได้ กรุณาติดต่อเทรนเนอร์', 'GYM_PAYMENT_NOT_READY');
            }
            $lastSlot = $slots[count($slots) - 1];
            if ($bookingType === 'monthly') {
                $sessionCount = (int) ($firstSlot['monthly_session_count'] ?? 0);
                WorkflowRules::assertMonthlyBookingStart($slots, $sessionCount);
                if ($firstSlot['monthly_price'] === null || (float) $firstSlot['monthly_price'] <= 0) {
                    throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้กำหนดราคาแพ็กเกจ', 'TRAINER_PRICE_UNAVAILABLE');
                }
                $quotedPrice = $firstSlot['monthly_price'];
                $periodStart = $firstSlot['starts_at'];
                $periodEnd = (new DateTimeImmutable((string) $periodStart, new DateTimeZone('UTC')))
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
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "awaiting_payment", "not_submitted",
                         DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE))'
            );
            $insert->execute([
                $publicId, $user['id'], (int) $input['trainerId'], (int) $firstSlot['id'],
                $firstSlot['starts_at'], $lastSlot['ends_at'], trim((string) ($input['note'] ?? '')),
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
                ? "สมาชิกจองแพ็กเกจ {$sessionCount} ครั้งและเริ่มช่วงชำระเงิน 10 นาที"
                : 'สมาชิกจองและเริ่มช่วงชำระเงิน 10 นาที';
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, NULL, "awaiting_payment", ?, ?)')
                ->execute([$bookingId, $user['id'], $historyNote]);
            $pdo->prepare('INSERT INTO chat_rooms (booking_id) VALUES (?)')->execute([$bookingId]);
            $created = $pdo->prepare('SELECT payment_deadline_at FROM bookings WHERE id = ?');
            $created->execute([$bookingId]);
            $createdBooking = $created->fetch();
            $notificationIds = array_merge($notificationIds, $this->notifications->recordEvent(
                $pdo,
                NotificationRules::BOOKING_CREATED,
                $this->bookingNotificationContext($pdo, $bookingId, 'created', 'awaiting_payment')
            ));
            return [
                'id' => $publicId,
                'status' => 'awaiting_payment',
                'bookingType' => $bookingType,
                'sessionCount' => $sessionCount,
                'quotedPrice' => (float) $quotedPrice,
                'paymentDeadlineAt' => $this->iso($createdBooking['payment_deadline_at']),
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
            $statement = $pdo->prepare(
                'SELECT b.id, b.member_user_id, b.trainer_profile_id, b.booking_type, b.status,
                        b.payment_status, b.session_count, b.period_start, b.period_end,
                        (SELECT COUNT(*) FROM booking_sessions bs WHERE bs.booking_id = b.id) AS scheduled_count
                 FROM bookings b WHERE b.public_id = ? FOR UPDATE'
            );
            $statement->execute([$publicId]);
            $booking = $statement->fetch();
            if (!$booking || (int) $booking['member_user_id'] !== (int) $user['id']) {
                throw new HttpException(404, 'ไม่พบการจองนี้', 'BOOKING_NOT_FOUND');
            }
            if ($booking['booking_type'] !== 'monthly' || $booking['period_start'] === null || $booking['period_end'] === null) {
                throw new HttpException(409, 'การจองนี้ไม่ใช่แพ็กเกจรายเดือน', 'NOT_MONTHLY_BOOKING');
            }

            $slotStatement = $pdo->prepare(
                'SELECT id, trainer_profile_id, starts_at, ends_at, state
                 FROM availability_slots WHERE id = ? FOR UPDATE'
            );
            $slotStatement->execute([$slotId]);
            $slot = $slotStatement->fetch();
            if (!$slot || (int) $slot['trainer_profile_id'] !== (int) $booking['trainer_profile_id']
                || $slot['state'] !== 'available' || strtotime($slot['starts_at'] . ' UTC') <= time()) {
                throw new HttpException(409, 'ช่วงเวลานี้ไม่พร้อมจองแล้ว', 'SLOT_UNAVAILABLE');
            }

            WorkflowRules::assertMonthlySessionScheduling(
                (string) $booking['status'],
                (string) $booking['payment_status'],
                (int) $booking['scheduled_count'],
                (int) $booking['session_count'],
                new DateTimeImmutable((string) $booking['period_start'], new DateTimeZone('UTC')),
                new DateTimeImmutable((string) $booking['period_end'], new DateTimeZone('UTC')),
                new DateTimeImmutable((string) $slot['starts_at'], new DateTimeZone('UTC')),
                new DateTimeImmutable((string) $slot['ends_at'], new DateTimeZone('UTC')),
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
        $reason = 'สมาชิกยกเลิกก่อนส่งหลักฐานการชำระเงิน';
        $notificationIds = [];

        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $user, $reason, &$notificationIds): array {
            $this->expireAwaitingPaymentsInTransaction($pdo, null, $notificationIds);
            $statement = $pdo->prepare(
                'SELECT id, status, payment_status, availability_slot_id
                 FROM bookings
                 WHERE public_id = ? AND member_user_id = ? FOR UPDATE'
            );
            $statement->execute([$publicId, $user['id']]);
            $booking = $statement->fetch();
            if (!$booking) {
                throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
            }

            WorkflowRules::assertMemberCancellation(
                (string) $booking['status'],
                (string) $booking['payment_status']
            );

            $pdo->prepare(
                'UPDATE bookings
                 SET status = "cancelled", payment_deadline_at = NULL,
                     cancellation_reason = ?, updated_at = UTC_TIMESTAMP()
                 WHERE id = ?'
            )->execute([$reason, $booking['id']]);
            $this->setBookingSlotsState($pdo, (int) $booking['id'], $booking['availability_slot_id'], 'available');
            $pdo->prepare(
                'INSERT INTO booking_status_history
                 (booking_id, from_status, to_status, changed_by_user_id, note)
                 VALUES (?, "awaiting_payment", "cancelled", ?, ?)'
            )->execute([$booking['id'], $user['id'], $reason]);

            $notificationIds = array_merge($notificationIds, $this->notifications->recordEvent(
                $pdo,
                NotificationRules::BOOKING_CANCELLED,
                $this->bookingNotificationContext($pdo, (int) $booking['id'], (string) $booking['status'], 'cancelled', $reason)
            ));

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

        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $input, $user, &$notificationIds): array {
            $statement = $pdo->prepare(
                'SELECT b.id, b.status, b.payment_status, b.quoted_price, b.ends_at,
                        b.booking_type, b.session_count, b.period_end,
                        (SELECT COUNT(*) FROM booking_sessions bs WHERE bs.booking_id = b.id) AS scheduled_count,
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
                $periodEnd = ($booking['period_end'] ?? null) !== null
                    ? new DateTimeImmutable((string) $booking['period_end'], new DateTimeZone('UTC'))
                    : null;
                WorkflowRules::assertTrainerCompletion(
                    (string) $booking['status'],
                    (string) $booking['payment_status'],
                    new DateTimeImmutable((string) $booking['ends_at'], new DateTimeZone('UTC')),
                    new DateTimeImmutable('now', new DateTimeZone('UTC')),
                    (int) $booking['scheduled_count'],
                    (int) $booking['session_count'],
                    $periodEnd
                );
                $slotState = 'booked';
            } else {
                $adminTransitions = [
                    'awaiting_payment' => ['cancelled'],
                    'payment_review' => ['cancelled'],
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
            if ($slotState !== null) {
                $this->setBookingSlotsState($pdo, (int) $booking['id'], $booking['availability_slot_id'], $slotState);
            }
            if ($newStatus === 'cancelled') {
                $cancelNote = trim((string) ($input['note'] ?? ''));
                // An administrator can cancel while a slip is still queued. Close
                // that payment out too, otherwise it stays "reviewing" forever and
                // decidePayment answers PAYMENT_ALREADY_REVIEWED with no way back.
                $closedPayments = $pdo->prepare(
                    'UPDATE payments
                     SET status = "rejected", review_note = ?, reviewed_by_user_id = ?, reviewed_at = UTC_TIMESTAMP()
                     WHERE booking_id = ? AND status = "reviewing"'
                );
                $closedPayments->execute([
                    $cancelNote === '' ? 'คำขอจองถูกยกเลิกโดยผู้ดูแลระบบ' : $cancelNote,
                    $user['id'],
                    $booking['id'],
                ]);
                $notificationIds = array_merge($notificationIds, $this->notifications->recordEvent(
                    $pdo,
                    NotificationRules::BOOKING_CANCELLED,
                    $this->bookingNotificationContext(
                        $pdo,
                        (int) $booking['id'],
                        (string) $booking['status'],
                        'cancelled',
                        $cancelNote
                    )
                ));
            }
            return [
                'id' => $publicId,
                'status' => $newStatus,
                'quotedPrice' => $booking['quoted_price'] === null ? null : (float) $booking['quoted_price'],
            ];
        });
        $this->notifications->deliverByIds($notificationIds);
        Http::json($result);
    }

    public function payment(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId']);
        $this->rateLimiter->hit(RateLimiter::PAYMENT_SLIP, 'user:' . $user['id']);
        $file = $this->saveUpload(
            'slip',
            ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
            5 * 1024 * 1024,
            'payments'
        );
        $notificationIds = [];

        try {
            $result = $this->database->transaction(function (PDO $pdo) use ($input, $user, $file, &$notificationIds): array {
                $statement = $pdo->prepare(
                    'SELECT id, status, availability_slot_id, payment_deadline_at, quoted_price,
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
                    $this->expireAwaitingPaymentsInTransaction($pdo, $slotId, $notificationIds);
                    return ['expired' => true, 'paymentId' => null];
                }

                if ($booking['quoted_price'] === null) {
                    throw new HttpException(409, 'การจองนี้ยังไม่มียอดชำระ', 'PAYMENT_AMOUNT_UNAVAILABLE');
                }
                $amount = WorkflowRules::normalizeMoney($booking['quoted_price'], 'amount');
                $pdo->prepare(
                    'INSERT INTO payments (booking_id, submitted_by_user_id, amount, slip_path, mime_type, status, submitted_at)
                     VALUES (?, ?, ?, ?, ?, "reviewing", UTC_TIMESTAMP())'
                )->execute([$booking['id'], $user['id'], $amount, $file['path'], $file['mime']]);
                $paymentId = (int) $pdo->lastInsertId();
                $pdo->prepare('UPDATE bookings SET status = "payment_review", payment_status = "reviewing", payment_deadline_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$booking['id']]);
                $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, "awaiting_payment", "payment_review", ?, "สมาชิกอัปโหลดสลิป")')
                    ->execute([$booking['id'], $user['id']]);
                $notificationIds = array_merge($notificationIds, $this->notifications->recordEvent(
                    $pdo,
                    NotificationRules::PAYMENT_SUBMITTED,
                    $this->bookingNotificationContext($pdo, (int) $booking['id'], 'awaiting_payment', 'payment_review')
                ));
                return ['expired' => false, 'paymentId' => $paymentId];
            });
        } catch (Throwable $error) {
            $this->removeUpload($file['path']);
            throw $error;
        }
        $this->notifications->deliverByIds($notificationIds);
        if ($result['expired']) {
            $this->removeUpload($file['path']);
            throw new HttpException(409, 'หมดเวลาส่งหลักฐาน กรุณาเลือกเวลาใหม่', 'PAYMENT_DEADLINE_EXPIRED');
        }
        Http::json(['paymentId' => $result['paymentId'], 'bookingId' => $input['bookingId'], 'status' => 'reviewing', 'message' => 'ส่งสลิปให้ผู้รับผิดชอบตรวจแล้ว'], 201);
    }

    public function messages(string $roomId): never
    {
        $user = $this->auth->requireUser();
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
        $room = $this->requireChatParticipant((int) $roomId, $user);
        WorkflowRules::assertChatWritable((string) $room['booking_status']);
        $this->rateLimiter->hit(RateLimiter::CHAT_ATTACHMENT, 'user:' . $user['id'] . ':room:' . (int) $roomId);
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
        );        if ($message === '' && $file === null) {
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

    public function adminOperations(): never
    {
        $admin = $this->auth->requireUser(['admin']);
        $permissions = $this->adminPermissions((int) $admin['id']);
        $pageSize = 10;
        $userPage = $this->adminPage('userPage');
        $administratorPage = $this->adminPage('administratorPage');
        $bookingPage = $this->adminPage('bookingPage');
        $incomePage = $this->adminPage('incomePage');
        $paymentPage = $this->adminPage('paymentPage');
        $userQuery = mb_substr(trim((string) ($_GET['userQuery'] ?? '')), 0, 100);
        $bookingStatus = trim((string) ($_GET['bookingStatus'] ?? 'all'));
        $bookingStatuses = ['awaiting_payment', 'payment_review', 'confirmed', 'completed', 'cancelled', 'expired'];
        if ($bookingStatus !== 'all' && !in_array($bookingStatus, $bookingStatuses, true)) {
            throw new HttpException(422, 'สถานะการจองไม่ถูกต้อง', 'VALIDATION_FAILED');
        }
        $summary = $permissions['manageUsers'] ? ($this->database->fetchOne(
            'SELECT
                SUM(role = "member" AND status = "active") AS active_members,
                SUM(role = "trainer" AND status = "active") AS active_trainers
             FROM users'
        ) ?? []) : [];
        $bookingSummary = $permissions['manageBookings']
            ? ($this->database->fetchOne('SELECT COUNT(*) AS total_bookings FROM bookings') ?? [])
            : [];
        $revenueSummary = $permissions['reviewPayments'] ? ($this->database->fetchOne(
            'SELECT COALESCE(SUM(COALESCE(pay.amount, 0)), 0) AS approved_revenue
             FROM payments pay JOIN bookings b ON b.id = pay.booking_id
             WHERE pay.status = "approved" AND ' . PaymentRouting::scope($admin)[0],
            PaymentRouting::scope($admin)[1]
        ) ?? []) : [];

        $users = [];
        $administrators = [];
        $userTotal = 0;
        $administratorTotal = 0;
        if ($permissions['manageUsers']) {
            $userWhere = 'u.role <> "admin"';
            $userParams = [];
            if ($userQuery !== '') {
                $userWhere .= ' AND (u.display_name LIKE ? OR u.email LIKE ?)';
                $like = '%' . $userQuery . '%';
                $userParams = [$like, $like];
            }
            $userCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM users u WHERE ' . $userWhere, $userParams);
            $userTotal = (int) ($userCount['total'] ?? 0);
            $rows = $this->database->fetchAll(
                'SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
                        tp.approval_status
                 FROM users u
                 LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
                 WHERE ' . $userWhere . '
                 ORDER BY FIELD(u.role, "trainer", "member"), u.created_at DESC, u.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($userPage * $pageSize),
                $userParams
            );
            $users = array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'email' => $row['email'],
                'displayName' => $row['display_name'],
                'role' => $row['role'],
                'status' => $row['status'],
                'createdAt' => $this->iso($row['created_at']),
                'approvalStatus' => $row['approval_status'],
                'permissions' => null,
            ], $rows);

            $administratorCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM users WHERE role = "admin"');
            $administratorTotal = (int) ($administratorCount['total'] ?? 0);
            $adminRows = $this->database->fetchAll(
                'SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
                        ap.manage_users, ap.review_trainers, ap.manage_bookings, ap.review_payments
                 FROM users u
                 LEFT JOIN admin_permissions ap ON ap.user_id = u.id
                 WHERE u.role = "admin"
                 ORDER BY u.created_at DESC, u.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($administratorPage * $pageSize)
            );
            $administrators = array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'email' => $row['email'],
                'displayName' => $row['display_name'],
                'role' => $row['role'],
                'status' => $row['status'],
                'createdAt' => $this->iso($row['created_at']),
                'approvalStatus' => null,
                'permissions' => [
                    'manageUsers' => (bool) $row['manage_users'],
                    'reviewTrainers' => (bool) $row['review_trainers'],
                    'manageBookings' => (bool) $row['manage_bookings'],
                    'reviewPayments' => (bool) $row['review_payments'],
                ],
            ], $adminRows);
        }

        $bookings = [];
        $bookingTotal = 0;
        if ($permissions['manageBookings']) {
            $bookingWhere = $bookingStatus === 'all' ? '' : 'WHERE b.status = ?';
            $bookingParams = $bookingStatus === 'all' ? [] : [$bookingStatus];
            $bookingCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM bookings b ' . $bookingWhere, $bookingParams);
            $bookingTotal = (int) ($bookingCount['total'] ?? 0);
            $rows = $this->database->fetchAll(
                'SELECT b.id, b.public_id, b.starts_at, b.ends_at, b.status, b.payment_status,
                        b.quoted_price, b.created_at, member_user.display_name AS member_name,
                        trainer_user.display_name AS trainer_name
                 FROM bookings b
                 JOIN users member_user ON member_user.id = b.member_user_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 ' . $bookingWhere . '
                 ORDER BY b.created_at DESC, b.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($bookingPage * $pageSize),
                $bookingParams
            );
            $historyByBooking = [];
            if ($rows !== []) {
                $ids = array_map(fn(array $row): int => (int) $row['id'], $rows);
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $history = $this->database->fetchAll(
                    'SELECT h.booking_id, h.from_status, h.to_status, h.note, h.created_at,
                            u.display_name AS changed_by
                     FROM booking_status_history h
                     LEFT JOIN users u ON u.id = h.changed_by_user_id
                     WHERE h.booking_id IN (' . $placeholders . ')
                     ORDER BY h.created_at DESC, h.id DESC',
                    $ids
                );
                foreach ($history as $item) {
                    $historyByBooking[(int) $item['booking_id']][] = [
                        'fromStatus' => $item['from_status'],
                        'toStatus' => $item['to_status'],
                        'changedBy' => $item['changed_by'],
                        'note' => $item['note'],
                        'createdAt' => $this->iso($item['created_at']),
                    ];
                }
            }
            $bookings = array_map(fn(array $row): array => [
                'id' => $row['public_id'],
                'memberName' => $row['member_name'],
                'trainerName' => $row['trainer_name'],
                'startsAt' => $this->iso($row['starts_at']),
                'endsAt' => $this->iso($row['ends_at']),
                'status' => $row['status'],
                'paymentStatus' => $row['payment_status'],
                'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                'createdAt' => $this->iso($row['created_at']),
                'history' => $historyByBooking[(int) $row['id']] ?? [],
            ], $rows);
        }

        $payments = [];
        $trainerIncome = [];
        $paymentTotal = 0;
        $incomeTotal = 0;
        if ($permissions['reviewPayments']) {
            [$paymentScope, $paymentParams] = PaymentRouting::scope($admin);
            $paymentCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM payments pay
                JOIN bookings b ON b.id = pay.booking_id WHERE ' . $paymentScope, $paymentParams);
            $paymentTotal = (int) ($paymentCount['total'] ?? 0);
            $rows = $this->database->fetchAll(
                'SELECT pay.id, pay.amount, pay.status, pay.submitted_at, pay.reviewed_at,
                        b.public_id, b.quoted_price, member_user.display_name AS member_name,
                        trainer_user.display_name AS trainer_name, reviewer.display_name AS reviewed_by
                 FROM payments pay
                 JOIN bookings b ON b.id = pay.booking_id
                 JOIN users member_user ON member_user.id = b.member_user_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 LEFT JOIN users reviewer ON reviewer.id = pay.reviewed_by_user_id
                 WHERE ' . $paymentScope . '
                 ORDER BY pay.submitted_at DESC, pay.id DESC
                 LIMIT ' . $pageSize . ' OFFSET ' . ($paymentPage * $pageSize),
                $paymentParams
            );
            $payments = array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'bookingId' => $row['public_id'],
                'memberName' => $row['member_name'],
                'trainerName' => $row['trainer_name'],
                'amount' => $row['amount'] === null ? null : (float) $row['amount'],
                'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                'status' => $row['status'],
                'submittedAt' => $this->iso($row['submitted_at']),
                'reviewedAt' => $row['reviewed_at'] === null ? null : $this->iso($row['reviewed_at']),
                'reviewedBy' => $row['reviewed_by'],
            ], $rows);
            $incomeCount = $this->database->fetchOne(
                'SELECT COUNT(DISTINCT b.trainer_profile_id) AS total
                 FROM payments pay JOIN bookings b ON b.id = pay.booking_id
                 WHERE pay.status = "approved" AND ' . $paymentScope,
                $paymentParams
            );
            $incomeTotal = (int) ($incomeCount['total'] ?? 0);
            $incomeRows = $this->database->fetchAll(
                'SELECT tp.id AS trainer_id, u.display_name AS trainer_name, SUM(b.session_count) AS paid_sessions,
                        COALESCE(SUM(COALESCE(pay.amount, b.quoted_price, 0)), 0) AS revenue
                 FROM payments pay
                 JOIN bookings b ON b.id = pay.booking_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users u ON u.id = tp.user_id
                 WHERE pay.status = "approved" AND ' . $paymentScope . '
                 GROUP BY tp.id, u.display_name ORDER BY revenue DESC, tp.id
                 LIMIT ' . $pageSize . ' OFFSET ' . ($incomePage * $pageSize),
                $paymentParams
            );
            $trainerIncome = array_map(fn(array $row): array => [
                'trainerId' => (int) $row['trainer_id'],
                'trainerName' => $row['trainer_name'],
                'paidSessions' => (int) $row['paid_sessions'],
                'revenue' => (float) $row['revenue'],
            ], $incomeRows);
        }

        Http::json([
            'currentUserId' => (int) $admin['id'],
            'permissions' => $permissions,
            'summary' => [
                'activeMembers' => $permissions['manageUsers'] ? (int) ($summary['active_members'] ?? 0) : null,
                'activeTrainers' => $permissions['manageUsers'] ? (int) ($summary['active_trainers'] ?? 0) : null,
                'totalBookings' => $permissions['manageBookings'] ? (int) ($bookingSummary['total_bookings'] ?? 0) : null,
                'approvedRevenue' => $permissions['reviewPayments'] ? (float) ($revenueSummary['approved_revenue'] ?? 0) : null,
            ],
            'users' => $users,
            'administrators' => $administrators,
            'bookings' => $bookings,
            'payments' => $payments,
            'trainerIncome' => $trainerIncome,
            'pagination' => [
                'pageSize' => $pageSize,
                'users' => ['page' => $userPage, 'total' => $permissions['manageUsers'] ? $userTotal : 0],
                'administrators' => ['page' => $administratorPage, 'total' => $permissions['manageUsers'] ? $administratorTotal : 0],
                'bookings' => ['page' => $bookingPage, 'total' => $permissions['manageBookings'] ? $bookingTotal : 0],
                'payments' => ['page' => $paymentPage, 'total' => $permissions['reviewPayments'] ? $paymentTotal : 0],
                'trainerIncome' => ['page' => $incomePage, 'total' => $permissions['reviewPayments'] ? $incomeTotal : 0],
            ],
        ]);
    }

    public function paymentRouting(): never
    {
        $this->requireAdminPermission('manage_users');
        $this->requireAdminPermission('review_payments');
        Http::json([
            'unresolved' => $this->database->fetchAll('SELECT b.public_id AS id, u.display_name AS trainerName
                FROM bookings b JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id JOIN users u ON u.id = tp.user_id
                WHERE b.payment_service_mode IS NULL
                ORDER BY b.created_at DESC'),
        ]);
    }

    public function savePaymentRouting(): never
    {
        $this->requireAdminPermission('manage_users');
        $this->requireAdminPermission('review_payments');
        $input = Http::body();
        $this->database->transaction(function (PDO $pdo) use ($input): void {
            if (isset($input['bookingId'])) {
                $statement = $pdo->prepare('SELECT b.id, b.payment_service_mode
                    FROM bookings b WHERE b.public_id = ? FOR UPDATE');
                $statement->execute([(string) $input['bookingId']]);
                $booking = $statement->fetch();
                if (!$booking || $booking['payment_service_mode'] !== null) {
                    throw new HttpException(409, 'การจองนี้กำหนดผู้รับผิดชอบไว้แล้ว', 'PAYMENT_ROUTING_FIXED');
                }
                $mode = PaymentRouting::serviceMode($booking['payment_service_mode'] ?? 'both', $input['paymentServiceMode'] ?? null);
                $pdo->prepare('UPDATE bookings SET payment_service_mode = ? WHERE id = ?')
                    ->execute([$mode, $booking['id']]);
                return;
            }
            throw new HttpException(422, 'ระบุการจองเดิมที่ต้องกำหนดผู้ตรวจสลิป', 'VALIDATION_FAILED');
        });
        Http::json(['saved' => true]);
    }

    public function createAdminUser(): never
    {
        $admin = $this->requireAdminPermission('manage_users');
        $input = Http::body();
        Http::requireFields($input, ['displayName', 'email', 'password']);
        $displayName = trim((string) $input['displayName']);
        $email = strtolower(trim((string) $input['email']));
        $password = (string) $input['password'];
        $permissions = $this->normalizeAdminPermissions($input['permissions']);
        $this->assertAssignablePermissions($this->adminPermissions((int) $admin['id']), $permissions);
        $fields = [];
        if ($displayName === '') $fields['displayName'] = 'กรุณาระบุชื่อที่แสดง';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $fields['email'] = 'อีเมลไม่ถูกต้อง';
        if (mb_strlen($password) < 8) $fields['password'] = 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร';
        if (!in_array(true, $permissions, true)) $fields['permissions'] = 'เลือกสิทธิ์อย่างน้อย 1 รายการ';
        if ($fields !== []) throw new HttpException(422, 'ข้อมูลผู้ดูแลระบบไม่ถูกต้อง', 'VALIDATION_FAILED', $fields);
        if ($this->database->fetchOne('SELECT id FROM users WHERE email = ?', [$email])) {
            throw new HttpException(409, 'อีเมลนี้ถูกใช้งานแล้ว', 'EMAIL_EXISTS', ['email' => 'อีเมลนี้ถูกใช้งานแล้ว']);
        }
        $id = $this->database->transaction(function (PDO $pdo) use ($admin, $displayName, $email, $password, $permissions): int {
            $permissionStatement = $pdo->prepare(
                'SELECT manage_users, review_trainers, manage_bookings, review_payments
                 FROM admin_permissions WHERE user_id = ? FOR UPDATE'
            );
            $permissionStatement->execute([(int) $admin['id']]);
            $callerPermissions = $this->adminPermissionsFromRow($permissionStatement->fetch() ?: []);
            if (!$callerPermissions['manageUsers']) {
                throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
            }
            $this->assertAssignablePermissions($callerPermissions, $permissions);
            $pdo->prepare('INSERT INTO users (email, password_hash, display_name, role, status) VALUES (?, ?, ?, "admin", "active")')
                ->execute([$email, password_hash($password, PASSWORD_DEFAULT), $displayName]);
            $id = (int) $pdo->lastInsertId();
            $pdo->prepare('INSERT INTO admin_permissions (user_id, manage_users, review_trainers, manage_bookings, review_payments) VALUES (?, ?, ?, ?, ?)')
                ->execute([$id, (int) $permissions['manageUsers'], (int) $permissions['reviewTrainers'], (int) $permissions['manageBookings'], (int) $permissions['reviewPayments']]);
            return $id;
        });
        Http::json(['id' => $id, 'displayName' => $displayName, 'email' => $email, 'role' => 'admin', 'status' => 'active', 'permissions' => $permissions], 201);
    }

    public function updateAdminUser(string $userId): never
    {
        $admin = $this->requireAdminPermission('manage_users');
        $input = Http::body();
        $target = $this->database->fetchOne('SELECT id, email, display_name, role, status FROM users WHERE id = ?', [(int) $userId]);
        if (!$target) throw new HttpException(404, 'ไม่พบบัญชีผู้ใช้', 'USER_NOT_FOUND');
        $displayName = array_key_exists('displayName', $input) ? trim((string) $input['displayName']) : (string) $target['display_name'];
        $email = array_key_exists('email', $input) ? strtolower(trim((string) $input['email'])) : (string) $target['email'];
        $status = array_key_exists('status', $input) ? (string) $input['status'] : (string) $target['status'];
        $fields = [];
        if ($displayName === '') $fields['displayName'] = 'กรุณาระบุชื่อที่แสดง';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) $fields['email'] = 'อีเมลไม่ถูกต้อง';
        if (!in_array($status, ['active', 'suspended'], true)) $fields['status'] = 'สถานะบัญชีไม่ถูกต้อง';
        if ($target['status'] === 'deleted' && $status !== 'deleted') $fields['status'] = 'บัญชีที่ลบแล้วไม่สามารถเปิดใช้งานใหม่';
        if ((int) $target['id'] === (int) $admin['id'] && $status !== 'active') $fields['status'] = 'ไม่สามารถระงับบัญชีที่กำลังใช้งาน';
        if ($fields !== []) throw new HttpException(422, 'ข้อมูลบัญชีไม่ถูกต้อง', 'VALIDATION_FAILED', $fields);
        $duplicate = $this->database->fetchOne('SELECT id FROM users WHERE email = ? AND id <> ?', [$email, (int) $target['id']]);
        if ($duplicate) throw new HttpException(409, 'อีเมลนี้ถูกใช้งานแล้ว', 'EMAIL_EXISTS', ['email' => 'อีเมลนี้ถูกใช้งานแล้ว']);
        $targetPermissions = $target['role'] === 'admin' ? $this->adminPermissions((int) $target['id']) : null;
        $permissions = null;
        if (array_key_exists('permissions', $input)) {
            if ($target['role'] !== 'admin') throw new HttpException(422, 'กำหนดสิทธิ์ได้เฉพาะผู้ดูแลระบบ', 'VALIDATION_FAILED');
            if ((int) $target['id'] === (int) $admin['id']) throw new HttpException(409, 'ไม่สามารถแก้สิทธิ์ของบัญชีที่กำลังใช้งาน', 'SELF_PERMISSION_CHANGE');
            $permissions = $this->normalizeAdminPermissions($input['permissions']);
            if (!in_array(true, $permissions, true)) throw new HttpException(422, 'เลือกสิทธิ์อย่างน้อย 1 รายการ', 'VALIDATION_FAILED');
            $this->assertAssignablePermissions($this->adminPermissions((int) $admin['id']), $permissions, $targetPermissions);
        }
        $this->database->transaction(function (PDO $pdo) use ($admin, $target, $displayName, $email, $status, $permissions): void {
            $permissionIds = [(int) $admin['id']];
            if ($target['role'] === 'admin' && (int) $target['id'] !== (int) $admin['id']) $permissionIds[] = (int) $target['id'];
            sort($permissionIds);
            $permissionPlaceholders = implode(',', array_fill(0, count($permissionIds), '?'));
            $permissionStatement = $pdo->prepare(
                'SELECT user_id, manage_users, review_trainers, manage_bookings, review_payments
                 FROM admin_permissions WHERE user_id IN (' . $permissionPlaceholders . ')
                 ORDER BY user_id FOR UPDATE'
            );
            $permissionStatement->execute($permissionIds);
            $lockedPermissions = [];
            foreach ($permissionStatement->fetchAll() as $row) {
                $lockedPermissions[(int) $row['user_id']] = $this->adminPermissionsFromRow($row);
            }
            $callerPermissions = $lockedPermissions[(int) $admin['id']] ?? $this->adminPermissionsFromRow([]);
            if (!$callerPermissions['manageUsers']) {
                throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
            }
            $lockedTargetPermissions = $lockedPermissions[(int) $target['id']] ?? $this->adminPermissionsFromRow([]);
            if ($permissions !== null) {
                $this->assertAssignablePermissions($callerPermissions, $permissions, $lockedTargetPermissions);
            }
            $removesUserManagement = $target['role'] === 'admin'
                && $lockedTargetPermissions['manageUsers']
                && ($status === 'suspended' || ($permissions !== null && !$permissions['manageUsers']));
            if ($removesUserManagement) {
                $managerStatement = $pdo->query(
                    'SELECT ap.user_id
                     FROM admin_permissions ap
                     JOIN users u ON u.id = ap.user_id
                     WHERE ap.manage_users = 1 AND u.status = "active"
                     FOR UPDATE'
                );
                $managerIds = array_map('intval', $managerStatement->fetchAll(PDO::FETCH_COLUMN));
                $remainingManagerIds = array_filter($managerIds, fn(int $id): bool => $id !== (int) $target['id']);
                if ($remainingManagerIds === []) {
                    throw new HttpException(409, 'ต้องมีผู้ดูแลระบบที่จัดการบัญชีได้อย่างน้อย 1 คน', 'LAST_USER_MANAGER');
                }
            }
            $pdo->prepare('UPDATE users SET display_name = ?, email = ?, status = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$displayName, $email, $status, (int) $target['id']]);
            if ($permissions !== null) {
                $pdo->prepare('INSERT INTO admin_permissions (user_id, manage_users, review_trainers, manage_bookings, review_payments)
                               VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE manage_users = VALUES(manage_users), review_trainers = VALUES(review_trainers), manage_bookings = VALUES(manage_bookings), review_payments = VALUES(review_payments)')
                    ->execute([(int) $target['id'], (int) $permissions['manageUsers'], (int) $permissions['reviewTrainers'], (int) $permissions['manageBookings'], (int) $permissions['reviewPayments']]);
            }
            if ($status === 'suspended') {
                $pdo->prepare('UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL')->execute([(int) $target['id']]);
            }
        });
        Http::json(['id' => (int) $target['id'], 'displayName' => $displayName, 'email' => $email, 'role' => $target['role'], 'status' => $status, 'permissions' => $permissions]);
    }

    public function decideTrainer(string $trainerId, string $decision): never
    {
        $admin = $this->requireAdminPermission('review_trainers');
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
        $admin = $this->auth->requireUser(['admin', 'trainer']);
        $permissions = $admin['role'] === 'admin'
            ? $this->adminPermissions((int) $admin['id'])
            : array_merge($this->adminPermissionsFromRow([]), ['reviewPayments' => true]);
        [$paymentScope, $paymentParams] = PaymentRouting::scope($admin);
        if (!$permissions['reviewTrainers'] && !$permissions['reviewPayments']) {
            throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์เปิดคิวตรวจสอบ', 'ADMIN_PERMISSION_REQUIRED');
        }
        $trainers = $permissions['reviewTrainers'] ? $this->database->fetchAll(
            'SELECT tp.id, tp.slug, tp.created_at, tp.is_demo, u.display_name, COUNT(tc.id) AS certificate_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN trainer_certificates tc ON tc.trainer_profile_id = tp.id
             WHERE tp.approval_status = "pending"
             GROUP BY tp.id ORDER BY tp.created_at ASC LIMIT 100'
        ) : [];
        $payments = $permissions['reviewPayments'] ? $this->database->fetchAll(
            'SELECT pay.id, pay.submitted_at, pay.amount,
                    b.public_id AS booking_public_id, b.starts_at, b.ends_at, b.booking_type, b.quoted_price, b.is_demo,
                    member_user.display_name AS member_name, trainer_user.display_name AS trainer_name
             FROM payments pay
             JOIN bookings b ON b.id = pay.booking_id
             JOIN users member_user ON member_user.id = pay.submitted_by_user_id
             JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
             JOIN users trainer_user ON trainer_user.id = tp.user_id
             WHERE pay.status = "reviewing" AND ' . $paymentScope . ' ORDER BY pay.submitted_at ASC LIMIT 100',
            $paymentParams
        ) : [];

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
                'bookingType' => $row['booking_type'] ?? 'single',
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
        $admin = $this->auth->requireUser(['admin', 'trainer']);
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new HttpException(404, 'ไม่พบการทำงานนี้', 'NOT_FOUND');
        }
        $input = Http::body();
        if ($decision === 'approve' && !filter_var($input['bankConfirmed'] ?? false, FILTER_VALIDATE_BOOL)) {
            throw new HttpException(422, 'กรุณาตรวจรายการเงินจริงในแอปธนาคารก่อนอนุมัติ', 'BANK_CONFIRMATION_REQUIRED', [
                'bankConfirmed' => 'ยืนยันว่าเลขอ้างอิง ผู้รับ ยอดเงิน และเวลาตรงกับรายการเงินจริง',
            ]);
        }
        $notificationIds = [];
        $result = $this->database->transaction(function (PDO $pdo) use ($paymentId, $decision, $input, $admin, &$notificationIds): array {
            [$scope, $params] = PaymentRouting::scope($admin);
            $statement = $pdo->prepare(
                'SELECT pay.id, pay.status, pay.booking_id, b.public_id, b.status AS booking_status,
                        b.availability_slot_id, UTC_TIMESTAMP() AS database_now
                 FROM payments pay JOIN bookings b ON b.id = pay.booking_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 WHERE pay.id = ? AND ' . $scope . ' FOR UPDATE'
            );
            $statement->execute([(int) $paymentId, ...$params]);
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
            $historyNote = $decision === 'approve' && $note === '' ? 'ผู้ตรวจยืนยันรายการเงินจริงในแอปธนาคารแล้ว' : $note;
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, ?, ?, ?, ?)')
                ->execute([$payment['booking_id'], $payment['booking_status'], $bookingStatus, $admin['id'], $historyNote]);
            $this->setBookingSlotsState($pdo, (int) $payment['booking_id'], $payment['availability_slot_id'], $slotState);
            $event = $decision === 'approve'
                ? NotificationRules::PAYMENT_APPROVED
                : ($bookingStatus === 'awaiting_payment'
                    ? NotificationRules::PAYMENT_REJECTED_RETRY
                    : NotificationRules::PAYMENT_REJECTED_FINAL);
            $notificationIds = array_merge($notificationIds, $this->notifications->recordEvent(
                $pdo,
                $event,
                $this->bookingNotificationContext(
                    $pdo,
                    (int) $payment['booking_id'],
                    (string) $payment['booking_status'],
                    $bookingStatus,
                    $note
                )
            ));
            return [
                'paymentId' => (int) $payment['id'],
                'bookingId' => $payment['public_id'],
                'status' => $paymentStatus,
                'bookingStatus' => $bookingStatus,
                'paymentDeadlineAt' => $paymentDeadline === null ? null : $this->iso($paymentDeadline->format('Y-m-d H:i:s')),
            ];
        });
        $this->notifications->deliverByIds($notificationIds);
        Http::json($result);
    }

    public function adminFile(string $kind, string $recordId): never
    {
        if ($kind === 'payment') {
            $user = $this->auth->requireUser(['admin', 'trainer']);
            [$scope, $params] = PaymentRouting::scope($user);
            $record = $this->database->fetchOne('SELECT pay.slip_path AS file_path, pay.mime_type
                FROM payments pay JOIN bookings b ON b.id = pay.booking_id
                JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                WHERE pay.id = ? AND ' . $scope, [(int) $recordId, ...$params]);
        } elseif ($kind === 'certificate') {
            $this->requireAdminPermission('review_trainers');
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

    private function requireAdminPermission(string $column): array
    {
        $admin = $this->auth->requireUser(['admin']);
        $permissions = $this->adminPermissions((int) $admin['id']);
        $key = match ($column) {
            'manage_users' => 'manageUsers',
            'review_trainers' => 'reviewTrainers',
            'manage_bookings' => 'manageBookings',
            'review_payments' => 'reviewPayments',
            default => throw new LogicException('Unknown administrator permission'),
        };
        if (!$permissions[$key]) {
            throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
        }
        return $admin;
    }

    private function adminPermissions(int $userId): array
    {
        $row = $this->database->fetchOne(
            'SELECT manage_users, review_trainers, manage_bookings, review_payments FROM admin_permissions WHERE user_id = ?',
            [$userId]
        ) ?? [];
        return $this->adminPermissionsFromRow($row);
    }

    private function adminPermissionsFromRow(array $row): array
    {
        return [
            'manageUsers' => (bool) ($row['manage_users'] ?? false),
            'reviewTrainers' => (bool) ($row['review_trainers'] ?? false),
            'manageBookings' => (bool) ($row['manage_bookings'] ?? false),
            'reviewPayments' => (bool) ($row['review_payments'] ?? false),
        ];
    }

    private function normalizeAdminPermissions(mixed $value): array
    {
        $input = is_array($value) ? $value : [];
        return [
            'manageUsers' => filter_var($input['manageUsers'] ?? false, FILTER_VALIDATE_BOOL),
            'reviewTrainers' => filter_var($input['reviewTrainers'] ?? false, FILTER_VALIDATE_BOOL),
            'manageBookings' => filter_var($input['manageBookings'] ?? false, FILTER_VALIDATE_BOOL),
            'reviewPayments' => filter_var($input['reviewPayments'] ?? false, FILTER_VALIDATE_BOOL),
        ];
    }

    private function assertAssignablePermissions(array $caller, array $requested, ?array $existing = null): void
    {
        foreach (array_keys($requested) as $key) {
            $currentValue = $existing[$key] ?? false;
            if (!$caller[$key] && $requested[$key] !== $currentValue) {
                throw new HttpException(403, 'กำหนดได้เฉพาะสิทธิ์ที่บัญชีของคุณมีอยู่', 'PERMISSION_DELEGATION_FORBIDDEN');
            }
        }
    }

    private function adminPage(string $key): int
    {
        $value = filter_var($_GET[$key] ?? 0, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        return $value === false ? 0 : min((int) $value, 100000);
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

        $statement = $pdo->prepare($sql);
        $statement->execute($params);
        $expired = $statement->fetchAll();

        foreach ($expired as $booking) {
            $pdo->prepare('UPDATE bookings SET status = "expired", updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$booking['id']]);
            $this->setBookingSlotsState($pdo, (int) $booking['id'], $booking['availability_slot_id'], 'available');
            $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, "awaiting_payment", "expired", NULL, "หมดเวลาส่งหลักฐานการชำระ")')
                ->execute([$booking['id']]);
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
        $statement = $pdo->prepare(
            'SELECT b.id, b.public_id, b.member_user_id, tp.user_id AS trainer_user_id,
                    member.display_name AS member_name, trainer.display_name AS trainer_name,
                    b.starts_at, b.ends_at, b.quoted_price
             FROM bookings b
             JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
             JOIN users member ON member.id = b.member_user_id
             JOIN users trainer ON trainer.id = tp.user_id
             WHERE b.id = ?'
        );
        $statement->execute([$bookingId]);
        $booking = $statement->fetch();
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
            'quotedPrice' => $booking['quoted_price'] === null ? null : (float) $booking['quoted_price'],
            'previousStatus' => $previousStatus,
            'nextStatus' => $nextStatus,
            'reviewNote' => $reviewNote,
        ];
    }

    private function accountProfilePayload(array $user): array
    {
        if ($user['role'] === 'member') {
            $row = $this->database->fetchOne(
                'SELECT u.display_name, u.email, mp.first_name, mp.last_name, mp.phone, mp.goals,
                        mp.experience_level, mp.weight, mp.height, mp.image_path
                 FROM users u JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = ?',
                [$user['id']]
            );
            if (!$row) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์สมาชิก', 'PROFILE_NOT_FOUND');
            }
            $firstName = trim((string) ($row['first_name'] ?? ''));
            return [
                'role' => 'member',
                'user' => ['displayName' => $row['display_name'], 'email' => $row['email']],
                'imageUrl' => self::accountImageUrl('member', (int) $user['id'], $row['image_path']),
                'member' => [
                    'firstName' => $firstName === '' ? $row['display_name'] : $firstName,
                    'lastName' => $row['last_name'] ?? '',
                    'phone' => $row['phone'] ?? '',
                    'fitnessGoal' => $row['goals'] ?? '',
                    'experienceLevel' => $row['experience_level'] ?? '',
                    'weight' => $row['weight'] === null ? null : (float) $row['weight'],
                    'height' => $row['height'] === null ? null : (float) $row['height'],
                ],
            ];
        }

        $row = $this->database->fetchOne(
            'SELECT u.display_name, u.email, tp.id, tp.legal_name, tp.phone, tp.headline, tp.bio,
                    tp.years_experience, tp.service_mode, tp.gym_name, tp.price_from, tp.monthly_price,
                    tp.monthly_session_count, tp.payment_account_name, tp.promptpay_id, tp.payment_qr_path, tp.image_path,
                    tp.approval_status, tp.approval_note
             FROM users u JOIN trainer_profiles tp ON tp.user_id = u.id WHERE u.id = ?',
            [$user['id']]
        );
        if (!$row) {
            throw new HttpException(409, 'กรอกข้อมูลสมัครเทรนเนอร์ก่อนเปิดโปรไฟล์', 'TRAINER_PROFILE_REQUIRED');
        }
        $profileId = (int) $row['id'];
        $types = $this->database->fetchAll(
            'SELECT training_type_id FROM trainer_training_types WHERE trainer_profile_id = ? ORDER BY training_type_id',
            [$profileId]
        );
        $certificates = $this->database->fetchAll(
            'SELECT id, name, issuer, issued_year, status FROM trainer_certificates
             WHERE trainer_profile_id = ? ORDER BY id DESC',
            [$profileId]
        );

        return [
            'role' => 'trainer',
            'user' => ['displayName' => $row['display_name'], 'email' => $row['email']],
            'imageUrl' => self::accountImageUrl('trainer', (int) $user['id'], $row['image_path']),
            'trainer' => [
                'legalName' => $row['legal_name'] ?? '',
                'phone' => $row['phone'] ?? '',
                'headline' => $row['headline'] ?? '',
                'bio' => $row['bio'] ?? '',
                'yearsExperience' => (int) $row['years_experience'],
                'serviceMode' => $row['service_mode'],
                'gymName' => $row['gym_name'],
                'priceFrom' => $row['price_from'] === null ? null : (float) $row['price_from'],
                'monthlyPrice' => $row['monthly_price'] === null ? null : (float) $row['monthly_price'],
                'monthlySessionCount' => $row['monthly_session_count'] === null ? null : (int) $row['monthly_session_count'],
                'paymentAccountName' => $row['payment_account_name'] ?? '',
                'promptPayId' => $row['promptpay_id'] ?? '',
                'paymentQrUrl' => empty($row['payment_qr_path']) ? null : "/v1/trainer-payment-qr/{$profileId}",
                'trainingTypeIds' => array_map(fn(array $type): int => (int) $type['training_type_id'], $types),
                'approvalStatus' => $row['approval_status'],
                'approvalNote' => $row['approval_note'],
                'certificates' => array_map(fn(array $certificate): array => [
                    'id' => (int) $certificate['id'],
                    'name' => $certificate['name'],
                    'issuer' => $certificate['issuer'],
                    'issuedYear' => $certificate['issued_year'] === null ? null : (int) $certificate['issued_year'],
                    'status' => $certificate['status'],
                ], $certificates),
            ],
        ];
    }

    private static function blankToNull(string $value): ?string
    {
        return $value === '' ? null : $value;
    }

    private static function accountImageUrl(string $role, int $userId, mixed $path): ?string
    {
        if ($path === null || trim((string) $path) === '') return null;
        $path = (string) $path;
        if (str_starts_with($path, 'uploads/profile-images/')) {
            return "/v1/profile-images/{$role}/{$userId}";
        }
        return $path;
    }

    private function trainerRow(string $where, array $params): ?array
    {
        return $this->database->fetchOne(
            'SELECT tp.id, tp.user_id, tp.slug, tp.headline, tp.bio, tp.years_experience, tp.service_mode,
                    tp.gym_name, tp.price_from, tp.monthly_price, tp.monthly_session_count, tp.payment_qr_path, tp.approval_status, tp.image_path, tp.is_demo,
                    u.display_name,
                    AVG(CASE WHEN review_booking.id IS NOT NULL THEN r.rating END) AS rating,
                    COUNT(review_booking.id) AS review_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN reviews r ON r.trainer_profile_id = tp.id AND r.status = "published"
             LEFT JOIN bookings review_booking ON review_booking.id = r.booking_id AND review_booking.status = "completed"
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
            'monthlyPrice' => $row['monthly_price'] === null ? null : (float) $row['monthly_price'],
            'monthlySessionCount' => $row['monthly_session_count'] === null ? null : (int) $row['monthly_session_count'],
            'paymentQrUrl' => empty($row['payment_qr_path']) ? null : "/v1/trainer-payment-qr/{$profileId}",
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
            'image' => self::accountImageUrl('trainer', (int) $row['user_id'], $row['image_path']),
            'demo' => (bool) $row['is_demo'],
        ];
    }

    private function bookingPayload(array $row, string $role, array $sessions = []): array
    {
        $acceptedStatuses = ['awaiting_payment', 'payment_review', 'confirmed'];
        $isMember = $role === 'member';
        $isTrainer = $role === 'trainer';
        $hasReview = $row['review_id'] !== null;
        $appointmentEnded = strtotime($row['ends_at'] . ' UTC') <= time();
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
            'paymentRecipient' => $isMember && !empty($row['payment_account_name']) && !empty($row['promptpay_id']) ? [
                'accountName' => $row['payment_account_name'],
                'promptPayId' => $row['promptpay_id'],
            ] : null,
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
                    && $status === 'awaiting_payment'
                    && $row['payment_deadline_at'] !== null
                    && strtotime($row['payment_deadline_at'] . ' UTC') > time(),
                'canReadChat' => $role !== 'admin',
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
                'canCancel' => $isMember
                    && $status === 'awaiting_payment'
                    && in_array($row['payment_status'], ['not_submitted', 'rejected'], true)
                    && $row['payment_deadline_at'] !== null
                    && strtotime($row['payment_deadline_at'] . ' UTC') > time(),
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

    private function serveUploadedImage(string $relativePath, string $directory, string $filename, bool $cache): never
    {
        $uploadRoot = realpath(dirname(__DIR__) . '/uploads/' . $directory);
        $target = realpath(dirname(__DIR__) . '/' . ltrim($relativePath, '/\\'));
        if ($uploadRoot === false || $target === false || !str_starts_with($target, $uploadRoot . DIRECTORY_SEPARATOR) || !is_file($target)) {
            throw new HttpException(404, 'ไม่พบรูปภาพ', 'IMAGE_NOT_FOUND');
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($target);
        if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) {
            throw new HttpException(404, 'ไม่พบรูปภาพ', 'IMAGE_NOT_FOUND');
        }
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($target));
        header('Content-Disposition: inline; filename="' . $filename . '"');
        header('Cache-Control: ' . ($cache ? 'public, max-age=86400' : 'no-store'));
        header('X-Content-Type-Options: nosniff');
        readfile($target);
        exit;
    }

    private function iso(string $value): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', strtotime($value . ' UTC'));
    }
}
