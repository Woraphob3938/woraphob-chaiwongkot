<?php
declare(strict_types=1);

/** Trainer storefront, workspace, availability slots, gallery, application and statistics. Part of Handlers. */
trait TrainerHandlers
{
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
        $rows = $this->trainerRows(
            'tp.approval_status = "approved" AND u.status = "active" AND tp.price_from > 0',
            [],
            'ORDER BY tp.is_demo ASC, tp.updated_at DESC'
        );
        Http::json(array_map(fn(array $row): array => $this->trainerPayload($row), $rows), 200, ['count' => count($rows)]);
    }

    public function trainer(string $slug): never
    {
        $row = $this->trainerRows('tp.slug = ? AND u.status = "active"', [$slug], 'LIMIT 1')[0] ?? null;
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
        $price = WorkflowRules::normalizeMoney(Http::stringField($input, 'priceFrom'), 'priceFrom');
        $this->database->execute(
            'UPDATE trainer_profiles SET price_from = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?',
            [$price, $user['id']]
        );
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
            'certificates' => array_map(self::certificatePayload(...), $certificates),
            'slots' => array_map(fn(array $slot): array => [
                'id' => (int) $slot['id'],
                'startsAt' => $this->iso($slot['starts_at']),
                'endsAt' => $this->iso($slot['ends_at']),
                'state' => $slot['state'],
            ], $slots),
        ]);
    }

    /** The trainer's own profile id, for endpoints that act on it. */
    private function ownTrainerProfileId(PDO $pdo, array $user): int
    {
        $statement = $pdo->prepare('SELECT id FROM trainer_profiles WHERE user_id = ?');
        $statement->execute([(int) $user['id']]);
        $id = $statement->fetchColumn();
        if ($id === false) {
            throw new HttpException(404, 'ยังไม่มีโปรไฟล์เทรนเนอร์', 'TRAINER_PROFILE_NOT_FOUND');
        }
        return (int) $id;
    }

    public function trainerMembers(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $profileId = $this->ownTrainerProfileId($this->database->pdo(), $user);
        $rows = $this->database->fetchAll(
            'SELECT b.public_id, b.status, b.booking_type, b.session_count,
                    COALESCE(b.confirmed_starts_at, b.starts_at) AS starts_at,
                    COALESCE(b.confirmed_ends_at, b.ends_at) AS ends_at,
                    b.quoted_price, b.created_at,
                    b.member_user_id, u.display_name, mp.image_path, mp.goals, mp.experience_level
             FROM bookings b
             JOIN users u ON u.id = b.member_user_id
             LEFT JOIN member_profiles mp ON mp.user_id = b.member_user_id
             WHERE b.trainer_profile_id = ?
             ORDER BY b.created_at DESC, b.id DESC
             LIMIT 500',
            [$profileId]
        );
        $members = [];
        $now = time();
        foreach ($rows as $row) {
            $memberId = (int) $row['member_user_id'];
            if (!isset($members[$memberId])) {
                $members[$memberId] = [
                    'id' => $memberId,
                    'displayName' => $row['display_name'],
                    'imageUrl' => self::accountImageUrl('member', $memberId, $row['image_path'] ?? null),
                    'goals' => $row['goals'] ?? null,
                    'experienceLevel' => $row['experience_level'] ?? null,
                    'totalBookings' => 0,
                    'completedSessions' => 0,
                    'activeBookings' => 0,
                    'nextSessionAt' => null,
                    'lastSessionAt' => null,
                    'history' => [],
                ];
            }
            $member = &$members[$memberId];
            $member['totalBookings']++;
            $status = (string) $row['status'];
            $startsAt = strtotime($row['starts_at'] . ' UTC');
            if ($status === 'completed') {
                $member['completedSessions'] += max(1, (int) $row['session_count']);
                if ($member['lastSessionAt'] === null || $startsAt > strtotime($member['lastSessionAt'])) {
                    $member['lastSessionAt'] = $this->iso($row['starts_at']);
                }
            }
            if (in_array($status, ['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed'], true)) {
                $member['activeBookings']++;
                if ($startsAt > $now && ($member['nextSessionAt'] === null || $startsAt < strtotime($member['nextSessionAt']))) {
                    $member['nextSessionAt'] = $this->iso($row['starts_at']);
                }
            }
            if (count($member['history']) < 20) {
                $member['history'][] = [
                    'id' => $row['public_id'],
                    'status' => $status,
                    'bookingType' => $row['booking_type'] ?? 'single',
                    'sessionCount' => (int) $row['session_count'],
                    'startsAt' => $this->iso($row['starts_at']),
                    'endsAt' => $this->iso($row['ends_at']),
                    'quotedPrice' => $row['quoted_price'] === null ? null : (float) $row['quoted_price'],
                ];
            }
            unset($member);
        }
        Http::json(array_values($members));
    }

    /** บทที่ 3.1.3 ข้อ 7: the trainer's reviews with the average score. */
    public function trainerReviews(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $profileId = $this->ownTrainerProfileId($this->database->pdo(), $user);
        $summary = $this->database->fetchOne(
            'SELECT COUNT(*) AS total, AVG(rating) AS average,
                    SUM(rating = 5) AS five, SUM(rating = 4) AS four, SUM(rating = 3) AS three,
                    SUM(rating = 2) AS two, SUM(rating = 1) AS one
             FROM reviews WHERE trainer_profile_id = ? AND status = "published"',
            [$profileId]
        ) ?? [];
        $rows = $this->database->fetchAll(
            'SELECT r.id, r.rating, r.comment, r.created_at, b.public_id, u.display_name
             FROM reviews r
             JOIN bookings b ON b.id = r.booking_id
             JOIN users u ON u.id = r.member_user_id
             WHERE r.trainer_profile_id = ? AND r.status = "published"
             ORDER BY r.created_at DESC, r.id DESC LIMIT 50',
            [$profileId]
        );
        Http::json([
            'count' => (int) ($summary['total'] ?? 0),
            'average' => ($summary['average'] ?? null) === null ? null : round((float) $summary['average'], 1),
            'distribution' => [
                5 => (int) ($summary['five'] ?? 0),
                4 => (int) ($summary['four'] ?? 0),
                3 => (int) ($summary['three'] ?? 0),
                2 => (int) ($summary['two'] ?? 0),
                1 => (int) ($summary['one'] ?? 0),
            ],
            'reviews' => array_map(fn(array $row): array => [
                'id' => (int) $row['id'],
                'rating' => (int) $row['rating'],
                'comment' => $row['comment'],
                'createdAt' => $this->iso($row['created_at']),
                'bookingId' => $row['public_id'],
                'memberName' => $row['display_name'],
            ], $rows),
        ]);
    }

    public function createAvailabilitySlot(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $input = Http::body();
        Http::requireFields($input, ['startsAt']);
        $startsAt = WorkflowRules::parseUtc(Http::stringField($input, 'startsAt'), 'startsAt');
        $endsAt = WorkflowRules::availabilityEnd($startsAt);
        WorkflowRules::assertAvailabilityWindow(self::utc(), $startsAt, $endsAt);

        $slotId = $this->database->transaction(function (PDO $pdo) use ($user, $startsAt, $endsAt): int {
            $profile = $this->database->fetchOne(
                'SELECT id, approval_status FROM trainer_profiles WHERE user_id = ? FOR UPDATE',
                [$user['id']]
            );
            if (!$profile || $profile['approval_status'] !== 'approved') {
                throw new HttpException(403, 'เทรนเนอร์ต้องได้รับการอนุมัติก่อนสร้างตาราง', 'TRAINER_NOT_APPROVED');
            }
            $this->assertSlotFree((int) $profile['id'], $startsAt, $endsAt);
            $pdo->prepare('INSERT INTO availability_slots (trainer_profile_id, starts_at, ends_at, state) VALUES (?, ?, ?, "available")')
                ->execute([(int) $profile['id'], $startsAt->format('Y-m-d H:i:s'), $endsAt->format('Y-m-d H:i:s')]);
            return (int) $pdo->lastInsertId();
        });

        Http::json(self::slotPayload($slotId, $startsAt, $endsAt), 201);
    }

    /** The trainer's own slot, locked for the running transaction. */
    private function ownSlotForUpdate(string $slotId, array $user): array
    {
        $slot = $this->database->fetchOne(
            'SELECT s.id, s.trainer_profile_id, s.starts_at, s.state, tp.approval_status
             FROM availability_slots s
             JOIN trainer_profiles tp ON tp.id = s.trainer_profile_id
             WHERE s.id = ? AND tp.user_id = ? FOR UPDATE',
            [(int) $slotId, $user['id']]
        );
        if (!$slot) {
            throw new HttpException(404, 'ไม่พบช่วงเวลาว่าง', 'SLOT_NOT_FOUND');
        }
        if ($slot['approval_status'] !== 'approved') {
            throw new HttpException(403, 'เทรนเนอร์ยังไม่ได้รับการอนุมัติ', 'TRAINER_NOT_APPROVED');
        }
        return $slot;
    }

    /** Refuses a window that overlaps another slot of the same trainer. */
    private function assertSlotFree(int $profileId, DateTimeImmutable $startsAt, DateTimeImmutable $endsAt, int $exceptSlotId = 0): void
    {
        $overlap = $this->database->fetchOne(
            'SELECT id FROM availability_slots
             WHERE trainer_profile_id = ? AND id <> ? AND starts_at < ? AND ends_at > ? LIMIT 1',
            [$profileId, $exceptSlotId, $endsAt->format('Y-m-d H:i:s'), $startsAt->format('Y-m-d H:i:s')]
        );
        if ($overlap) {
            throw new HttpException(409, 'ช่วงเวลานี้ทับกับตารางที่มีอยู่', 'SLOT_OVERLAP');
        }
    }

    private static function slotPayload(int $id, DateTimeImmutable $startsAt, DateTimeImmutable $endsAt): array
    {
        return [
            'id' => $id,
            'startsAt' => $startsAt->format('Y-m-d\TH:i:s.000\Z'),
            'endsAt' => $endsAt->format('Y-m-d\TH:i:s.000\Z'),
            'state' => 'available',
        ];
    }

    public function deleteAvailabilitySlot(string $slotId): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $this->database->transaction(function (PDO $pdo) use ($slotId, $user): void {
            $slot = $this->ownSlotForUpdate($slotId, $user);
            if ($slot['state'] !== 'available' || strtotime($slot['starts_at'] . ' UTC') <= time()) {
                throw new HttpException(409, 'ลบได้เฉพาะช่วงเวลาในอนาคตที่ยังว่าง', 'SLOT_NOT_DELETABLE');
            }
            $pdo->prepare('DELETE FROM availability_slots WHERE id = ?')->execute([(int) $slot['id']]);
        });

        Http::json(['id' => (int) $slotId, 'deleted' => true]);
    }

    public function updateAvailabilitySlot(string $slotId): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $input = Http::body();
        Http::requireFields($input, ['startsAt']);
        $startsAt = WorkflowRules::parseUtc(Http::stringField($input, 'startsAt'), 'startsAt');
        $endsAt = WorkflowRules::availabilityEnd($startsAt);

        $this->database->transaction(function (PDO $pdo) use ($slotId, $user, $startsAt, $endsAt): void {
            $slot = $this->ownSlotForUpdate($slotId, $user);
            $now = self::utc();
            WorkflowRules::assertSlotEditable((string) $slot['state'], self::utc((string) $slot['starts_at']), $now);
            WorkflowRules::assertAvailabilityWindow($now, $startsAt, $endsAt);
            $this->assertSlotFree((int) $slot['trainer_profile_id'], $startsAt, $endsAt, (int) $slot['id']);
            $pdo->prepare('UPDATE availability_slots SET starts_at = ?, ends_at = ? WHERE id = ?')
                ->execute([$startsAt->format('Y-m-d H:i:s'), $endsAt->format('Y-m-d H:i:s'), (int) $slot['id']]);
        });

        Http::json(self::slotPayload((int) $slotId, $startsAt, $endsAt));
    }

    public const MAX_TRAINER_PHOTOS = 6;

    /** The trainer's own gallery, for the profile manager. */
    public function trainerPhotos(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $profile = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ?', [$user['id']]);
        if (!$profile) throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'PROFILE_NOT_FOUND');
        Http::json(['photos' => $this->trainerPhotoList((int) $profile['id']), 'max' => self::MAX_TRAINER_PHOTOS]);
    }

    public function uploadTrainerPhoto(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $upload = $this->saveImageUpload('trainer-photos');
        try {
            $profileId = $this->database->transaction(function (PDO $pdo) use ($user, $upload): int {
                $profile = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ? FOR UPDATE', [$user['id']]);
                if (!$profile) throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'PROFILE_NOT_FOUND');
                $count = $pdo->prepare('SELECT COUNT(*), COALESCE(MAX(sort_order), 0) FROM trainer_photos WHERE trainer_profile_id = ?');
                $count->execute([$profile['id']]);
                [$total, $maxOrder] = $count->fetch(PDO::FETCH_NUM);
                if ((int) $total >= self::MAX_TRAINER_PHOTOS) {
                    throw new HttpException(422, 'เพิ่มรูปได้สูงสุด ' . self::MAX_TRAINER_PHOTOS . ' รูป', 'VALIDATION_FAILED', ['image' => 'ลบรูปเดิมก่อนเพิ่มรูปใหม่']);
                }
                $pdo->prepare('INSERT INTO trainer_photos (trainer_profile_id, path, sort_order) VALUES (?, ?, ?)')
                    ->execute([$profile['id'], $upload['path'], (int) $maxOrder + 1]);
                return (int) $profile['id'];
            });
        } catch (Throwable $error) {
            $this->removeUpload($upload['path']);
            throw $error;
        }
        Http::json(['photos' => $this->trainerPhotoList($profileId), 'max' => self::MAX_TRAINER_PHOTOS], 201);
    }

    public function deleteTrainerPhoto(string $photoId): never
    {
        $user = $this->auth->requireUser(['trainer']);
        [$profileId, $path] = $this->database->transaction(function (PDO $pdo) use ($user, $photoId): array {
            $photo = $this->database->fetchOne(
                'SELECT p.id, p.path, p.trainer_profile_id FROM trainer_photos p
                 JOIN trainer_profiles tp ON tp.id = p.trainer_profile_id
                 WHERE p.id = ? AND tp.user_id = ? FOR UPDATE',
                [(int) $photoId, $user['id']]
            );
            if (!$photo) throw new HttpException(404, 'ไม่พบรูปนี้', 'PHOTO_NOT_FOUND');
            $pdo->prepare('DELETE FROM trainer_photos WHERE id = ?')->execute([$photo['id']]);
            return [(int) $photo['trainer_profile_id'], (string) $photo['path']];
        });
        $this->removeUpload($path);
        Http::json(['photos' => $this->trainerPhotoList($profileId), 'max' => self::MAX_TRAINER_PHOTOS]);
    }

    /** Public: gallery photos of an approved trainer. */
    public function trainerPhoto(string $photoId): never
    {
        $record = $this->database->fetchOne(
            'SELECT p.path FROM trainer_photos p JOIN trainer_profiles tp ON tp.id = p.trainer_profile_id WHERE p.id = ?',
            [(int) $photoId]
        );
        if (!$record || !str_starts_with((string) $record['path'], 'uploads/trainer-photos/')) {
            throw new HttpException(404, 'ไม่พบรูปภาพ', 'IMAGE_NOT_FOUND');
        }
        $this->serveUploadedImage((string) $record['path'], 'trainer-photos', 'fitconnect-trainer-photo-' . (int) $photoId, true);
    }

    public function trainerApplication(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        // One form owns the whole professional record. It previously accepted a
        // fraction of it and wrote the free-text "experience" into bio, which is
        // why a new trainer had to fill in a second surface before the storefront
        // made sense.
        // ProfileRules reads every professional field as text, so a list sent for
        // one of them is refused here rather than cast to the literal "Array";
        // `trainingTypeIds` is the field the form sends as a list.
        Http::assertTextFields(Http::body(), [
            'displayName', 'legalName', 'nickname', 'phone', 'headline', 'bio', 'serviceMode', 'gymName', 'education',
            'birthDate', 'yearsExperience', 'priceFrom',
            'monthlyPrice', 'monthlySessionCount',
        ]);
        $profile = ProfileRules::trainer(Http::body());
        $this->rateLimiter->hit(RateLimiter::TRAINER_APPLICATION, 'user:' . $user['id']);
        $certificate = $this->saveUpload('certificate', ['application/pdf'], 8 * 1024 * 1024, 'certificates', false);
        $replacedCertificatePaths = [];
        try {
            $profileId = $this->database->transaction(function (PDO $pdo) use ($user, $profile, $certificate, &$replacedCertificatePaths): int {
                $stored = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ? FOR UPDATE', [$user['id']]);

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
                $this->assertActiveTrainingTypes($typeIds);

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
                     SET legal_name = ?, nickname = ?, phone = ?, birth_date = ?, education = ?, headline = ?, bio = ?, years_experience = ?,
                         service_mode = ?, gym_name = ?, price_from = ?, monthly_price = ?, monthly_session_count = ?,
                         approval_status = "pending", approval_note = NULL, reviewed_by_user_id = NULL, reviewed_at = NULL,
                         updated_at = UTC_TIMESTAMP()
                     WHERE id = ?'
                )->execute([
                    $profile['legalName'], self::blankToNull($profile['nickname']), self::blankToNull($profile['phone']), $profile['birthDate'],
                    self::blankToNull($profile['education']), self::blankToNull($profile['headline']),
                    self::blankToNull($profile['bio']), $profile['yearsExperience'], $profile['serviceMode'],
                    $profile['serviceMode'] === 'freelance' ? null : self::blankToNull($profile['gymName']),
                    $profile['priceFrom'], $profile['monthlyPrice'], $profile['monthlySessionCount'], $profileId,
                ]);
                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$profile['displayName'], $user['id']]);

                $this->replaceTrainingTypes($pdo, $profileId, $typeIds);

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

    public function trainerStats(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $year = self::reportYear($_GET['year'] ?? null);
        $rangeStart = sprintf('%04d-01-01 00:00:00', $year);
        $rangeEnd = sprintf('%04d-01-01 00:00:00', $year + 1);
        $profile = $this->database->fetchOne(
            'SELECT id, service_mode FROM trainer_profiles WHERE user_id = ?',
            [$user['id']]
        );
        if (!$profile) {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'PROFILE_NOT_FOUND');
        }

        $bookingsByMonth = [];
        $incomeByMonth = [];
        foreach (self::monthKeys($year) as $month) {
            $bookingsByMonth[$month] = ['month' => $month, 'total' => 0];
            $incomeByMonth[$month] = ['month' => $month, 'amount' => 0.0];
        }

        $bookingRows = $this->database->fetchAll(
            'SELECT DATE_FORMAT(b.created_at, "%Y-%m") AS month, COUNT(*) AS total
             FROM bookings b
             WHERE b.trainer_profile_id = ? AND b.created_at >= ? AND b.created_at < ?
             GROUP BY month',
            [(int) $profile['id'], $rangeStart, $rangeEnd]
        );
        foreach ($bookingRows as $row) {
            $month = (string) $row['month'];
            if (isset($bookingsByMonth[$month])) {
                $bookingsByMonth[$month]['total'] = (int) $row['total'];
            }
        }

        // Income on the dashboard is the freelance money paid straight to the
        // trainer. Gym sessions are paid to the gym and appear in the salary
        // summary below instead (บทที่ 3.1.3 ข้อ 9).
        $incomeRows = $this->database->fetchAll(
            'SELECT DATE_FORMAT(pay.submitted_at, "%Y-%m") AS month,
                    COALESCE(SUM(pay.amount), 0) AS amount
             FROM payments pay
             JOIN bookings b ON b.id = pay.booking_id
             WHERE b.trainer_profile_id = ? AND pay.status = "approved"
               AND (b.payment_service_mode = "freelance" OR b.payment_service_mode IS NULL)
               AND pay.submitted_at >= ? AND pay.submitted_at < ?
             GROUP BY month',
            [(int) $profile['id'], $rangeStart, $rangeEnd]
        );
        foreach ($incomeRows as $row) {
            $month = (string) $row['month'];
            if (isset($incomeByMonth[$month])) {
                $incomeByMonth[$month]['amount'] = (float) $row['amount'];
            }
        }

        // Gym salary accrual only exists for gym/both trainers: approved gym
        // payments on confirmed or completed bookings, by session month.
        $salarySummary = null;
        if (in_array($profile['service_mode'], ['gym', 'both'], true)) {
            $salaryRows = $this->database->fetchAll(
                'SELECT DATE_FORMAT(b.starts_at, "%Y-%m") AS month,
                        COALESCE(SUM(b.session_count), 0) AS sessions,
                        COALESCE(SUM(pay.amount), 0) AS amount
                 FROM payments pay
                 JOIN bookings b ON b.id = pay.booking_id
                 WHERE b.trainer_profile_id = ? AND pay.status = "approved"
                   AND b.payment_service_mode = "gym"
                   AND b.status IN ("confirmed", "completed")
                   AND b.starts_at >= ? AND b.starts_at < ?
                 GROUP BY month ORDER BY month',
                [(int) $profile['id'], $rangeStart, $rangeEnd]
            );
            $salarySummary = array_map(static fn(array $row): array => [
                'month' => (string) $row['month'],
                'sessions' => (int) $row['sessions'],
                'amount' => (float) $row['amount'],
            ], $salaryRows);
        }

        Http::json([
            'year' => $year,
            'bookingsByMonth' => array_values($bookingsByMonth),
            'incomeByMonth' => array_values($incomeByMonth),
            'totals' => [
                'bookings' => array_sum(array_map(static fn(array $row): int => $row['total'], $bookingsByMonth)),
                'income' => array_sum(array_map(static fn(array $row): float => $row['amount'], $incomeByMonth)),
            ],
            'salarySummary' => $salarySummary,
        ]);
    }

    private function assertActiveTrainingTypes(array $typeIds): void
    {
        $active = $this->database->fetchAll(
            'SELECT id FROM training_types WHERE active = 1 AND id IN (' . self::marks($typeIds) . ')',
            $typeIds
        );
        if (count($active) !== count($typeIds)) {
            throw new HttpException(422, 'ประเภทการฝึกไม่ถูกต้อง', 'VALIDATION_FAILED', [
                'trainingTypeIds' => 'เลือกประเภทการฝึกที่เปิดใช้งาน',
            ]);
        }
    }

    private function replaceTrainingTypes(PDO $pdo, int $profileId, array $typeIds): void
    {
        $pdo->prepare('DELETE FROM trainer_training_types WHERE trainer_profile_id = ?')->execute([$profileId]);
        $insert = $pdo->prepare('INSERT INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES (?, ?)');
        foreach ($typeIds as $typeId) {
            $insert->execute([$profileId, $typeId]);
        }
    }

    private static function certificatePayload(array $certificate): array
    {
        return [
            'id' => (int) $certificate['id'],
            'name' => $certificate['name'],
            'issuer' => $certificate['issuer'],
            'issuedYear' => $certificate['issued_year'] === null ? null : (int) $certificate['issued_year'],
            'status' => $certificate['status'],
        ];
    }

    private function trainerRows(string $where, array $params, string $tail): array
    {
        return $this->database->fetchAll(
            'SELECT tp.id, tp.user_id, tp.slug, tp.nickname, tp.headline, tp.bio, tp.years_experience, tp.service_mode,
                    tp.gym_name, tp.price_from, tp.monthly_price, tp.monthly_session_count, tp.approval_status, tp.image_path, tp.is_demo,
                    u.display_name,
                    AVG(CASE WHEN review_booking.id IS NOT NULL THEN r.rating END) AS rating,
                    COUNT(review_booking.id) AS review_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN reviews r ON r.trainer_profile_id = tp.id AND r.status = "published"
             LEFT JOIN bookings review_booking ON review_booking.id = r.booking_id AND review_booking.status = "completed"
             WHERE ' . $where . ' GROUP BY tp.id ' . $tail,
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
            'nickname' => ($row['nickname'] ?? null) ?: null,
            'headline' => $row['headline'] ?? 'เทรนเนอร์ FitConnect',
            'bio' => $row['bio'] ?? '',
            'yearsExperience' => (int) $row['years_experience'],
            'trainingTypes' => array_map(fn(array $type): array => ['id' => (int) $type['id'], 'slug' => $type['slug'], 'nameTh' => $type['name_th']], $types),
            'serviceMode' => $row['service_mode'],
            'gymName' => $row['gym_name'],
            'priceFrom' => $row['price_from'] === null ? null : (float) $row['price_from'],
            'monthlyPrice' => $row['monthly_price'] === null ? null : (float) $row['monthly_price'],
            'monthlySessionCount' => $row['monthly_session_count'] === null ? null : (int) $row['monthly_session_count'],
            'rating' => $row['rating'] === null ? null : round((float) $row['rating'], 1),
            'reviewCount' => (int) $row['review_count'],
            'verification' => $row['approval_status'] === 'approved' ? 'verified' : $row['approval_status'],
            'certificates' => array_map(self::certificatePayload(...), $certificates),
            'slots' => array_map(fn(array $slot): array => [
                'id' => (int) $slot['id'], 'startsAt' => $this->iso($slot['starts_at']), 'endsAt' => $this->iso($slot['ends_at']),
                'available' => true,
            ], $slots),
            'image' => self::accountImageUrl('trainer', (int) $row['user_id'], $row['image_path']),
            'photos' => $this->trainerPhotoList($profileId),
            'demo' => (bool) $row['is_demo'],
        ];
    }

    /**
     * Extra photos a trainer shows members on the profile page, in the order
     * they were added. A database without the photos table yet has none.
     *
     * @return list<array{id: int, url: string}>
     */
    private function trainerPhotoList(int $profileId): array
    {
        try {
            $rows = $this->database->fetchAll(
                'SELECT id FROM trainer_photos WHERE trainer_profile_id = ? ORDER BY sort_order, id',
                [$profileId]
            );
        } catch (PDOException) {
            return [];
        }
        return array_map(fn(array $photo): array => [
            'id' => (int) $photo['id'],
            'url' => '/v1/trainer-photos/' . (int) $photo['id'],
        ], $rows);
    }
}
