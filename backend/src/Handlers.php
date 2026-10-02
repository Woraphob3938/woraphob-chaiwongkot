<?php
declare(strict_types=1);
require_once __DIR__ . '/PaymentRouting.php';

final class Handlers
{
    private Auth $auth;
    private NotificationService $notifications;
    private RateLimiter $rateLimiter;
    private ?StripeClient $stripeClient = null;
    /** @var list<array{0: string, 1: ?string}> */
    private array $checkoutsToExpire = [];

    public function __construct(
        private readonly Database $database,
        private readonly array $config
    ) {
        $this->auth = new Auth($database);
        $this->notifications = new NotificationService($database, $config);
        $this->rateLimiter = new RateLimiter($database);
        // Checkout Sessions of bookings closed during this request are expired
        // in Stripe once the database work is committed.
        register_shutdown_function(function (): void {
            $ids = $this->checkoutsToExpire;
            $this->checkoutsToExpire = [];
            $this->expireCheckoutSessions($ids);
        });
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

    public function register(): never
    {
        $input = Http::body();
        $this->rateLimiter->hit(RateLimiter::REGISTER, RateLimiter::clientKey());
        Http::json($this->auth->register($input), 201);
    }

    public function login(): never
    {
        $input = Http::body();
        $account = RateLimiter::accountKey(Http::stringField($input, 'email'));
        // Counted per account and per address: the first stops a password guess
        // against one mailbox, the second stops a sweep across many.
        $this->rateLimiter->hit(RateLimiter::LOGIN, $account);
        $this->rateLimiter->hit(RateLimiter::LOGIN, RateLimiter::clientKey());
        $result = $this->auth->login($input);
        $this->rateLimiter->clear(RateLimiter::LOGIN, $account);
        // The address window is shared by everyone behind one network, so a
        // successful sign-in must give its attempt back too: otherwise ten
        // ordinary logins from one office lock every member of it out for fifteen
        // minutes. Failures still spend the window, which is what stops a sweep.
        $this->rateLimiter->clear(RateLimiter::LOGIN, RateLimiter::clientKey());
        Http::json($result);
    }

    public function forgotPassword(): never
    {
        $input = Http::body();
        Http::assertTextFields($input, ['email']);
        $account = RateLimiter::accountKey(Http::stringField($input, 'email'));
        $this->rateLimiter->hit(RateLimiter::PASSWORD_RESET_REQUEST, $account);
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
        Http::assertTextFields($input, ['email', 'code', 'newPassword']);
        $account = RateLimiter::accountKey(Http::stringField($input, 'email'));
        $this->rateLimiter->hit(RateLimiter::PASSWORD_RESET_CONFIRM, $account);
        $result = $this->auth->resetPassword($input);
        $this->rateLimiter->clear(RateLimiter::PASSWORD_RESET_CONFIRM, $account);
        $this->rateLimiter->clear(RateLimiter::LOGIN, $account);
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
        $request = Http::body();
        // ProfileRules reads these as text; a list sent for one of them would be
        // cast to the literal "Array" and saved. `trainingTypeIds` is the one
        // profile field that is meant to be an array, so it is not listed.
        Http::assertTextFields($request, [
            'firstName', 'lastName', 'phone', 'fitnessGoal', 'experienceLevel', 'weight', 'height', 'birthDate',
            'displayName', 'legalName', 'nickname', 'headline', 'bio', 'serviceMode', 'gymName', 'education',
            'yearsExperience', 'priceFrom', 'monthlyPrice',
            'monthlySessionCount',
        ]);

        if ($user['role'] === 'member') {
            $stored = $this->database->fetchOne(
                'SELECT u.display_name, mp.first_name, mp.last_name, mp.phone, mp.goals, mp.experience_level,
                        mp.weight, mp.height, mp.birth_date
                 FROM users u JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = ?',
                [$user['id']]
            );
            if (!$stored) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์สมาชิก', 'PROFILE_NOT_FOUND');
            }
            $storedFirstName = trim((string) ($stored['first_name'] ?? ''));
            // Members registered before member_profiles carried a name keep theirs
            // only in users.display_name, so the form shows that fallback; merging
            // it back keeps a save that omits the names working like the form.
            $input = self::mergeProfileInput($request, [
                'firstName' => $storedFirstName === '' ? (string) $stored['display_name'] : $storedFirstName,
                'lastName' => $stored['last_name'] ?? '',
                'phone' => $stored['phone'] ?? '',
                'fitnessGoal' => $stored['goals'] ?? '',
                'experienceLevel' => $stored['experience_level'] ?? '',
                'weight' => $stored['weight'],
                'height' => $stored['height'],
                'birthDate' => $stored['birth_date'],
            ]);
            $profile = ProfileRules::member($input);
            $displayName = trim($profile['firstName'] . ' ' . $profile['lastName']);
            $this->database->transaction(function (PDO $pdo) use ($user, $profile, $displayName): void {
                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$displayName, $user['id']]);
                $pdo->prepare(
                    'UPDATE member_profiles
                     SET first_name = ?, last_name = ?, phone = ?, goals = ?, experience_level = ?,
                         weight = ?, height = ?, birth_date = ?, updated_at = UTC_TIMESTAMP()
                     WHERE user_id = ?'
                )->execute([
                    $profile['firstName'], $profile['lastName'], self::blankToNull($profile['phone']),
                    self::blankToNull($profile['fitnessGoal']), self::blankToNull($profile['experienceLevel']),
                    $profile['weight'], $profile['height'], $profile['birthDate'], $user['id'],
                ]);
            });
        } else {
            $stored = $this->database->fetchOne(
                'SELECT tp.id, tp.legal_name, tp.nickname, tp.phone, tp.birth_date, tp.education, tp.headline, tp.bio,
                        tp.years_experience, tp.service_mode, tp.gym_name, tp.price_from, tp.monthly_price,
                        tp.monthly_session_count, u.display_name
                 FROM users u JOIN trainer_profiles tp ON tp.user_id = u.id WHERE u.id = ?',
                [$user['id']]
            );
            if (!$stored) {
                throw new HttpException(409, 'กรอกข้อมูลสมัครเทรนเนอร์ก่อนแก้โปรไฟล์', 'TRAINER_PROFILE_REQUIRED');
            }
            $storedTypes = $this->database->fetchAll(
                'SELECT training_type_id FROM trainer_training_types WHERE trainer_profile_id = ? ORDER BY training_type_id',
                [(int) $stored['id']]
            );
            $input = self::mergeProfileInput($request, [
                'displayName' => (string) $stored['display_name'],
                'legalName' => $stored['legal_name'] ?? '',
                'nickname' => $stored['nickname'] ?? '',
                'phone' => $stored['phone'] ?? '',
                'birthDate' => $stored['birth_date'],
                'education' => $stored['education'] ?? '',
                'headline' => $stored['headline'] ?? '',
                'bio' => $stored['bio'] ?? '',
                'yearsExperience' => $stored['years_experience'],
                'serviceMode' => $stored['service_mode'],
                'gymName' => $stored['gym_name'] ?? '',
                'priceFrom' => $stored['price_from'],
                'monthlyPrice' => $stored['monthly_price'],
                'monthlySessionCount' => $stored['monthly_session_count'],
                'trainingTypeIds' => array_map(
                    fn(array $row): int => (int) $row['training_type_id'],
                    $storedTypes
                ),
            ]);
            $profile = ProfileRules::trainer($input);
            $this->database->transaction(function (PDO $pdo) use ($user, $profile): void {
                $trainerProfile = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ? FOR UPDATE', [$user['id']]);
                if (!$trainerProfile) {
                    throw new HttpException(409, 'กรอกข้อมูลสมัครเทรนเนอร์ก่อนแก้โปรไฟล์', 'TRAINER_PROFILE_REQUIRED');
                }

                $typeIds = $profile['trainingTypeIds'];
                $this->assertActiveTrainingTypes($typeIds);

                $pdo->prepare('UPDATE users SET display_name = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$profile['displayName'], $user['id']]);
                $pdo->prepare(
                    'UPDATE trainer_profiles
                     SET legal_name = ?, nickname = ?, phone = ?, birth_date = ?, education = ?, headline = ?, bio = ?, years_experience = ?,
                         service_mode = ?, gym_name = ?, price_from = ?, monthly_price = ?, monthly_session_count = ?,
                         updated_at = UTC_TIMESTAMP()
                     WHERE id = ?'
                )->execute([
                    $profile['legalName'], self::blankToNull($profile['nickname']), self::blankToNull($profile['phone']), $profile['birthDate'],
                    self::blankToNull($profile['education']), self::blankToNull($profile['headline']),
                    self::blankToNull($profile['bio']), $profile['yearsExperience'], $profile['serviceMode'],
                    $profile['serviceMode'] === 'freelance' ? null : $profile['gymName'], $profile['priceFrom'],
                    $profile['monthlyPrice'], $profile['monthlySessionCount'],
                    (int) $trainerProfile['id'],
                ]);
                $this->replaceTrainingTypes($pdo, (int) $trainerProfile['id'], $typeIds);
            });
        }

        Http::json($this->accountProfilePayload(['id' => $user['id'], 'role' => $user['role']]));
    }

    /**
     * PATCH is a partial update: the keys the request carries win, every other
     * field keeps the stored value. Replacing the whole row meant a client that
     * omitted an optional field — a phone number, a headline — silently wiped it,
     * which is not what an omitted field means in a PATCH.
     */
    private static function mergeProfileInput(array $request, array $stored): array
    {
        foreach ($request as $field => $value) {
            if (array_key_exists($field, $stored)) {
                $stored[$field] = $value;
            }
        }
        return $stored;
    }

    public function deleteOwnAccount(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $this->rateLimiter->hit(RateLimiter::ACCOUNT_DELETE, 'user:' . $user['id']);
        $input = Http::body();
        Http::requireFields($input, ['currentPassword', 'confirmation']);
        if (Http::stringField($input, 'confirmation') !== 'ลบบัญชี') {
            throw new HttpException(422, 'กรุณาพิมพ์ “ลบบัญชี” เพื่อยืนยัน', 'VALIDATION_FAILED', [
                'confirmation' => 'พิมพ์ ลบบัญชี ให้ตรงตามที่กำหนด',
            ]);
        }

        $this->database->transaction(function (PDO $pdo) use ($user, $input): void {
            $account = $this->database->fetchOne('SELECT password_hash FROM users WHERE id = ? AND status = "active" FOR UPDATE', [$user['id']]);
            if (!$account || !password_verify(Http::stringField($input, 'currentPassword'), $account['password_hash'])) {
                throw new HttpException(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', 'INVALID_CREDENTIALS', [
                    'currentPassword' => 'ตรวจสอบรหัสผ่านแล้วลองอีกครั้ง',
                ]);
            }

            // Keep booking and payment history for system records, but revoke every session.
            // The address is released so the person can register with it again.
            $pdo->prepare('UPDATE users SET status = "deleted", email = CONCAT("deleted-", id, "@deleted.invalid"), updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$user['id']]);
            $pdo->prepare('UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL')
                ->execute([$user['id']]);
        });

        Http::json(['deleted' => true]);
    }

    public function uploadProfileImage(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $this->rateLimiter->hit(RateLimiter::PROFILE_IMAGE, 'user:' . $user['id']);
        $upload = $this->saveImageUpload('profile-images');
        try {
            $oldPath = $this->swapProfileImage($user, $upload['path']);
        } catch (Throwable $error) {
            $this->removeUpload($upload['path']);
            throw $error;
        }
        if ($oldPath !== null) {
            $this->removeUpload($oldPath);
        }

        Http::json(['imageUrl' => '/v1/profile-images/' . $user['role'] . '/' . $user['id']]);
    }

    /** An uploaded picture; size and type problems are reported against the `image` field. */
    private function saveImageUpload(string $directory): array
    {
        try {
            return $this->saveUpload('image', ['image/jpeg', 'image/png', 'image/webp'], 5 * 1024 * 1024, $directory);
        } catch (HttpException $error) {
            if (in_array($error->status, [413, 415], true)) {
                throw new HttpException(422, $error->getMessage(), 'VALIDATION_FAILED', ['image' => $error->getMessage()]);
            }
            throw $error;
        }
    }

    /** Stores the caller's profile picture path (null removes it) and returns the one it replaced. */
    private function swapProfileImage(array $user, ?string $path): ?string
    {
        $table = $user['role'] === 'member' ? 'member_profiles' : 'trainer_profiles';
        return $this->database->transaction(function (PDO $pdo) use ($user, $path, $table): ?string {
            $row = $this->database->fetchOne("SELECT image_path FROM {$table} WHERE user_id = ? FOR UPDATE", [$user['id']]);
            if (!$row) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์', 'PROFILE_NOT_FOUND');
            }
            $pdo->prepare("UPDATE {$table} SET image_path = ?, updated_at = UTC_TIMESTAMP() WHERE user_id = ?")
                ->execute([$path, $user['id']]);
            return $row['image_path'];
        });
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

    public function notifications(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $page = NotificationService::parsePage($_GET['page'] ?? '0');
        $category = NotificationService::parseCategory($_GET['category'] ?? 'all');
        $unread = NotificationService::parseUnread($_GET['unread'] ?? 'false');
        $query = NotificationService::parseQuery($_GET['q'] ?? '');
        Http::json($this->notifications->listForUser((int) $user['id'], $page, $category, $unread, $query));
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
        $oldPath = $this->swapProfileImage($user, null);
        if ($oldPath !== null) {
            $this->removeUpload($oldPath);
        }

        Http::json(['imageUrl' => null]);
    }

    public function changeProfilePassword(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer', 'admin']);
        $input = Http::body();
        // A wrong current password is a credential guess, so it is still counted
        // — but against the account, never against the LOGIN address bucket that
        // every other member behind the same network shares. Ten typos here used
        // to lock the whole network out of signing in. On success only this
        // account key is cleared, exactly as a sign-in clears its own.
        $account = RateLimiter::accountKey((string) $user['email']);
        $this->rateLimiter->hit(RateLimiter::LOGIN, $account);
        $result = $this->auth->changePassword($input);
        $this->rateLimiter->clear(RateLimiter::LOGIN, $account);
        Http::json($result);
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

    /**
     * Starts (or resumes) Stripe Checkout for a booking waiting for payment and
     * answers the hosted payment page URL. Replaces the bank-slip upload.
     */
    public function payment(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId']);
        $this->rateLimiter->hit(RateLimiter::PAYMENT_SLIP, 'user:' . $user['id']);
        $stripe = $this->stripe();
        $publicId = Http::stringField($input, 'bookingId');
        $notificationIds = [];

        $result = $this->database->transaction(function (PDO $pdo) use ($publicId, $user, $stripe, &$notificationIds): array {
                $booking = $this->database->fetchOne(
                'SELECT b.id, b.public_id, b.status, b.availability_slot_id, b.payment_deadline_at, b.quoted_price,
                        b.booking_type, b.payment_service_mode, u.email AS member_email,
                        tp.id AS trainer_profile_id, tp.stripe_account_id, tp.stripe_transfers_enabled,
                        trainer_user.display_name AS trainer_name,
                        UTC_TIMESTAMP() AS database_now
                 FROM bookings b
                 JOIN users u ON u.id = b.member_user_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users trainer_user ON trainer_user.id = tp.user_id
                 WHERE b.public_id = ? AND b.member_user_id = ? FOR UPDATE',
                [$publicId, $user['id']]
            );
            if (!$booking) {
                throw new HttpException(404, 'ไม่พบคำขอจอง', 'BOOKING_NOT_FOUND');
            }
            if ($booking['status'] !== 'awaiting_payment' || $booking['payment_deadline_at'] === null) {
                throw new HttpException(409, 'คำขอนี้ยังไม่อยู่ในขั้นชำระเงิน', 'PAYMENT_NOT_READY');
            }
            $deadline = self::utc((string) $booking['payment_deadline_at']);
            $databaseNow = self::utc((string) $booking['database_now']);
            if (WorkflowRules::isPaymentDeadlineExpired($deadline, $databaseNow)) {
                $slotId = $booking['availability_slot_id'] === null ? null : (int) $booking['availability_slot_id'];
                $this->expireAwaitingPaymentsInTransaction($pdo, $slotId, $notificationIds);
                return ['expired' => true];
            }
            if ($booking['quoted_price'] === null) {
                throw new HttpException(409, 'การจองนี้ยังไม่มียอดชำระ', 'PAYMENT_AMOUNT_UNAVAILABLE');
            }

            // A member who comes back to the page resumes the session already open.
            $existing = $this->database->fetchOne(
                'SELECT id, stripe_checkout_session_id, stripe_destination_account FROM payments
                 WHERE booking_id = ? AND status = "pending" AND stripe_checkout_session_id IS NOT NULL
                 ORDER BY id DESC LIMIT 1',
                [$booking['id']]
            );
            if ($existing) {
                $session = $stripe->get(
                    '/v1/checkout/sessions/' . rawurlencode((string) $existing['stripe_checkout_session_id']),
                    [],
                    $existing['stripe_destination_account']
                );
                $outcome = StripePayments::sessionOutcome($session);
                if ($outcome === 'open' && !empty($session['url'])) {
                    return ['expired' => false, 'url' => (string) $session['url']];
                }
                if ($outcome === 'paid') {
                    return ['expired' => false, 'url' => null, 'alreadyPaid' => true];
                }
                $pdo->prepare('UPDATE payments SET status = "rejected", review_note = "ปิดหน้าชำระเงินก่อนชำระสำเร็จ" WHERE id = ?')
                    ->execute([$existing['id']]);
            }

            $destination = null;
            if ($booking['payment_service_mode'] === 'freelance') {
                $destination = $this->readyStripeAccount($pdo, $booking);
            }
            $amount = StripePayments::toSatang($booking['quoted_price']);
            $fee = $destination === null ? 0 : StripePayments::applicationFee(
                $amount,
                (float) ($this->config['stripe']['platform_fee_percent'] ?? 0)
            );
            $appUrl = (string) $this->config['app_url'];
            $bookingParam = rawurlencode((string) $booking['public_id']);
            $params = StripePayments::checkoutSessionParams([
                'publicId' => (string) $booking['public_id'],
                'amountSatang' => $amount,
                'description' => ($booking['booking_type'] === 'monthly' ? 'แพ็กเกจรายเดือนกับ ' : 'ค่าฝึกกับ ')
                    . $booking['trainer_name'] . ' (' . $booking['public_id'] . ')',
                'memberEmail' => $booking['member_email'] ?? null,
                'serviceMode' => (string) $booking['payment_service_mode'],
                'destination' => $destination,
                'feeSatang' => $fee,
                'successUrl' => $appUrl . '/member?booking=' . $bookingParam . '&checkout=success',
                'cancelUrl' => $appUrl . '/member?booking=' . $bookingParam . '&checkout=cancelled',
                // The booking's own ten minutes still rule: the expiry sweep closes
                // the session, and a payment that lands late is refunded.
                'expiresAt' => time() + StripePayments::MINIMUM_SESSION_MINUTES * 60 + 60,
            ]);
            // A freelance session is a direct charge on the trainer's account.
            $session = $stripe->post('/v1/checkout/sessions', $params, 'checkout-' . $booking['public_id'] . '-' . bin2hex(random_bytes(6)), $destination);
            $pdo->prepare(
                'INSERT INTO payments (booking_id, submitted_by_user_id, amount, window_ends_at, stripe_checkout_session_id,
                                       stripe_destination_account, application_fee, status, submitted_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, "pending", UTC_TIMESTAMP())'
            )->execute([
                $booking['id'], $user['id'], number_format($amount / 100, 2, '.', ''), $booking['payment_deadline_at'],
                $session['id'], $destination, $fee === 0 ? null : number_format($fee / 100, 2, '.', ''),
            ]);
            return ['expired' => false, 'url' => (string) $session['url']];
        });
        $this->notifications->deliverByIds($notificationIds);
        if ($result['expired']) {
            throw new HttpException(409, 'หมดเวลาชำระเงิน กรุณาเลือกเวลาใหม่', 'PAYMENT_DEADLINE_EXPIRED');
        }
        if (!empty($result['alreadyPaid'])) {
            $this->syncBookingCheckout($publicId, (int) $user['id']);
            throw new HttpException(409, 'การจองนี้ชำระเงินแล้ว', 'PAYMENT_ALREADY_COMPLETED');
        }
        Http::json(['bookingId' => $publicId, 'checkoutUrl' => $result['url']], 201);
    }

    /**
     * The member lands back from Checkout. Asks Stripe for the session instead
     * of waiting for the webhook, so a local setup without a public webhook URL
     * still confirms the booking.
     */
    public function confirmPayment(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['bookingId']);
        $publicId = Http::stringField($input, 'bookingId');
        $outcome = $this->syncBookingCheckout($publicId, (int) $user['id']);
        Http::json(['bookingId' => $publicId, 'outcome' => $outcome]);
    }

    /** Stripe webhook: Checkout Session outcomes and connected account updates. */
    public function stripeWebhook(): never
    {
        $payload = (string) file_get_contents('php://input');
        $event = $this->stripe()->verifyWebhook($payload, (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? ''));
        $eventId = (string) ($event['id'] ?? '');
        $type = (string) $event['type'];
        $object = is_array($event['data']['object'] ?? null) ? $event['data']['object'] : [];

        if ($this->database->fetchOne('SELECT id FROM stripe_events WHERE id = ?', [$eventId])) {
            Http::json(['received' => true, 'duplicate' => true]);
        }
        if (str_starts_with($type, 'checkout.session.') && isset($object['id'])) {
            // The event body can be stale; the session is read back from Stripe.
            // Freelance sessions live on the trainer's account (event.account).
            $account = isset($event['account']) ? (string) $event['account'] : null;
            $this->applyCheckoutSession(
                $this->stripe()->get('/v1/checkout/sessions/' . rawurlencode((string) $object['id']), [], $account),
                $account
            );
        }
        $this->database->execute('INSERT IGNORE INTO stripe_events (id, type) VALUES (?, ?)', [$eventId, $type]);
        Http::json(['received' => true]);
    }

    /** The trainer's Stripe payout status for the money tab. */
    public function trainerStripeStatus(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $profile = $this->database->fetchOne(
            'SELECT id, stripe_account_id, stripe_transfers_enabled FROM trainer_profiles WHERE user_id = ?',
            [$user['id']]
        );
        if (!$profile) {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        $enabled = (bool) $profile['stripe_transfers_enabled'];
        if ($profile['stripe_account_id'] !== null && $this->stripe()->enabled()) {
            $enabled = StripePayments::chargesEnabled($this->connectedAccount((string) $profile['stripe_account_id']));
            $this->database->execute('UPDATE trainer_profiles SET stripe_transfers_enabled = ? WHERE id = ?', [$enabled ? 1 : 0, $profile['id']]);
        }
        Http::json([
            'configured' => $this->stripe()->enabled(),
            'testMode' => $this->stripe()->testMode(),
            'connected' => $profile['stripe_account_id'] !== null,
            'payoutsReady' => $enabled,
        ]);
    }

    /**
     * Creates the trainer's connected account on first use and answers a
     * Stripe-hosted onboarding link. Thai platforms cannot carry connected
     * account losses, so the account takes its own charges (direct charges)
     * with Stripe owning risk and the full Stripe Dashboard.
     */
    public function trainerStripeOnboarding(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $stripe = $this->stripe();
        $profile = $this->database->fetchOne(
            'SELECT tp.id, tp.stripe_account_id, u.email, u.display_name
             FROM trainer_profiles tp JOIN users u ON u.id = tp.user_id WHERE tp.user_id = ?',
            [$user['id']]
        );
        if (!$profile) {
            throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
        }
        $accountId = $profile['stripe_account_id'];
        if ($accountId === null) {
            $account = $stripe->postV2('/v2/core/accounts', StripePayments::connectedAccountBody(
                (string) $profile['email'],
                (string) $profile['display_name'],
                (int) $profile['id']
            ), 'trainer-account-v2-' . $profile['id']);
            $accountId = (string) $account['id'];
            $this->database->execute(
                'UPDATE trainer_profiles SET stripe_account_id = ? WHERE id = ? AND stripe_account_id IS NULL',
                [$accountId, $profile['id']]
            );
        }
        $appUrl = (string) $this->config['app_url'];
        $link = $stripe->postV2('/v2/core/account_links', [
            'account' => $accountId,
            'use_case' => [
                'type' => 'account_onboarding',
                'account_onboarding' => [
                    'configurations' => ['merchant'],
                    'refresh_url' => $appUrl . '/trainer?stripe=refresh',
                    'return_url' => $appUrl . '/trainer?stripe=return',
                ],
            ],
        ]);
        Http::json(['url' => (string) $link['url']], 201);
    }

    /** The trainer signs in to their own full Stripe Dashboard. */
    public function trainerStripeDashboard(): never
    {
        $user = $this->auth->requireUser(['trainer']);
        $profile = $this->database->fetchOne('SELECT stripe_account_id FROM trainer_profiles WHERE user_id = ?', [$user['id']]);
        if (!$profile || $profile['stripe_account_id'] === null) {
            throw new HttpException(409, 'ยังไม่ได้เชื่อมบัญชีรับเงิน', 'TRAINER_PAYOUTS_NOT_READY');
        }
        Http::json(['url' => 'https://dashboard.stripe.com/' . rawurlencode((string) $profile['stripe_account_id'])], 201);
    }

    private function connectedAccount(string $accountId): array
    {
        return $this->stripe()->getV2('/v2/core/accounts/' . rawurlencode($accountId), ['include' => 'configuration.merchant']);
    }

    private function stripe(): StripeClient
    {
        return $this->stripeClient ??= new StripeClient(
            (string) ($this->config['stripe']['secret_key'] ?? ''),
            (string) ($this->config['stripe']['webhook_secret'] ?? '')
        );
    }

    /** The freelance trainer's connected account, refreshed from Stripe when not yet marked ready. */
    private function readyStripeAccount(PDO $pdo, array $booking): string
    {
        $accountId = $booking['stripe_account_id'];
        if ($accountId === null) {
            throw new HttpException(409, 'เทรนเนอร์ยังไม่ได้เปิดรับเงินออนไลน์ กรุณาติดต่อเทรนเนอร์ผ่านแชท', 'TRAINER_PAYOUTS_NOT_READY');
        }
        if (!(bool) $booking['stripe_transfers_enabled']) {
            if (!StripePayments::chargesEnabled($this->connectedAccount((string) $accountId))) {
                throw new HttpException(409, 'บัญชีรับเงินของเทรนเนอร์ยังยืนยันตัวตนไม่เสร็จ กรุณาติดต่อเทรนเนอร์ผ่านแชท', 'TRAINER_PAYOUTS_NOT_READY');
            }
            $pdo->prepare('UPDATE trainer_profiles SET stripe_transfers_enabled = 1 WHERE id = ?')->execute([$booking['trainer_profile_id']]);
        }
        return (string) $accountId;
    }

    /** Reads the booking's latest Checkout Session from Stripe and applies it. */
    private function syncBookingCheckout(string $publicId, int $memberUserId): string
    {
        $row = $this->database->fetchOne(
            'SELECT pay.stripe_checkout_session_id, pay.stripe_destination_account FROM payments pay JOIN bookings b ON b.id = pay.booking_id
             WHERE b.public_id = ? AND b.member_user_id = ? AND pay.stripe_checkout_session_id IS NOT NULL
             ORDER BY pay.id DESC LIMIT 1',
            [$publicId, $memberUserId]
        );
        if (!$row) {
            throw new HttpException(404, 'ไม่พบรายการชำระเงินของการจองนี้', 'PAYMENT_NOT_FOUND');
        }
        $account = $row['stripe_destination_account'];
        $session = $this->stripe()->get('/v1/checkout/sessions/' . rawurlencode((string) $row['stripe_checkout_session_id']), [], $account);
        return $this->applyCheckoutSession($session, $account);
    }

    /**
     * The single place a Checkout Session changes a booking. Safe to run more
     * than once for the same session (webhook redelivery, return page reload).
     * A payment for a booking that no longer waits for one (expired or
     * cancelled meanwhile) is refunded in full.
     */
    private function applyCheckoutSession(array $session, ?string $account = null): string
    {
        $outcome = StripePayments::sessionOutcome($session);
        $notificationIds = [];
        $this->database->transaction(function (PDO $pdo) use ($session, $outcome, $account, &$notificationIds): void {
            $payment = $this->database->fetchOne(
                'SELECT pay.id, pay.status, pay.booking_id, pay.stripe_destination_account,
                        b.status AS booking_status, b.availability_slot_id
                 FROM payments pay JOIN bookings b ON b.id = pay.booking_id
                 WHERE pay.stripe_checkout_session_id = ? FOR UPDATE',
                [(string) ($session['id'] ?? '')]
            );
            if (!$payment || in_array($payment['status'], ['approved', 'refunded'], true) || $outcome === 'open') {
                return;
            }
            if ($outcome === 'closed') {
                $pdo->prepare('UPDATE payments SET status = "rejected", review_note = "ไม่ได้ชำระเงินในหน้าชำระเงิน", reviewed_at = UTC_TIMESTAMP() WHERE id = ? AND status = "pending"')
                    ->execute([$payment['id']]);
                return;
            }
            $paymentIntent = is_array($session['payment_intent'] ?? null)
                ? (string) ($session['payment_intent']['id'] ?? '')
                : (string) ($session['payment_intent'] ?? '');

            if ($payment['booking_status'] !== 'awaiting_payment') {
                // Paid after the window closed or after a cancellation.
                $chargeAccount = $payment['stripe_destination_account'] ?? $account;
                $refund = StripePayments::refundParams($paymentIntent, $chargeAccount !== null, 'booking_not_awaiting_payment');
                $this->stripe()->post('/v1/refunds', $refund, 'refund-' . md5(StripeClient::encode($refund)), $chargeAccount);
                $pdo->prepare('UPDATE payments SET status = "refunded", stripe_payment_intent_id = ?, refunded_at = UTC_TIMESTAMP(), review_note = "ชำระหลังหมดเวลาหรือหลังยกเลิก ระบบคืนเงินอัตโนมัติ", reviewed_at = UTC_TIMESTAMP() WHERE id = ?')
                    ->execute([$paymentIntent, $payment['id']]);
                $this->history($pdo, $payment['booking_id'], $payment['booking_status'], $payment['booking_status'], null, 'ชำระเงินหลังการจองปิดแล้ว ระบบคืนเงินอัตโนมัติ');
                return;
            }

            $pdo->prepare('UPDATE payments SET status = "approved", stripe_payment_intent_id = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$paymentIntent, $payment['id']]);
            $pdo->prepare('UPDATE bookings SET status = "confirmed", payment_status = "approved", payment_deadline_at = NULL, updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([$payment['booking_id']]);
            $this->history($pdo, $payment['booking_id'], 'awaiting_payment', 'confirmed', null, 'ชำระเงินออนไลน์สำเร็จ');
            $this->setBookingSlotsState($pdo, (int) $payment['booking_id'], $payment['availability_slot_id'], 'booked');
            $this->notify($pdo, $notificationIds, NotificationRules::PAYMENT_APPROVED, $this->bookingNotificationContext($pdo, (int) $payment['booking_id'], 'awaiting_payment', 'confirmed'));
        });
        $this->notifications->deliverByIds($notificationIds);
        return $outcome;
    }

    /**
     * Closes Checkout Sessions whose booking stopped waiting for payment. Best effort.
     *
     * @param list<array{0: string, 1: ?string}> $sessions session id and the account it lives on
     */
    private function expireCheckoutSessions(array $sessions): void
    {
        if ($sessions === [] || !$this->stripe()->enabled()) {
            return;
        }
        foreach ($sessions as [$sessionId, $account]) {
            try {
                $this->stripe()->post('/v1/checkout/sessions/' . rawurlencode($sessionId) . '/expire', [], null, $account);
            } catch (HttpException) {
                // Already paid or already closed; applyCheckoutSession settles either.
            }
        }
    }

    /** Open Checkout Sessions of one booking, closed in the database as the booking closes. */
    private function closePendingCheckoutsInTransaction(PDO $pdo, int $bookingId): array
    {
        $statement = $pdo->prepare(
            'SELECT stripe_checkout_session_id, stripe_destination_account FROM payments
             WHERE booking_id = ? AND status = "pending" AND stripe_checkout_session_id IS NOT NULL FOR UPDATE'
        );
        $statement->execute([$bookingId]);
        $ids = array_map(
            static fn(array $row): array => [(string) $row['stripe_checkout_session_id'], $row['stripe_destination_account']],
            $statement->fetchAll()
        );
        $pdo->prepare('UPDATE payments SET status = "rejected", review_note = "การจองปิดก่อนชำระเงิน", reviewed_at = UTC_TIMESTAMP() WHERE booking_id = ? AND status = "pending"')
            ->execute([$bookingId]);
        return $ids;
    }

    /** Refunds the booking's Stripe payment in full, reversing the trainer's transfer. */
    private function refundBookingPaymentInTransaction(PDO $pdo, int $bookingId, string $reason): bool
    {
        $statement = $pdo->prepare(
            'SELECT id, stripe_payment_intent_id, stripe_destination_account FROM payments
             WHERE booking_id = ? AND status = "approved" AND stripe_payment_intent_id IS NOT NULL FOR UPDATE'
        );
        $statement->execute([$bookingId]);
        $refunded = false;
        foreach ($statement->fetchAll() as $payment) {
            $refund = StripePayments::refundParams(
                (string) $payment['stripe_payment_intent_id'],
                $payment['stripe_destination_account'] !== null,
                'booking_cancelled'
            );
            // The key carries the parameters, so a corrected retry is not
            // answered with an earlier refused request.
            $this->stripe()->post(
                '/v1/refunds',
                $refund,
                'refund-' . md5(StripeClient::encode($refund)),
                $payment['stripe_destination_account']
            );
            $pdo->prepare('UPDATE payments SET status = "refunded", refunded_at = UTC_TIMESTAMP(), review_note = ? WHERE id = ?')
                ->execute([mb_substr('คืนเงินเพราะยกเลิกการจอง: ' . $reason, 0, 1000), $payment['id']]);
            $refunded = true;
        }
        return $refunded;
    }

    public function messages(string $roomId): never
    {
        $user = $this->auth->requireUser();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $rawAfterId = $_GET['afterId'] ?? '0';
        $afterId = is_array($rawAfterId) || preg_match('/^\d+$/', (string) $rawAfterId) !== 1
            ? false
            : filter_var((string) $rawAfterId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
        if ($afterId === false) {
            throw new HttpException(422, 'ตัวชี้ข้อความไม่ถูกต้อง', 'VALIDATION_FAILED', ['afterId' => 'ต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป']);
        }

        $rows = $this->database->transaction(function (PDO $pdo) use ($room, $afterId, $user): array {
            $select = 'SELECT m.id, m.message_text, m.attachment_path, m.attachment_mime, m.attachment_name,
                              m.attachment_size, m.image_path, m.image_mime, m.image_name, m.image_size,
                              m.read_at, m.created_at, u.id AS sender_id, u.display_name
                       FROM messages m JOIN users u ON u.id = m.sender_user_id
                       WHERE m.chat_room_id = ? AND m.id > ?';
            $page = $this->database->fetchAll($select . ' ORDER BY m.id ASC LIMIT 500 FOR UPDATE', [$room['id'], $afterId]);
            if ($page === []) {
                return [];
            }
            $maxId = (int) $page[count($page) - 1]['id'];
            $pdo->prepare(
                'UPDATE messages SET read_at = UTC_TIMESTAMP()
                 WHERE chat_room_id = ? AND id > ? AND id <= ? AND sender_user_id <> ? AND read_at IS NULL'
            )->execute([$room['id'], $afterId, $maxId, $user['id']]);
            // Read the page again so it carries the read_at just written.
            return $this->database->fetchAll($select . ' AND m.id <= ? ORDER BY m.id ASC', [$room['id'], $afterId, $maxId]);
        });
        Http::json(array_map(fn(array $row): array => $this->messagePayload(
            (int) $row['id'],
            (int) $room['id'],
            (string) $row['message_text'],
            $row['attachment_path'] === null ? null : ['name' => $row['attachment_name'], 'mime' => $row['attachment_mime'], 'size' => (int) $row['attachment_size']],
            $row['image_path'] === null ? null : ['name' => $row['image_name'], 'mime' => $row['image_mime'], 'size' => (int) $row['image_size']],
            $row['read_at'] === null ? null : $this->iso($row['read_at']),
            $this->iso($row['created_at']),
            ['id' => (int) $row['sender_id'], 'displayName' => $row['display_name']]
        ), $rows));
    }

    /**
     * One message can carry both an image and a file; the legacy `attachment`
     * key mirrors the file so older clients keep working.
     */
    private function messagePayload(
        int $messageId,
        int $roomId,
        string $message,
        ?array $file,
        ?array $image,
        ?string $readAt,
        string $createdAt,
        array $sender
    ): array {
        $base = '/v1/chat-rooms/' . $roomId . '/messages/' . $messageId . '/attachment';
        return [
            'id' => $messageId,
            'message' => $message,
            'attachment' => $file === null ? null : [
                'name' => $file['name'],
                'mime' => $file['mime'],
                'size' => $file['size'],
                'url' => $base,
            ],
            'imageUrl' => $image === null ? null : $base . '?kind=image',
            'imageName' => $image['name'] ?? null,
            'imageSize' => $image['size'] ?? null,
            'attachmentUrl' => $file === null ? null : $base . '?kind=file',
            'attachmentName' => $file['name'] ?? null,
            'attachmentSize' => $file['size'] ?? null,
            'readAt' => $readAt,
            'createdAt' => $createdAt,
            'sender' => $sender,
        ];
    }

    public function sendMessage(string $roomId): never
    {
        $user = $this->auth->requireUser();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        if ($room['booking_id'] === null) {
            // An inquiry stays open while the trainer is listed on the platform.
            if ($room['trainer_approval_status'] !== 'approved') {
                throw new HttpException(409, 'ห้องสนทนานี้ส่งข้อความเพิ่มไม่ได้', 'CHAT_READ_ONLY');
            }
        } else {
            WorkflowRules::assertChatWritable((string) $room['booking_status']);
        }
        $this->rateLimiter->hit(RateLimiter::CHAT_ATTACHMENT, 'user:' . $user['id'] . ':room:' . (int) $roomId);
        $input = Http::body();
        // `text` is the documented field; `message` is what older clients send.
        $textField = array_key_exists('text', $input) ? 'text' : 'message';
        if (array_key_exists($textField, $input) && !is_string($input[$textField])) {
            throw new HttpException(422, 'รูปแบบข้อความไม่ถูกต้อง', 'VALIDATION_FAILED', ['message' => 'ต้องเป็นข้อความ']);
        }
        $message = trim(Http::stringField($input, $textField));
        if (mb_strlen($message) > 4000) {
            throw new HttpException(422, 'ข้อความยาวเกิน 4,000 ตัวอักษร', 'VALIDATION_FAILED');
        }
        // One message can carry an image and a file at the same time; the two
        // live in separate column sets and render side by side in the bubble.
        $imageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
        $image = $this->saveUpload('image', $imageTypes, 5 * 1024 * 1024, 'messages', false);
        $file = $this->saveUpload('file', [...$imageTypes, 'application/pdf'], 5 * 1024 * 1024, 'messages', false);
        if ($message === '' && $image === null && $file === null) {
            throw new HttpException(422, 'กรุณาพิมพ์ข้อความหรือแนบไฟล์', 'VALIDATION_FAILED');
        }

        $notificationIds = [];
        try {
            $messageId = $this->database->transaction(function (PDO $pdo) use ($room, $user, $message, $image, $file, &$notificationIds): int {
                $pdo->prepare(
                    'INSERT INTO messages
                        (chat_room_id, sender_user_id, message_text, attachment_path, attachment_mime, attachment_name, attachment_size,
                         image_path, image_mime, image_name, image_size)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                )->execute([
                    $room['id'],
                    $user['id'],
                    $message,
                    $file['path'] ?? null,
                    $file['mime'] ?? null,
                    $file['name'] ?? null,
                    $file['size'] ?? null,
                    $image['path'] ?? null,
                    $image['mime'] ?? null,
                    $image['name'] ?? null,
                    $image['size'] ?? null,
                ]);
                $messageId = (int) $pdo->lastInsertId();
                $recipientId = (int) $user['id'] === (int) $room['member_user_id']
                    ? (int) $room['trainer_user_id']
                    : (int) $room['member_user_id'];
                if ($room['booking_id'] === null) {
                    $this->notify($pdo, $notificationIds, NotificationRules::INQUIRY_MESSAGE_RECEIVED, ['recipientUserId' => $recipientId, 'senderName' => (string) $user['displayName'], 'roomId' => (int) $room['id'], 'messageId' => $messageId]);
                    return $messageId;
                }
                $this->notify($pdo, $notificationIds, NotificationRules::MESSAGE_RECEIVED, ['bookingId' => (int) $room['booking_id'], 'bookingPublicId' => (string) $room['booking_public_id'], 'memberUserId' => (int) $room['member_user_id'], 'trainerUserId' => (int) $room['trainer_user_id'], 'recipientUserId' => $recipientId, 'senderName' => (string) $user['displayName'], 'messageId' => $messageId]);
                return $messageId;
            });
        } catch (Throwable $error) {
            if ($image !== null) {
                $this->removeUpload($image['path']);
            }
            if ($file !== null) {
                $this->removeUpload($file['path']);
            }
            throw $error;
        }
        $this->notifications->deliverByIds($notificationIds);

        Http::json($this->messagePayload(
            $messageId,
            (int) $room['id'],
            $message,
            $file,
            $image,
            null,
            gmdate('c'),
            ['id' => (int) $user['id'], 'displayName' => $user['displayName']]
        ), 201);
    }

    public function chatAttachment(string $roomId, string $messageId): never
    {
        $user = $this->auth->requireUser();
        $room = $this->requireChatParticipant((int) $roomId, $user);
        $kind = (string) ($_GET['kind'] ?? 'file');
        if ($kind === 'image') {
            $pathColumn = 'image_path';
            $nameColumn = 'image_name';
        } elseif ($kind === 'file') {
            $pathColumn = 'attachment_path';
            $nameColumn = 'attachment_name';
        } else {
            throw new HttpException(422, 'ประเภทไฟล์ไม่ถูกต้อง', 'VALIDATION_FAILED', ['kind' => 'เลือก image หรือ file']);
        }
        $attachment = $this->database->fetchOne(
            "SELECT {$pathColumn} AS file_path, {$nameColumn} AS file_name
             FROM messages WHERE id = ? AND chat_room_id = ? AND {$pathColumn} IS NOT NULL",
            [(int) $messageId, $room['id']]
        );
        if (!$attachment) {
            throw new HttpException(404, 'ไม่พบไฟล์แนบ', 'FILE_NOT_FOUND');
        }

        $target = self::uploadPath((string) $attachment['file_path']);
        $mime = $target === null ? false : (new finfo(FILEINFO_MIME_TYPE))->file($target);
        if ($mime === false) {
            throw new HttpException(404, 'ไม่พบไฟล์แนบ', 'FILE_NOT_FOUND');
        }
        $rawName = trim((string) basename((string) $attachment['file_name']));
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
        // Images render inside the chat bubble; files download as attachments.
        $disposition = $kind === 'image' ? 'inline' : 'attachment';
        header('Content-Disposition: ' . $disposition . '; filename="' . $asciiName . '"; filename*=UTF-8\'\'' . rawurlencode($displayName));
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
        $bookingStatuses = ['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed', 'completed', 'cancelled', 'expired'];
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
            // Deleted accounts disappear from every list; a search matches the
            // display name, the email, or a stored phone number either profile.
            $userWhere = 'u.role <> "admin" AND u.status <> "deleted"';
            $userParams = [];
            if ($userQuery !== '') {
                $userWhere .= ' AND (u.display_name LIKE ? OR u.email LIKE ? OR mp.phone LIKE ? OR tp.phone LIKE ?)';
                $like = '%' . $userQuery . '%';
                $userParams = [$like, $like, $like, $like];
            }
            $userCount = $this->database->fetchOne(
                'SELECT COUNT(*) AS total FROM users u
                 LEFT JOIN member_profiles mp ON mp.user_id = u.id
                 LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
                 WHERE ' . $userWhere,
                $userParams
            );
            $userTotal = (int) ($userCount['total'] ?? 0);
            $rows = $this->database->fetchAll(
                'SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
                        tp.approval_status
                 FROM users u
                 LEFT JOIN trainer_profiles tp ON tp.user_id = u.id
                 LEFT JOIN member_profiles mp ON mp.user_id = u.id
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

            $administratorCount = $this->database->fetchOne('SELECT COUNT(*) AS total FROM users WHERE role = "admin" AND status <> "deleted"');
            $administratorTotal = (int) ($administratorCount['total'] ?? 0);
            $adminRows = $this->database->fetchAll(
                'SELECT u.id, u.email, u.display_name, u.role, u.status, u.created_at,
                        ap.manage_users, ap.review_trainers, ap.manage_bookings, ap.review_payments
                 FROM users u
                 LEFT JOIN admin_permissions ap ON ap.user_id = u.id
                 WHERE u.role = "admin" AND u.status <> "deleted"
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
                $placeholders = self::marks($ids);
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

        // Monthly salary accrual for gym trainers: approved gym payments on
        // bookings that are confirmed or completed, bucketed by session month
        // over the latest twelve months.
        $gymSalaries = [];
        if ($permissions['reviewPayments']) {
            $salaryRows = $this->database->fetchAll(
                'SELECT tp.id AS trainer_id, u.display_name AS trainer_name,
                        DATE_FORMAT(b.starts_at, "%Y-%m") AS month,
                        COALESCE(SUM(b.session_count), 0) AS sessions,
                        COALESCE(SUM(pay.amount), 0) AS amount
                 FROM payments pay
                 JOIN bookings b ON b.id = pay.booking_id
                 JOIN trainer_profiles tp ON tp.id = b.trainer_profile_id
                 JOIN users u ON u.id = tp.user_id
                 WHERE pay.status = "approved"
                   AND b.payment_service_mode = "gym"
                   AND b.status IN ("confirmed", "completed")
                   AND b.starts_at >= DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 11 MONTH), "%Y-%m-01")
                 GROUP BY tp.id, u.display_name, month
                 ORDER BY month DESC, tp.id'
            );
            $gymSalaries = array_map(fn(array $row): array => [
                'trainerId' => (int) $row['trainer_id'],
                'trainerName' => $row['trainer_name'],
                'month' => (string) $row['month'],
                'sessions' => (int) $row['sessions'],
                'amount' => (float) $row['amount'],
            ], $salaryRows);
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
            'gymSalaries' => $gymSalaries,
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

    public function adminReports(): never
    {
        $admin = $this->auth->requireUser(['admin']);
        $permissions = $this->adminPermissions((int) $admin['id']);
        if (!$permissions['manageBookings'] && !$permissions['reviewPayments']) {
            throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์เปิดรายงาน', 'ADMIN_PERMISSION_REQUIRED');
        }
        $year = self::reportYear($_GET['year'] ?? null);
        $rangeStart = sprintf('%04d-01-01 00:00:00', $year);
        $rangeEnd = sprintf('%04d-01-01 00:00:00', $year + 1);

        // Only the sections the caller's permissions cover are filled in.
        $bookingsByMonth = [];
        foreach (self::monthKeys($year) as $month) {
            $byStatus = [];
            foreach (['pending_trainer', 'awaiting_payment', 'payment_review', 'confirmed', 'completed', 'cancelled', 'expired'] as $statusName) {
                $byStatus[$statusName] = 0;
            }
            $bookingsByMonth[$month] = ['month' => $month, 'total' => 0, 'byStatus' => $byStatus];
        }
        if ($permissions['manageBookings']) {
            $rows = $this->database->fetchAll(
                'SELECT DATE_FORMAT(b.created_at, "%Y-%m") AS month, b.status, COUNT(*) AS total
                 FROM bookings b
                 WHERE b.created_at >= ? AND b.created_at < ?
                 GROUP BY month, b.status',
                [$rangeStart, $rangeEnd]
            );
            foreach ($rows as $row) {
                $month = (string) $row['month'];
                if (!isset($bookingsByMonth[$month])) {
                    continue;
                }
                $bookingsByMonth[$month]['total'] += (int) $row['total'];
                $bookingsByMonth[$month]['byStatus'][(string) $row['status']] = (int) $row['total'];
            }
        }

        $incomeByMonth = [];
        $paymentsByMonth = [];
        foreach (self::monthKeys($year) as $month) {
            $incomeByMonth[$month] = ['month' => $month, 'amount' => 0.0];
            $paymentsByMonth[$month] = ['month' => $month, 'submitted' => 0, 'approved' => 0, 'rejected' => 0];
        }
        if ($permissions['reviewPayments']) {
            $rows = $this->database->fetchAll(
                'SELECT DATE_FORMAT(pay.submitted_at, "%Y-%m") AS month,
                        COUNT(*) AS submitted,
                        COALESCE(SUM(pay.status = "approved"), 0) AS approved,
                        COALESCE(SUM(pay.status = "rejected"), 0) AS rejected,
                        COALESCE(SUM(CASE WHEN pay.status = "approved" THEN pay.amount ELSE 0 END), 0) AS income
                 FROM payments pay
                 WHERE pay.submitted_at >= ? AND pay.submitted_at < ?
                 GROUP BY month',
                [$rangeStart, $rangeEnd]
            );
            foreach ($rows as $row) {
                $month = (string) $row['month'];
                if (!isset($incomeByMonth[$month])) {
                    continue;
                }
                $incomeByMonth[$month]['amount'] = (float) $row['income'];
                $paymentsByMonth[$month]['submitted'] = (int) $row['submitted'];
                $paymentsByMonth[$month]['approved'] = (int) $row['approved'];
                $paymentsByMonth[$month]['rejected'] = (int) $row['rejected'];
            }
        }

        $roleCounts = $this->database->fetchOne(
            'SELECT COALESCE(SUM(role = "member"), 0) AS members,
                    COALESCE(SUM(role = "trainer"), 0) AS trainers,
                    COALESCE(SUM(role = "admin"), 0) AS admins
             FROM users WHERE status <> "deleted"'
        ) ?? [];
        // หนึ่งแถวต่อบทบาท ตามสัญญา §5.1 (แท็บรายงานวนอ่านแบบ rows)
        $usersByRole = [
            ['role' => 'member', 'count' => (int) ($roleCounts['members'] ?? 0)],
            ['role' => 'trainer', 'count' => (int) ($roleCounts['trainers'] ?? 0)],
            ['role' => 'admin', 'count' => (int) ($roleCounts['admins'] ?? 0)],
        ];

        $totals = [
            'bookings' => array_sum(array_map(static fn(array $row): int => $row['total'], $bookingsByMonth)),
            'income' => array_sum(array_map(static fn(array $row): float => $row['amount'], $incomeByMonth)),
            'paymentsSubmitted' => array_sum(array_map(static fn(array $row): int => $row['submitted'], $paymentsByMonth)),
            'paymentsApproved' => array_sum(array_map(static fn(array $row): int => $row['approved'], $paymentsByMonth)),
            'paymentsRejected' => array_sum(array_map(static fn(array $row): int => $row['rejected'], $paymentsByMonth)),
            'users' => array_sum(array_map(static fn(array $row): int => $row['count'], $usersByRole)),
        ];

        Http::json([
            'year' => $year,
            'bookingsByMonth' => array_values($bookingsByMonth),
            'incomeByMonth' => array_values($incomeByMonth),
            'paymentsByMonth' => array_values($paymentsByMonth),
            'usersByRole' => $usersByRole,
            'totals' => $totals,
        ]);
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

    private static function reportYear(mixed $value): int
    {
        if ($value === null || $value === '') {
            return (int) gmdate('Y');
        }
        if (is_array($value) || preg_match('/^\d{4}$/', (string) $value) !== 1) {
            throw new HttpException(422, 'ปีของรายงานไม่ถูกต้อง', 'VALIDATION_FAILED', ['year' => 'ใช้ปี ค.ศ. 4 หลัก']);
        }
        $year = (int) $value;
        if ($year < 2000 || $year > 2100) {
            throw new HttpException(422, 'ปีของรายงานไม่ถูกต้อง', 'VALIDATION_FAILED', ['year' => 'ใช้ปีระหว่าง 2000 ถึง 2100']);
        }
        return $year;
    }

    /** @return array<int, string> twelve `YYYY-MM` keys in month order. */
    private static function monthKeys(int $year): array
    {
        $months = [];
        for ($month = 1; $month <= 12; $month++) {
            $months[] = sprintf('%04d-%02d', $year, $month);
        }
        return $months;
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
                $booking = $this->database->fetchOne('SELECT b.id, b.payment_service_mode
                    FROM bookings b WHERE b.public_id = ? FOR UPDATE',
                    [Http::stringField($input, 'bookingId')]
                );
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
        $displayName = trim(Http::stringField($input, 'displayName'));
        $email = strtolower(trim(Http::stringField($input, 'email')));
        $password = Http::stringField($input, 'password');
        // A missing key is a notice in the log; normalizeAdminPermissions()
        // already treats a non-array as "no permission granted".
        $permissions = $this->normalizeAdminPermissions($input['permissions'] ?? null);
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
        $displayName = array_key_exists('displayName', $input) ? trim(Http::stringField($input, 'displayName')) : (string) $target['display_name'];
        $email = array_key_exists('email', $input) ? strtolower(trim(Http::stringField($input, 'email'))) : (string) $target['email'];
        $status = array_key_exists('status', $input) ? Http::stringField($input, 'status') : (string) $target['status'];
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
            $permissionPlaceholders = self::marks($permissionIds);
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

    public function deleteUser(string $userId): never
    {
        $admin = $this->requireAdminPermission('manage_users');
        $target = $this->database->fetchOne(
            'SELECT id, role, status FROM users WHERE id = ?',
            [(int) $userId]
        );
        if (!$target || $target['status'] === 'deleted') {
            throw new HttpException(404, 'ไม่พบบัญชีผู้ใช้', 'USER_NOT_FOUND');
        }
        $this->database->transaction(function (PDO $pdo) use ($admin, $target): void {
            $permissionIds = [(int) $admin['id'], (int) $target['id']];
            sort($permissionIds);
            $permissionPlaceholders = self::marks($permissionIds);
            $permissionStatement = $pdo->prepare(
                'SELECT user_id, manage_users
                 FROM admin_permissions WHERE user_id IN (' . $permissionPlaceholders . ')
                 ORDER BY user_id FOR UPDATE'
            );
            $permissionStatement->execute($permissionIds);
            $lockedPermissions = [];
            foreach ($permissionStatement->fetchAll() as $row) {
                $lockedPermissions[(int) $row['user_id']] = (bool) $row['manage_users'];
            }
            if (!($lockedPermissions[(int) $admin['id']] ?? false)) {
                throw new HttpException(403, 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้', 'ADMIN_PERMISSION_REQUIRED');
            }
            $targetManagesUsers = $target['role'] === 'admin' && ($lockedPermissions[(int) $target['id']] ?? false);
            $managerStatement = $pdo->query(
                'SELECT ap.user_id
                 FROM admin_permissions ap
                 JOIN users u ON u.id = ap.user_id
                 WHERE ap.manage_users = 1 AND u.status = "active"
                 FOR UPDATE'
            );
            $managerIds = array_map('intval', $managerStatement->fetchAll(PDO::FETCH_COLUMN));
            $remainingActiveManagers = count(array_filter(
                $managerIds,
                static fn(int $id): bool => $id !== (int) $target['id']
            ));
            UserAdminRules::assertDeletionAllowed(
                (int) $admin['id'],
                (int) $target['id'],
                $targetManagesUsers,
                $remainingActiveManagers
            );

            // The address is released so the person can register with it again.
            $pdo->prepare('UPDATE users SET status = "deleted", email = CONCAT("deleted-", id, "@deleted.invalid"), updated_at = UTC_TIMESTAMP() WHERE id = ?')
                ->execute([(int) $target['id']]);
            $pdo->prepare('UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL')
                ->execute([(int) $target['id']]);
        });

        Http::json(['id' => (int) $target['id'], 'status' => 'deleted', 'deleted' => true]);
    }

    public function decideTrainer(string $trainerId, string $decision): never
    {
        $admin = $this->requireAdminPermission('review_trainers');
        if (!in_array($decision, ['approve', 'reject'], true)) {
            throw new HttpException(404, 'ไม่พบการทำงานนี้', 'NOT_FOUND');
        }
        $input = Http::body();
        $notificationIds = [];
        $result = $this->database->transaction(function (PDO $pdo) use ($trainerId, $decision, $input, $admin, &$notificationIds): array {
            $trainer = $this->database->fetchOne(
                'SELECT id, user_id, approval_status FROM trainer_profiles WHERE id = ? FOR UPDATE',
                [(int) $trainerId]
            );
            if (!$trainer) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์เทรนเนอร์', 'TRAINER_NOT_FOUND');
            }

            $note = trim(Http::stringField($input, 'note'));
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

            $this->notify($pdo, $notificationIds, $status === 'approved' ? NotificationRules::TRAINER_APPLICATION_APPROVED : NotificationRules::TRAINER_APPLICATION_REJECTED, ['trainerUserId' => (int) $trainer['user_id'], 'reviewNote' => $note]);

            return ['trainerId' => (int) $trainer['id'], 'status' => $status];
        });
        $this->notifications->deliverByIds($notificationIds);

        Http::json($result);
    }

    public function adminReviewQueue(): never
    {
        // Payments settle through Stripe, so the queue holds trainer
        // applications only.
        $this->requireAdminPermission('review_trainers');
        $trainers = $this->database->fetchAll(
            'SELECT tp.id, tp.slug, tp.created_at, tp.is_demo, u.display_name, COUNT(tc.id) AS certificate_count
             FROM trainer_profiles tp
             JOIN users u ON u.id = tp.user_id
             LEFT JOIN trainer_certificates tc ON tc.trainer_profile_id = tp.id
             WHERE tp.approval_status = "pending"
             GROUP BY tp.id ORDER BY tp.created_at ASC LIMIT 100'
        );
        $certificatesByTrainer = [];
        if ($trainers !== []) {
            $trainerIds = array_map(fn(array $row): int => (int) $row['id'], $trainers);
            $placeholders = self::marks($trainerIds);
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
        ]);
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
        $target = self::uploadPath((string) $record['file_path']);
        if ($target === null) {
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

    private function accountProfilePayload(array $user): array
    {
        if ($user['role'] === 'member') {
            $row = $this->database->fetchOne(
                'SELECT u.display_name, u.email, mp.first_name, mp.last_name, mp.phone, mp.goals,
                        mp.experience_level, mp.weight, mp.height, mp.birth_date, mp.image_path
                 FROM users u JOIN member_profiles mp ON mp.user_id = u.id WHERE u.id = ?',
                [$user['id']]
            );
            if (!$row) {
                throw new HttpException(404, 'ไม่พบโปรไฟล์สมาชิก', 'PROFILE_NOT_FOUND');
            }
            $firstName = trim((string) ($row['first_name'] ?? ''));
            // Members registered before member_profiles carried a name have theirs
            // only in users.display_name, so the first name falls back to it. The
            // flag marks that fallback: an editing form must not present it as
            // stored input, or the next save fails the surname rule instead.
            $nameFromDisplayName = $firstName === '';
            return [
                'role' => 'member',
                'user' => ['displayName' => $row['display_name'], 'email' => $row['email']],
                'imageUrl' => self::accountImageUrl('member', (int) $user['id'], $row['image_path']),
                'member' => [
                    'nameFromDisplayName' => $nameFromDisplayName,
                    'firstName' => $nameFromDisplayName ? $row['display_name'] : $firstName,
                    'lastName' => $row['last_name'] ?? '',
                    'phone' => $row['phone'] ?? '',
                    'fitnessGoal' => $row['goals'] ?? '',
                    'experienceLevel' => $row['experience_level'] ?? '',
                    'weight' => $row['weight'] === null ? null : (float) $row['weight'],
                    'height' => $row['height'] === null ? null : (float) $row['height'],
                    'birthDate' => $row['birth_date'] ?? null,
                ],
            ];
        }

        $row = $this->database->fetchOne(
            'SELECT u.display_name, u.email, tp.id, tp.legal_name, tp.nickname, tp.phone, tp.birth_date, tp.education, tp.headline, tp.bio,
                    tp.years_experience, tp.service_mode, tp.gym_name, tp.price_from, tp.monthly_price,
                    tp.monthly_session_count, tp.image_path,
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
                'nickname' => $row['nickname'] ?? '',
                'phone' => $row['phone'] ?? '',
                'birthDate' => $row['birth_date'] ?? null,
                'education' => $row['education'] ?? null,
                'headline' => $row['headline'] ?? '',
                'bio' => $row['bio'] ?? '',
                'yearsExperience' => (int) $row['years_experience'],
                'serviceMode' => $row['service_mode'],
                'gymName' => $row['gym_name'],
                'priceFrom' => $row['price_from'] === null ? null : (float) $row['price_from'],
                'monthlyPrice' => $row['monthly_price'] === null ? null : (float) $row['monthly_price'],
                'monthlySessionCount' => $row['monthly_session_count'] === null ? null : (int) $row['monthly_session_count'],
                'trainingTypeIds' => array_map(fn(array $type): int => (int) $type['training_type_id'], $types),
                'approvalStatus' => $row['approval_status'],
                'approvalNote' => $row['approval_note'],
                'certificates' => array_map(self::certificatePayload(...), $certificates),
            ],
        ];
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

    private function history(PDO $pdo, mixed $bookingId, ?string $from, string $to, mixed $byUserId, string $note): void
    {
        $pdo->prepare('INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by_user_id, note) VALUES (?, ?, ?, ?, ?)')
            ->execute([$bookingId, $from, $to, $byUserId, $note]);
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

    /**
     * A room belongs to a booking, or — for a question asked from a trainer's
     * profile before booking (บทที่ 3 ภาพที่ 3-16) — directly to one member and
     * one trainer. `booking_id` is null for such an inquiry room.
     */
    private function requireChatParticipant(int $roomId, array $user): array
    {
        $room = $this->database->fetchOne(
            'SELECT cr.id, b.id AS booking_id, b.public_id AS booking_public_id,
                    b.status AS booking_status,
                    COALESCE(b.member_user_id, cr.member_user_id) AS member_user_id,
                    tp.user_id AS trainer_user_id, tp.approval_status AS trainer_approval_status
             FROM chat_rooms cr
             LEFT JOIN bookings b ON b.id = cr.booking_id
             JOIN trainer_profiles tp ON tp.id = COALESCE(b.trainer_profile_id, cr.trainer_profile_id)
             WHERE cr.id = ?',
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

    /** Opens (or reopens) the member's inquiry room with a trainer. */
    public function openInquiryRoom(): never
    {
        $user = $this->auth->requireUser(['member']);
        $input = Http::body();
        Http::requireFields($input, ['trainerId']);
        $trainerKey = Http::stringField($input, 'trainerId');
        $roomId = $this->database->transaction(function (PDO $pdo) use ($user, $trainerKey): int {
            $trainer = $pdo->prepare(
                'SELECT tp.id FROM trainer_profiles tp JOIN users u ON u.id = tp.user_id
                 WHERE (tp.id = ? OR tp.slug = ?) AND tp.approval_status = "approved" AND u.status = "active"
                 FOR UPDATE'
            );
            $trainer->execute([ctype_digit($trainerKey) ? (int) $trainerKey : 0, $trainerKey]);
            $trainerProfileId = $trainer->fetchColumn();
            if ($trainerProfileId === false) {
                throw new HttpException(404, 'ไม่พบเทรนเนอร์', 'TRAINER_NOT_FOUND');
            }
            $existing = $pdo->prepare(
                'SELECT id FROM chat_rooms WHERE booking_id IS NULL AND member_user_id = ? AND trainer_profile_id = ? LIMIT 1'
            );
            $existing->execute([(int) $user['id'], (int) $trainerProfileId]);
            $found = $existing->fetchColumn();
            if ($found !== false) {
                return (int) $found;
            }
            $pdo->prepare('INSERT INTO chat_rooms (booking_id, member_user_id, trainer_profile_id) VALUES (NULL, ?, ?)')
                ->execute([(int) $user['id'], (int) $trainerProfileId]);
            return (int) $pdo->lastInsertId();
        });
        Http::json(['roomId' => $roomId, 'id' => 'CHAT-' . $roomId], 201);
    }

    /**
     * Inquiry rooms for the chat list, shaped like the booking rows the chat
     * screen already renders so both kinds of conversation share one list.
     */
    public function inquiryRooms(): never
    {
        $user = $this->auth->requireUser(['member', 'trainer']);
        $column = $user['role'] === 'member' ? 'cr.member_user_id' : 'tp.user_id';
        $rows = $this->database->fetchAll(
            'SELECT cr.id, cr.created_at, tp.id AS trainer_id, tp.user_id AS trainer_user_id, tp.slug, tp.image_path AS trainer_image_path,
                    trainer_user.display_name AS trainer_name,
                    cr.member_user_id, member_user.display_name AS member_name, mp.image_path AS member_image_path,
                    (SELECT MAX(m.created_at) FROM messages m WHERE m.chat_room_id = cr.id) AS last_message_at
             FROM chat_rooms cr
             JOIN trainer_profiles tp ON tp.id = cr.trainer_profile_id
             JOIN users trainer_user ON trainer_user.id = tp.user_id
             JOIN users member_user ON member_user.id = cr.member_user_id
             LEFT JOIN member_profiles mp ON mp.user_id = cr.member_user_id
             WHERE cr.booking_id IS NULL AND ' . $column . ' = ?
             ORDER BY COALESCE(last_message_at, cr.created_at) DESC LIMIT 100',
            [(int) $user['id']]
        );
        Http::json(array_map(function (array $row): array {
            $activity = $this->iso($row['last_message_at'] ?? $row['created_at']);
            return [
                'id' => 'CHAT-' . (int) $row['id'],
                'inquiry' => true,
                'chatRoomId' => (int) $row['id'],
                'trainer' => [
                    'id' => (int) $row['trainer_id'],
                    'slug' => $row['slug'],
                    'displayName' => $row['trainer_name'],
                    'imageUrl' => self::accountImageUrl('trainer', (int) $row['trainer_user_id'], $row['trainer_image_path'] ?? null),
                ],
                'member' => [
                    'id' => (int) $row['member_user_id'],
                    'displayName' => $row['member_name'],
                    'imageUrl' => self::accountImageUrl('member', (int) $row['member_user_id'], $row['member_image_path'] ?? null),
                ],
                'startsAt' => $activity,
                'endsAt' => $activity,
                'createdAt' => $this->iso($row['created_at']),
                'status' => 'inquiry',
                'paymentStatus' => 'not_submitted',
                'actions' => [
                    'canPay' => false, 'canReadChat' => true, 'canSendChat' => true,
                    'canComplete' => false, 'canReview' => false, 'canCancel' => false,
                ],
            ];
        }, $rows));
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
        $extensions = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'image/gif' => 'gif'];
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
        $target = self::uploadPath($relativePath);
        if ($target !== null) {
            unlink($target);
        }
    }

    /** The real path of a stored upload, or null when it is missing or outside the uploads folder. */
    private static function uploadPath(string $relativePath, string $directory = ''): ?string
    {
        $root = realpath(dirname(__DIR__) . '/uploads' . ($directory === '' ? '' : '/' . $directory));
        $target = realpath(dirname(__DIR__) . '/' . ltrim($relativePath, '/\\'));
        $inside = $root !== false && $target !== false && str_starts_with($target, $root . DIRECTORY_SEPARATOR);
        return $inside && is_file($target) ? $target : null;
    }

    private function serveUploadedImage(string $relativePath, string $directory, string $filename, bool $cache): never
    {
        $target = self::uploadPath($relativePath, $directory);
        $mime = $target === null ? false : (new finfo(FILEINFO_MIME_TYPE))->file($target);
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

    private static function utc(string $value = 'now'): DateTimeImmutable
    {
        return new DateTimeImmutable($value, new DateTimeZone('UTC'));
    }

    /** One "?" per value, for an IN (...) list. */
    private static function marks(array $values): string
    {
        return implode(',', array_fill(0, count($values), '?'));
    }

    /** Records an event; the ids are delivered after the transaction commits. */
    private function notify(PDO $pdo, array &$ids, string $event, array $context): void
    {
        $ids = array_merge($ids, $this->notifications->recordEvent($pdo, $event, $context));
    }

    private function iso(string $value): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', strtotime($value . ' UTC'));
    }
}
